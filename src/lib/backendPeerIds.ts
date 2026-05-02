/*
 * Deterministic mapping backend UUID <-> Telegram-style PeerId (shared main thread + worker).
 */

export function backendUuidToUserPeerId(uuid: string): PeerId {
  let h = 5381;
  for(let i = 0; i < uuid.length; i++) {
    h = ((h << 5) + h) ^ uuid.charCodeAt(i);
    h |= 0;
  }
  const n = Math.abs(h);
  return ((n % 2000000000) + 100000000) as PeerId;
}

export function backendUuidToChatPeerId(uuid: string): PeerId {
  const base = backendUuidToUserPeerId(`chat:${uuid}`);
  return (-Math.abs(base)) as PeerId;
}

export function backendMessageMid(chatBackendId: string, messageBackendId: string): number {
  let h = 5381;
  const key = `${chatBackendId}:${messageBackendId}`;
  for(let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
    h |= 0;
  }
  const v = Math.abs(h) % 0x7effffff;
  return v || 1;
}
