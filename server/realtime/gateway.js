import { WebSocket, WebSocketServer } from "ws";
import { authenticateWebSocketRequest } from "../middleware/requireAuth.js";
import { deriveRealtimeScope } from "./scope.js";

const FORBIDDEN_SCOPE_PARAMETERS = new Set([
  "channel",
  "profileId",
  "province",
  "pruid",
  "role",
  "scope",
  "userId",
]);

function httpStatusText(statusCode) {
  return ({ 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests" })[statusCode]
    ?? "Bad Request";
}

function rejectUpgrade(socket, statusCode, message) {
  if (socket.destroyed) return;
  const body = JSON.stringify({ error: message });
  socket.write([
    `HTTP/1.1 ${statusCode} ${httpStatusText(statusCode)}`,
    "Connection: close",
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"));
  socket.destroy();
}

function parseSince(url) {
  const value = url.searchParams.get("since");
  if (value === null || value === "") return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : NaN;
}

function isSameOriginRequest(request, origin) {
  try {
    const parsedOrigin = new URL(origin);
    const forwardedHost = String(request.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
    const requestHost = forwardedHost || request.headers.host;
    const forwardedProtocol = String(request.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
    const requestProtocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
    return parsedOrigin.host === requestHost && parsedOrigin.protocol === `${requestProtocol}:`;
  } catch {
    return false;
  }
}

export class RealtimeGateway {
  constructor({
    allowedOrigins,
    authenticate = authenticateWebSocketRequest,
    deriveScope = deriveRealtimeScope,
    heartbeatIntervalMs = 25_000,
    maxBufferedBytes = 256 * 1024,
    maxConnectionsPerIp = 20,
    maxConnectionsPerProfile = 5,
    maxMessagesPerMinute = 30,
    maxReplayEvents = 500,
    path = "/api/realtime",
    replay,
  }) {
    this.allowedOrigins = new Set(allowedOrigins ?? []);
    this.authenticate = authenticate;
    this.connections = new Set();
    this.connectionsByIp = new Map();
    this.connectionsByProfile = new Map();
    this.deriveScope = deriveScope;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.heartbeatTimer = null;
    this.maxBufferedBytes = maxBufferedBytes;
    this.maxConnectionsPerIp = maxConnectionsPerIp;
    this.maxConnectionsPerProfile = maxConnectionsPerProfile;
    this.maxMessagesPerMinute = maxMessagesPerMinute;
    this.maxReplayEvents = maxReplayEvents;
    this.path = path;
    this.replay = replay;
    this.server = null;
    this.upgradeHandler = this.handleUpgrade.bind(this);
    this.wss = new WebSocketServer({ clientTracking: false, noServer: true });
  }

  attach(server) {
    if (this.server) return this;
    this.server = server;
    server.on("upgrade", this.upgradeHandler);
    this.heartbeatTimer = setInterval(() => this.sweepHeartbeat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
    return this;
  }

  close() {
    if (this.server) this.server.off("upgrade", this.upgradeHandler);
    this.server = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const session of [...this.connections]) session.socket.close(1001, "Server shutdown");
    this.wss.close();
  }

  connectionCount(map, key) {
    return map.get(key)?.size ?? 0;
  }

  addToIndex(map, key, session) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(session);
  }

  removeFromIndex(map, key, session) {
    const entries = map.get(key);
    if (!entries) return;
    entries.delete(session);
    if (!entries.size) map.delete(key);
  }

  async handleUpgrade(request, socket, head) {
    socket.on("error", () => {});
    let url;
    try {
      url = new URL(request.url, "http://realtime.local");
    } catch {
      rejectUpgrade(socket, 400, "Invalid realtime request URL.");
      return;
    }

    if (url.pathname !== this.path) {
      rejectUpgrade(socket, 404, "Realtime endpoint not found.");
      return;
    }

    const origin = request.headers.origin;
    if (!origin || (!this.allowedOrigins.has(origin) && !isSameOriginRequest(request, origin))) {
      rejectUpgrade(socket, 403, "Realtime origin is not allowed.");
      return;
    }

    if ([...url.searchParams.keys()].some((key) => FORBIDDEN_SCOPE_PARAMETERS.has(key))) {
      rejectUpgrade(socket, 400, "Realtime scope is derived by the server.");
      return;
    }
    if ([...url.searchParams.keys()].some((key) => key !== "since")) {
      rejectUpgrade(socket, 400, "Unsupported realtime subscription hint.");
      return;
    }

    const since = parseSince(url);
    if (Number.isNaN(since)) {
      rejectUpgrade(socket, 400, "Invalid replay sequence.");
      return;
    }

    const ip = String(request.socket.remoteAddress ?? "unknown");
    if (this.connectionCount(this.connectionsByIp, ip) >= this.maxConnectionsPerIp) {
      rejectUpgrade(socket, 429, "Realtime connection limit reached.");
      return;
    }

    let identity;
    let scope;
    try {
      identity = await this.authenticate(request);
      if (!identity) {
        rejectUpgrade(socket, 401, "Authentication is required.");
        return;
      }
      scope = this.deriveScope(identity);
    } catch (error) {
      rejectUpgrade(socket, error.statusCode === 401 ? 401 : 403, "Realtime access is not allowed.");
      return;
    }

    if (
      this.connectionCount(this.connectionsByProfile, scope.profileId)
      >= this.maxConnectionsPerProfile
    ) {
      rejectUpgrade(socket, 429, "Realtime profile connection limit reached.");
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (webSocket) => {
      this.acceptConnection(webSocket, { identity, ip, scope, since });
    });
  }

  acceptConnection(socket, { identity, ip, scope, since }) {
    const session = {
      identity,
      ip,
      isAlive: true,
      lastSequence: since ?? 0,
      messageCount: 0,
      messageWindowStartedAt: Date.now(),
      pendingLive: [],
      replaying: since !== null,
      scope,
      socket,
    };
    this.connections.add(session);
    this.addToIndex(this.connectionsByIp, ip, session);
    this.addToIndex(this.connectionsByProfile, scope.profileId, session);

    socket.on("pong", () => { session.isAlive = true; });
    socket.on("message", () => this.handleClientMessage(session));
    socket.on("close", () => this.removeConnection(session));
    socket.on("error", () => this.removeConnection(session));

    void this.initializeConnection(session, since);
  }

  async initializeConnection(session, since) {
    try {
      if (since !== null) {
        if (!session.scope.pruid || typeof this.replay !== "function") {
          this.sendControl(session, {
            latestSequence: since,
            reason: "replay-unavailable",
            type: "resync-required",
          });
        } else {
          const result = await this.replay(session.scope.pruid, since, this.maxReplayEvents);
          if (result.resyncRequired) {
            session.lastSequence = result.latestSequence ?? since;
            this.sendControl(session, {
              latestSequence: session.lastSequence,
              reason: "retention-expired",
              type: "resync-required",
            });
          } else {
            for (const event of result.events) this.sendEvent(session, event);
          }
        }
      }

      session.replaying = false;
      session.pendingLive
        .sort((left, right) => left.sequence - right.sequence)
        .forEach((event) => {
          if (event.sequence > session.lastSequence) this.sendEvent(session, event);
        });
      session.pendingLive = [];
      this.sendControl(session, {
        channels: session.scope.channels,
        lastSequence: session.lastSequence,
        type: "ready",
      });
    } catch {
      this.sendControl(session, {
        latestSequence: session.lastSequence,
        reason: "replay-failed",
        type: "resync-required",
      });
      session.replaying = false;
      session.pendingLive = [];
    }
  }

  handleClientMessage(session) {
    const now = Date.now();
    if (now - session.messageWindowStartedAt >= 60_000) {
      session.messageCount = 0;
      session.messageWindowStartedAt = now;
    }
    session.messageCount += 1;
    if (session.messageCount > this.maxMessagesPerMinute) {
      session.socket.close(1008, "Rate limit exceeded");
      return;
    }
    // CP0 is server-push only. Subscription and scope messages are rejected so
    // browser input can never widen the server-derived channel set.
    session.socket.close(1008, "Client subscriptions are not accepted");
  }

  sendControl(session, control) {
    return this.sendJson(session, { schemaVersion: 1, ...control });
  }

  sendEvent(session, event) {
    if (this.sendJson(session, event)) {
      session.lastSequence = Math.max(session.lastSequence, event.sequence);
      return true;
    }
    return false;
  }

  sendJson(session, value) {
    if (session.socket.readyState !== WebSocket.OPEN) return false;
    const payload = JSON.stringify(value);
    const bytes = Buffer.byteLength(payload);
    if (bytes > this.maxBufferedBytes || session.socket.bufferedAmount + bytes > this.maxBufferedBytes) {
      session.socket.close(1013, "Outbound buffer limit exceeded");
      return false;
    }
    session.socket.send(payload);
    return true;
  }

  async publish({ event, pruid, profileId = null }) {
    for (const session of this.connections) {
      const authorized = event.scope.kind === "user"
        ? profileId && session.scope.profileId === profileId
        : session.scope.pruid === String(pruid);
      if (!authorized) continue;
      if (session.replaying) {
        if (session.pendingLive.length >= this.maxReplayEvents) {
          session.socket.close(1013, "Replay buffer limit exceeded");
        } else {
          session.pendingLive.push(event);
        }
        continue;
      }
      this.sendEvent(session, event);
    }
  }

  sweepHeartbeat() {
    for (const session of this.connections) {
      if (!session.isAlive) {
        session.socket.terminate();
        this.removeConnection(session);
        continue;
      }
      session.isAlive = false;
      if (session.socket.readyState === WebSocket.OPEN) session.socket.ping();
    }
  }

  removeConnection(session) {
    if (!this.connections.delete(session)) return;
    this.removeFromIndex(this.connectionsByIp, session.ip, session);
    this.removeFromIndex(this.connectionsByProfile, session.scope.profileId, session);
  }
}

export function createRealtimeGateway(options) {
  return new RealtimeGateway(options);
}
