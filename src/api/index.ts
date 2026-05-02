import ctx from '@environment/ctx';
import {WebSocketManager, WebSocketManagerOptions} from '@/core/transport/WebSocketManager';
import {parseSocketResponseEnvelope} from '@/models/domain';
import type {SocketRequestEnvelope, SocketResponseEnvelope, SocketSendEnvelope} from '@/models/domain';

function randomReqId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type SocketApiOptions = WebSocketManagerOptions & {
  /** Default timeout for request() */
  defaultTimeoutMs?: number
};

type Pending = {
  resolve: (value: unknown) => void,
  reject: (reason: Error) => void,
  timer: ReturnType<typeof setTimeout>
};

function settleRpcPending(p: Pending, res: SocketResponseEnvelope): void {
  if(res.ok === true) {
    p.resolve(res.data);
    return;
  }
  p.reject(new Error(res.error ?? 'REQUEST_FAILED'));
}

/**
 * Application WebSocket API: fire-and-forget send + req/res correlation.
 * Expected server reply shape: SocketResponseEnvelope with matching reqId.
 */
export class SocketApi {
  readonly transport: WebSocketManager;
  private readonly pending = new Map<string, Pending>();
  private readonly defaultTimeoutMs: number;
  private readonly eventSubs = new Map<string, Set<(payload: unknown) => void>>();
  private unsubTransport: (() => void) | null = null;

  constructor(options: SocketApiOptions = {}) {
    const {defaultTimeoutMs = 30000, ...wsOpts} = options;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.transport = new WebSocketManager(wsOpts);
    this.unsubTransport = this.transport.addHandlers({
      onMessage: (parsed) => this.dispatchIncoming(parsed)
    });
  }

  destroy() {
    if(this.unsubTransport) {
      this.unsubTransport();
      this.unsubTransport = null;
    }
    for(const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`SocketApi destroyed (${id})`));
    }
    this.pending.clear();
    this.eventSubs.clear();
    this.transport.disconnect();
  }

  connect(url: string) {
    this.transport.connect(url);
  }

  /** Resolves when the socket is OPEN (or rejects on timeout / close before open). */
  whenOpen(timeoutMs = 20000): Promise<void> {
    if(this.transport.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = ctx.setTimeout(() => {
        off();
        reject(new Error('BACKEND_WS_OPEN_TIMEOUT'));
      }, timeoutMs);
      const off = this.transport.addHandlers({
        onOpen: () => {
          ctx.clearTimeout(timer);
          off();
          resolve();
        },
        onClose: () => {
          ctx.clearTimeout(timer);
          off();
          reject(new Error('BACKEND_WS_CLOSED_BEFORE_OPEN'));
        }
      });
    });
  }

  getCurrentUser(): Promise<unknown> {
    console.log('getCurrentUser called');
    return this.request('getCurrentUser', {});
  }

  getChats(): Promise<unknown> {
    console.log('getChats called');
    return this.request('getChats', {});
  }

  getMessages(chatId: string): Promise<unknown> {
    console.log('getMessages called', chatId);
    return this.request('getMessages', {chatId});
  }

  disconnect(code?: number, reason?: string) {
    this.transport.disconnect(code, reason);
  }

  /** Fire-and-forget envelope */
  send(event: string, payload?: unknown) {
    const env: SocketSendEnvelope = {type: event, payload};
    this.transport.sendJson(env);
  }

  /**
   * RPC-style call; resolves when server sends {reqId, ok, data} / {reqId, ok:false, error}.
   */
  request(event: string, payload?: unknown, timeoutMs = this.defaultTimeoutMs): Promise<unknown> {
    const reqId = randomReqId();
    const env: SocketRequestEnvelope = {type: event, payload, reqId};
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Socket request timeout: ${event}`));
      }, timeoutMs);
      this.pending.set(reqId, {resolve, reject, timer});
      try {
        this.transport.sendJson(env);
      } catch(err) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Subscribe to server-push events by envelope.type (non-response frames). */
  subscribe(event: string, handler: (payload: unknown) => void): () => void {
    let set = this.eventSubs.get(event);
    if(!set) {
      set = new Set();
      this.eventSubs.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if(set.size === 0) {
        this.eventSubs.delete(event);
      }
    };
  }

  private dispatchIncoming(parsed: unknown) {
    if(!parsed || typeof parsed !== 'object') {
      return;
    }
    const obj = parsed as Record<string, unknown>;

    const rpc = parseSocketResponseEnvelope(parsed);
    if(rpc) {
      const p = this.pending.get(rpc.reqId);
      if(!p) {
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(rpc.reqId);
      settleRpcPending(p, rpc);
      return;
    }

    const type = typeof obj.type === 'string' ? obj.type : '';
    if(!type) {
      return;
    }
    const subs = this.eventSubs.get(type);
    if(!subs?.size) {
      return;
    }
    const payload = Object.prototype.hasOwnProperty.call(obj, 'payload') ? obj.payload : obj;
    for(const fn of subs) {
      try {
        fn(payload);
      } catch(err) {
        /* subscriber errors are isolated */
      }
    }
  }
}

/**
 * Build ws URL from HTTP backend base (matches backendRealtime convention).
 */
export function httpBaseToWebSocketBase(httpBase: string): string {
  return httpBase.replace(/^http/, 'ws').replace(/\/$/, '');
}

export function createBackendRealtimeUrl(baseUrl: string, token: string): string {
  const wsBase = httpBaseToWebSocketBase(baseUrl.replace(/\/$/, ''));
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}

let singleton: SocketApi | null = null;

/** Shared instance for app wiring (optional). */
export function getSocketApi(): SocketApi | null {
  return singleton;
}

export function initSocketApi(options?: SocketApiOptions): SocketApi {
  singleton?.destroy();
  singleton = new SocketApi(options);
  return singleton;
}

export type {SocketRequestEnvelope, SocketResponseEnvelope, SocketSendEnvelope} from '@/models/domain';
