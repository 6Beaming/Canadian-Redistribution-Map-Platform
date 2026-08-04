const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function compareVersions(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (/^\d+$/u.test(leftString) && /^\d+$/u.test(rightString)) {
    const leftNumber = BigInt(leftString);
    const rightNumber = BigInt(rightString);
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? 1 : -1;
  }
  const leftTime = Date.parse(leftString);
  const rightTime = Date.parse(rightString);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) return Math.sign(leftTime - rightTime);
  return leftString.localeCompare(rightString);
}

function defaultUrl(lastSequence, resume = false) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL("/api/realtime", `${protocol}//${window.location.host}`);
  if (resume) url.searchParams.set("since", String(lastSequence));
  return url.toString();
}

function looksLikeEvent(value) {
  return value
    && value.schemaVersion === 1
    && UUID_PATTERN.test(String(value.eventId ?? ""))
    && Number.isSafeInteger(value.sequence)
    && value.sequence > 0
    && typeof value.entity === "string"
    && typeof value.aggregateId === "string"
    && Array.isArray(value.invalidate);
}

export class RealtimeClient {
  constructor({
    WebSocketImpl = globalThis.WebSocket,
    baseDelayMs = 250,
    maxDelayMs = 15_000,
    maxRememberedEvents = 2_000,
    onEvent = () => {},
    onResync = () => {},
    onStateChange = () => {},
    onUnauthorized = () => {},
    random = Math.random,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    urlFactory = defaultUrl,
  } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.baseDelayMs = baseDelayMs;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.enabled = false;
    this.eventIds = new Map();
    this.generation = 0;
    this.hasConnected = false;
    this.lastSequence = 0;
    this.maxDelayMs = maxDelayMs;
    this.maxRememberedEvents = maxRememberedEvents;
    this.messageChain = Promise.resolve();
    this.onEvent = onEvent;
    this.onResync = onResync;
    this.onStateChange = onStateChange;
    this.onUnauthorized = onUnauthorized;
    this.random = random;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.resourceVersions = new Map();
    this.sessionKey = null;
    this.setTimeoutImpl = setTimeoutImpl;
    this.socket = null;
    this.state = "offline";
    this.urlFactory = urlFactory;
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }

  start(sessionKey) {
    if (!sessionKey) return;
    if (this.sessionKey !== sessionKey) {
      this.disconnect();
      this.resetOrderingState();
      this.sessionKey = sessionKey;
    }
    this.enabled = true;
    this.connect();
  }

  disconnect() {
    this.enabled = false;
    this.generation += 1;
    this.cancelReconnect();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close(1000, "Client disconnected");
    this.setState("offline");
  }

  reconnect() {
    if (!this.sessionKey) return;
    this.enabled = true;
    this.connect();
  }

  stop({ reset = true } = {}) {
    this.disconnect();
    if (reset) {
      this.sessionKey = null;
      this.resetOrderingState();
    }
  }

  resetOrderingState() {
    this.eventIds.clear();
    this.lastSequence = 0;
    this.resourceVersions.clear();
    this.hasConnected = false;
  }

  connect() {
    if (!this.enabled || !this.WebSocketImpl) return;
    if (this.socket && this.socket.readyState < 2) return;
    this.cancelReconnect();
    this.setState("reconnecting");
    const generation = this.generation;
    const socket = new this.WebSocketImpl(this.urlFactory(this.lastSequence, this.hasConnected));
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.hasConnected = true;
      this.reconnectAttempts = 0;
      this.setState("live");
    });
    socket.addEventListener("message", (message) => {
      if (this.socket !== socket) return;
      this.messageChain = this.messageChain.then(() => {
        if (!this.enabled || generation !== this.generation) return undefined;
        return this.handleMessage(message.data);
      });
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket || generation !== this.generation) return;
      this.socket = null;
      if ([4401, 4403].includes(event.code)) {
        this.enabled = false;
        this.setState("offline");
        this.onUnauthorized(event.code);
        return;
      }
      if (this.enabled) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      // close drives deterministic retry and state transitions.
    });
  }

  scheduleReconnect() {
    this.setState(typeof navigator !== "undefined" && navigator.onLine === false
      ? "offline"
      : "reconnecting");
    const exponential = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * (2 ** this.reconnectAttempts),
    );
    const jittered = Math.max(0, Math.round(exponential * (0.75 + this.random() * 0.5)));
    this.reconnectAttempts += 1;
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      this.connect();
    }, jittered);
  }

  cancelReconnect() {
    if (this.reconnectTimer !== null) this.clearTimeoutImpl(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  rememberEvent(eventId) {
    this.eventIds.delete(eventId);
    this.eventIds.set(eventId, true);
    while (this.eventIds.size > this.maxRememberedEvents) {
      this.eventIds.delete(this.eventIds.keys().next().value);
    }
  }

  async handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message?.type === "resync-required") {
      try {
        await this.onResync(message.reason ?? "resync-required");
        this.lastSequence = Math.max(this.lastSequence, Number(message.latestSequence) || 0);
      } catch {
        // Keep the old acknowledgement so reconnect/focus recovery retries.
      }
      return;
    }
    if (message?.type === "ready") return;
    if (!looksLikeEvent(message) || this.eventIds.has(message.eventId)) return;

    if (this.lastSequence > 0 && message.sequence > this.lastSequence + 1) {
      try {
        await this.onResync("sequence-gap");
        this.lastSequence = message.sequence;
        this.rememberEvent(message.eventId);
        this.resourceVersions.set(`${message.entity}:${message.aggregateId}`, message.resourceVersion);
      } catch {
        // Do not acknowledge a gap until the authoritative full refetch succeeds.
      }
      return;
    }
    if (message.sequence <= this.lastSequence) {
      this.rememberEvent(message.eventId);
      return;
    }

    const resourceKey = `${message.entity}:${message.aggregateId}`;
    const currentVersion = this.resourceVersions.get(resourceKey);
    if (currentVersion !== undefined && compareVersions(message.resourceVersion, currentVersion) <= 0) {
      this.lastSequence = message.sequence;
      this.rememberEvent(message.eventId);
      return;
    }
    try {
      await this.onEvent(message);
      this.lastSequence = message.sequence;
      this.rememberEvent(message.eventId);
      this.resourceVersions.set(resourceKey, message.resourceVersion);
    } catch {
      try {
        await this.onResync("invalidation-refetch-failed");
        this.lastSequence = message.sequence;
        this.rememberEvent(message.eventId);
        this.resourceVersions.set(resourceKey, message.resourceVersion);
      } catch {
        // Leave the event unacknowledged so reconnect/focus recovery can retry it.
      }
    }
  }
}

export { compareVersions as compareRealtimeResourceVersions };
