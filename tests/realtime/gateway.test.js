import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "@jest/globals";
import { WebSocket } from "ws";
import { RealtimeDispatcher } from "../../server/realtime/dispatcher.js";
import { SyntheticRealtimeEventStore } from "../../server/realtime/eventStore.js";
import { createRealtimeGateway } from "../../server/realtime/gateway.js";

const openSockets = new Set();

afterEach(() => {
  for (const socket of openSockets) socket.terminate();
  openSockets.clear();
});

function identity(province = "MB", role = "commissioner") {
  return {
    profile: { id: "commissioner-1", province, role },
    user: { id: "commissioner-1" },
  };
}

async function startRuntime({ authenticate = async () => identity(), gatewayOptions, storeOptions } = {}) {
  const store = new SyntheticRealtimeEventStore(storeOptions);
  let dispatcher;
  const gateway = createRealtimeGateway({
    allowedOrigins: ["http://client.test"],
    authenticate,
    heartbeatIntervalMs: 60_000,
    replay: (...args) => dispatcher.replay(...args),
    ...gatewayOptions,
  });
  dispatcher = new RealtimeDispatcher({
    eventStore: store,
    logger: { error() {} },
    publisher: (delivery) => gateway.publish(delivery),
  });
  const server = http.createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  gateway.attach(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `ws://127.0.0.1:${address.port}`,
    dispatcher,
    gateway,
    store,
    async close() {
      gateway.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function connect(url, { cookie = "session=valid", origin = "http://client.test" } = {}) {
  const messages = [];
  const waiters = new Set();
  const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
  openSockets.add(socket);
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  function waitFor(predicate, timeoutMs = 1_000) {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        reject,
        resolve,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Timed out waiting for WebSocket message."));
        }, timeoutMs),
      };
      waiters.add(waiter);
    });
  }
  return { messages, opened, socket, waitFor };
}

async function rejectedStatus(url, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { Cookie: options.cookie ?? "session=valid", Origin: options.origin },
    });
    socket.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode);
      response.resume();
    });
    socket.once("open", () => reject(new Error("Expected the upgrade to be rejected.")));
    socket.once("error", () => {});
  });
}

test("upgrade derives Commissioner channels and rejects auth, origin, role, and supplied scope", async () => {
  const runtime = await startRuntime({
    authenticate: async (request) => {
      const cookie = String(request.headers.cookie ?? "");
      if (cookie.includes("missing")) return null;
      if (cookie.includes("wrong-role")) return identity("MB", "admin");
      return identity();
    },
  });
  try {
    const client = connect(`${runtime.baseUrl}/api/realtime`);
    await client.opened;
    const ready = await client.waitFor((message) => message.type === "ready");
    assert.deepEqual(ready.channels, [
      "province:46:submissions",
      "province:46:workspace",
      "province:46:archive",
      "province:46:heatmap",
    ]);
    assert.equal(await rejectedStatus(`${runtime.baseUrl}/api/realtime`, {
      cookie: "session=missing",
      origin: "http://client.test",
    }), 401);
    assert.equal(await rejectedStatus(`${runtime.baseUrl}/api/realtime`, {
      cookie: "session=wrong-role",
      origin: "http://client.test",
    }), 403);
    assert.equal(await rejectedStatus(`${runtime.baseUrl}/api/realtime`, {
      origin: "http://attacker.test",
    }), 403);
    assert.equal(await rejectedStatus(`${runtime.baseUrl}/api/realtime?pruid=47`, {
      origin: "http://client.test",
    }), 400);
  } finally {
    await runtime.close();
  }
});

