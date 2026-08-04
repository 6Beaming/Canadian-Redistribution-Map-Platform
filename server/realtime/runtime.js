import { RealtimeDispatcher } from "./dispatcher.js";
import { getDefaultRealtimeEventStore } from "./eventStore.js";
import { createRealtimeGateway } from "./gateway.js";

export function getRealtimeAllowedOrigins() {
  return (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function attachRealtimeRuntime(server, options = {}) {
  const eventStore = options.eventStore ?? getDefaultRealtimeEventStore();
  let dispatcher;
  const gateway = createRealtimeGateway({
    allowedOrigins: options.allowedOrigins ?? getRealtimeAllowedOrigins(),
    authenticate: options.authenticate,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    maxBufferedBytes: options.maxBufferedBytes,
    maxConnectionsPerIp: options.maxConnectionsPerIp,
    maxConnectionsPerProfile: options.maxConnectionsPerProfile,
    replay: (...args) => dispatcher.replay(...args),
  });
  dispatcher = new RealtimeDispatcher({
    eventStore,
    logger: options.logger,
    pollIntervalMs: options.pollIntervalMs,
    publisher: (delivery) => gateway.publish(delivery),
  });
  gateway.attach(server);
  dispatcher.start();
  return {
    dispatcher,
    eventStore,
    gateway,
    close() {
      dispatcher.stop();
      gateway.close();
    },
  };
}

