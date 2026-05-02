export type WebSocketManagerHandlers = {
  onOpen?: () => void,
  onClose?: (event: CloseEvent) => void,
  onMessage?: (parsed: unknown, raw: MessageEvent) => void,
  onError?: (event: Event) => void
};

export type WebSocketManagerOptions = {
  /** Application-level heartbeat interval (browser WebSocket has no ping API). */
  heartbeatIntervalMs?: number,
  /** Serialized JSON or text ping frame */
  buildPing?: () => string,
  /**
   * Return true if incoming parsed JSON is a heartbeat reply and should not
   * surface through onMessage.
   */
  isPong?: (parsed: unknown) => boolean,
  reconnectInitialDelayMs?: number,
  reconnectMaxDelayMs?: number,
  reconnectJitter?: number,
  /** Sent immediately after socket opens (UTF-8 text) */
  buildConnectAuthFrame?: () => string | undefined
};

const defaultPing = () => JSON.stringify({type: 'ping', t: Date.now()});

const defaultIsPong = (parsed: unknown) => {
  if(!parsed || typeof parsed !== 'object') {
    return false;
  }
  const t = (parsed as {type?: string}).type;
  return t === 'pong' || t === '__pong';
};

/**
 * Thin wrapper: connect, auto-reconnect, optional heartbeat, subscriber hooks.
 */
export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url = '';
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handlers = new Set<WebSocketManagerHandlers>();

  constructor(private readonly options: WebSocketManagerOptions = {}) {}

  addHandlers(h: WebSocketManagerHandlers): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }

  /** Prefer addHandlers — single-object listener API */
  on(h: WebSocketManagerHandlers): () => void {
    return this.addHandlers(h);
  }

  connect(url: string) {
    this.intentionalClose = false;
    this.url = url;
    this.clearReconnectTimer();
    this.open();
  }

  disconnect(code?: number, reason?: string) {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    if(this.ws) {
      try {
        this.ws.close(code, reason);
      } catch(err) {
        /* noop */
      }
      this.ws = null;
    }
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  sendText(data: string) {
    if(this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  sendJson(payload: unknown) {
    this.sendText(JSON.stringify(payload));
  }

  private open() {
    this.stopHeartbeat();
    if(this.ws) {
      try {
        this.ws.close();
      } catch(err) {
        /* noop */
      }
      this.ws = null;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch(err) {
      this.scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      const auth = this.options.buildConnectAuthFrame?.();
      if(auth) {
        try {
          socket.send(auth);
        } catch(err) {
          /* noop */
        }
      }
      this.startHeartbeat();
      for(const h of this.handlers) {
        h.onOpen?.();
      }
    };

    socket.onclose = (event) => {
      this.stopHeartbeat();
      this.ws = null;
      for(const h of this.handlers) {
        h.onClose?.(event);
      }
      if(!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = (event) => {
      for(const h of this.handlers) {
        h.onError?.(event);
      }
    };

    socket.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : '';
      let parsed: unknown = text;
      if(text) {
        try {
          parsed = JSON.parse(text);
        } catch(err) {
          parsed = text;
        }
      }

      const pong = this.options.isPong ?? defaultIsPong;
      if(pong(parsed)) {
        return;
      }

      for(const h of this.handlers) {
        h.onMessage?.(parsed, event);
      }
    };
  }

  private startHeartbeat() {
    const ms = this.options.heartbeatIntervalMs;
    if(!ms || ms <= 0) {
      return;
    }
    const build = this.options.buildPing ?? defaultPing;
    this.heartbeatTimer = setInterval(() => {
      if(this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(build());
        } catch(err) {
          /* noop */
        }
      }
    }, ms);
  }

  private stopHeartbeat() {
    if(this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if(this.intentionalClose || !this.url) {
      return;
    }
    this.clearReconnectTimer();
    const initial = this.options.reconnectInitialDelayMs ?? 800;
    const max = this.options.reconnectMaxDelayMs ?? 30000;
    const jitter = this.options.reconnectJitter ?? 0.25;
    const exp = Math.min(max, initial * Math.pow(2, this.reconnectAttempt));
    const noise = exp * jitter * Math.random();
    const delay = Math.round(exp + noise);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private clearReconnectTimer() {
    if(this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