test("two browsers converge, reconnect replays ordered events, and rollback emits nothing", async () => {
  const runtime = await startRuntime();
  try {
    const browserA = connect(`${runtime.baseUrl}/api/realtime`);
    const browserB = connect(`${runtime.baseUrl}/api/realtime`);
    await Promise.all([browserA.opened, browserB.opened]);
    await Promise.all([
      browserA.waitFor((message) => message.type === "ready"),
      browserB.waitFor((message) => message.type === "ready"),
    ]);

    runtime.store.commitSyntheticMutation({ pruid: "46", count: 1 });
    await runtime.dispatcher.dispatchOnce();
    await Promise.all([
      browserA.waitFor((message) => message.sequence === 1),
      browserB.waitFor((message) => message.sequence === 1),
    ]);

    browserB.socket.close(1000);
    await new Promise((resolve) => browserB.socket.once("close", resolve));
    runtime.store.commitSyntheticMutation({ pruid: "46", count: 2 });
    await runtime.dispatcher.dispatchOnce();

    const reconnectedB = connect(`${runtime.baseUrl}/api/realtime?since=1`);
    await reconnectedB.opened;
    await reconnectedB.waitFor((message) => message.type === "ready");
    assert.deepEqual(
      reconnectedB.messages.filter((message) => message.eventId).map((message) => message.sequence),
      [2, 3],
    );

    runtime.store.commitSyntheticMutation({ pruid: "46", commit: false });
    assert.equal(await runtime.dispatcher.dispatchOnce(), 0);
    const eventCount = reconnectedB.messages.filter((message) => message.eventId).length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(reconnectedB.messages.filter((message) => message.eventId).length, eventCount);
    assert.equal(runtime.store.readResource("46").version, 3);
  } finally {
    await runtime.close();
  }
});

test("retention expiry sends resync-required and outbound buffers are bounded", async () => {
  const runtime = await startRuntime({ storeOptions: { retentionLimit: 1 } });
  try {
    runtime.store.commitSyntheticMutation({ pruid: "46", count: 2 });
    const browser = connect(`${runtime.baseUrl}/api/realtime?since=0`);
    await browser.opened;
    const resync = await browser.waitFor((message) => message.type === "resync-required");
    assert.equal(resync.reason, "retention-expired");
    assert.equal(resync.latestSequence, 2);

    let closedWith = null;
    const fakeSession = {
      socket: {
        bufferedAmount: runtime.gateway.maxBufferedBytes,
        close(code) { closedWith = code; },
        readyState: WebSocket.OPEN,
      },
    };
    assert.equal(runtime.gateway.sendJson(fakeSession, { value: "x" }), false);
    assert.equal(closedWith, 1013);
  } finally {
    await runtime.close();
  }
});

test("connection limits, read-only protocol enforcement, and heartbeat expiry are deterministic", async () => {
  const runtime = await startRuntime({ gatewayOptions: { maxConnectionsPerProfile: 1 } });
  try {
    const first = connect(`${runtime.baseUrl}/api/realtime`);
    await first.opened;
    await first.waitFor((message) => message.type === "ready");
    assert.equal(await rejectedStatus(`${runtime.baseUrl}/api/realtime`, {
      origin: "http://client.test",
    }), 429);

    const closeCode = new Promise((resolve) => first.socket.once("close", resolve));
    first.socket.send(JSON.stringify({ scope: { pruid: "47" } }));
    assert.equal(await closeCode, 1008);

    let terminated = false;
    const deadSession = {
      ip: "dead-client",
      isAlive: false,
      scope: { profileId: "dead-profile" },
      socket: {
        readyState: WebSocket.OPEN,
        terminate() { terminated = true; },
      },
    };
    runtime.gateway.connections.add(deadSession);
    runtime.gateway.addToIndex(runtime.gateway.connectionsByIp, deadSession.ip, deadSession);
    runtime.gateway.addToIndex(
      runtime.gateway.connectionsByProfile,
      deadSession.scope.profileId,
      deadSession,
    );
    runtime.gateway.sweepHeartbeat();
    assert.equal(terminated, true);
    assert.equal(runtime.gateway.connections.has(deadSession), false);
  } finally {
    await runtime.close();
  }
});

