/**
 * Standalone client domain models (no Telegram TL / Peer / Updates).
 * UI layers still use legacy shapes until migration completes; map at boundaries.
 */

export type ISODateString = string;

/** Backend user record */
export type DomainUser = {
  id: string,
  profile?: {
    firstName?: string,
    lastName?: string,
    username?: string,
    photoUrl?: string
  },
  phone?: string,
  createdAt?: ISODateString
};

/** Chat / channel surface for lists and headers */
export type DomainChat = {
  id: string,
  title: string,
  createdAt?: ISODateString,
  memberIds?: string[],
  /** last message preview from server */
  lastMessage?: DomainMessage
};

/** Chat message */
export type DomainMessage = {
  id: string,
  chatId: string,
  senderId: string,
  text?: string,
  createdAt?: ISODateString,
  /** opaque payload for gifts / media — backend-defined */
  attachments?: Record<string, unknown>[]
};

/** Gift entity — fields mirror what backend sends; extend freely */
export type DomainGift = {
  id: string,
  slug?: string,
  title?: string,
  /** animation URL or sticker file reference */
  stickerUrl?: string,
  /** lottie / tgs asset reference if applicable */
  animationRef?: string,
  stars?: number,
  metadata?: Record<string, unknown>
};

/** Wire envelope for fire-and-forget events */
export type SocketSendEnvelope = {
  type: string,
  payload?: unknown
};

/** Request–response over WebSocket */
export type SocketRequestEnvelope = SocketSendEnvelope & {
  reqId: string
};

export type SocketResponseEnvelope = {
  reqId: string,
  ok: true,
  data?: unknown
} | {
  reqId: string,
  ok: false,
  error: string
};

/** Narrow unknown JSON to RPC envelope; invalid shapes return null. */
export function parseSocketResponseEnvelope(raw: unknown): SocketResponseEnvelope | null {
  if(!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if(typeof o.reqId !== 'string') {
    return null;
  }
  if(o.ok === true) {
    return {
      reqId: o.reqId,
      ok: true,
      data: Object.prototype.hasOwnProperty.call(o, 'data') ? o.data : undefined
    };
  }
  if(o.ok === false) {
    const error = typeof o.error === 'string' ? o.error : 'REQUEST_FAILED';
    return {reqId: o.reqId, ok: false, error};
  }
  return null;
}
