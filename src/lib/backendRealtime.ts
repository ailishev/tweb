import type {ApiUpdatesManager} from '@appManagers/apiUpdatesManager';
import type {ApiManager} from '@appManagers/apiManager';
import {getBackendWorkerSession} from '@lib/backendWorkerSession';
import {
  backendCreatedAtToUnixSeconds,
  buildMessageFromBackend,
  mapBackendUser
} from '@lib/backendMtprotoAdapter';
import {backendUuidToChatPeerId, backendUuidToUserPeerId} from '@lib/backendPeerIds';
import rootScope from '@lib/rootScope';
import {
  initSocketApi,
  getSocketApi,
  createBackendRealtimeUrl,
  type SocketApi
} from '@/api';
import MTProtoMessagePort from '@lib/mainWorker/mainMessagePort';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {shouldSkipBackendWsBootstrapHydrate} from '@lib/backendBootstrapMain';
import {setBackendBootstrapPayload} from '@stores/backendBootstrapStore';
import backendMessagesStore, {appendBackendWsMessage} from '@stores/backendMessagesStore';

let wsHydrationRan = false;

function normalizeWsInboundMessage(payload: unknown): {chatId: string, row: Record<string, unknown>} | null {
  console.log('[backend-ws] WS message received', payload);
  if(!payload || typeof payload !== 'object') {
    return null;
  }
  const p = payload as Record<string, unknown>;
  let chatId = typeof p.chatId === 'string' ? p.chatId : '';
  let row: Record<string, unknown> | undefined =
    p.message && typeof p.message === 'object' ? (p.message as Record<string, unknown>) : undefined;
  if(!row && typeof p.id !== 'undefined' && typeof p.senderId !== 'undefined') {
    row = p;
  }
  if(!row) {
    return null;
  }
  if(!chatId && typeof row.chatId === 'string') {
    chatId = row.chatId;
  }
  const id = row.id != null ? String(row.id) : '';
  const senderId = row.senderId != null ? String(row.senderId) : '';
  const text = typeof row.text === 'string' ? row.text : '';
  if(!id || !chatId || !senderId) {
    return null;
  }
  const createdSec = backendCreatedAtToUnixSeconds(row.createdAt);
  return {
    chatId,
    row: {id, senderId, text, createdAt: createdSec}
  };
}

function attachRealtimeHandlers(socket: SocketApi, apiUpdatesManager: ApiUpdatesManager) {
  const api = (apiUpdatesManager as any).apiManager as ApiManager;

  const onInboundMessage = (payload: unknown) => {
    const norm = normalizeWsInboundMessage(payload);
    if(!norm) {
      return;
    }
    const {chatId, row} = norm;
    const senderKey = String(row.senderId);
    (apiUpdatesManager as any).appUsersManager.saveApiUsers([
      mapBackendUser({
        id: senderKey,
        profile: {
          firstName: senderKey.slice(0, 16),
          username: senderKey.slice(0, 32)
        }
      }, {})
    ]);
    const msg = buildMessageFromBackend(row, chatId, api);
    const createdMs = (row.createdAt as number) * 1000;
    appendBackendWsMessage({
      id: String(row.id),
      chatId,
      senderId: String(row.senderId),
      text: typeof row.text === 'string' ? row.text : '',
      createdAt: createdMs
    });
    console.log('[backend-ws] Store messages snapshot', {...backendMessagesStore.byChatId});
    const pts = (apiUpdatesManager.updatesState.pts || 1000) + 1;
    apiUpdatesManager.processLocalUpdate({
      _: 'updateNewMessage',
      message: msg,
      pts,
      pts_count: 1
    });
  };

  socket.subscribe('message:new', onInboundMessage);
  socket.subscribe('new_message', onInboundMessage);

  socket.subscribe('update_chat', (payload: any) => {
    const chatId = typeof payload?.chatId === 'string' ? payload.chatId : payload?.id;
    if(typeof chatId !== 'string') {
      return;
    }
    const peerId = backendUuidToChatPeerId(chatId);
    rootScope.dispatchEventSingle('chat_update', peerId.toChatId());
  });

  socket.subscribe('gift_update', (payload: any) => {
    const uid = typeof payload?.peerUserId === 'string' ? payload.peerUserId :
      typeof payload?.userId === 'string' ? payload.userId : '';
    if(!uid) {
      return;
    }
    const peerId = backendUuidToUserPeerId(uid);
    rootScope.dispatchEventSingle('star_gift_list_update', {peerId});
  });

  socket.subscribe('gift_received', (payload: any) => {
    const uid = typeof payload?.ownerId === 'string' ? payload.ownerId :
      typeof payload?.userId === 'string' ? payload.userId : '';
    if(!uid) {
      return;
    }
    const peerId = backendUuidToUserPeerId(uid);
    rootScope.dispatchEventSingle('star_gift_list_update', {peerId});
  });

  socket.subscribe('chat_created', () => {
    rootScope.dispatchEventSingle('state_synchronized');
  });

  socket.subscribe('user_update', (payload: any) => {
    const rawId = payload?.user?.id ?? payload?.userId;
    if(typeof rawId !== 'string') {
      return;
    }
    const uid = backendUuidToUserPeerId(rawId);
    rootScope.dispatchEventSingle('user_update', uid as UserId);
  });

  socket.subscribe('read:updated', (payload: any) => {
    if(!payload?.chatId) {
      return;
    }
    const um = apiUpdatesManager as any;
    const peerId = backendUuidToChatPeerId(payload.chatId);
    um.processLocalUpdate({
      _: 'updateReadHistoryInbox',
      peer: um.appPeersManager.getOutputPeer(peerId),
      max_id: 0,
      still_unread_count: 0,
      pts: undefined,
      pts_count: undefined
    });
  });
}

async function hydrateFromWsOnce(): Promise<void> {
  if(wsHydrationRan) {
    return;
  }
  const socket = getSocketApi();
  if(!socket) {
    return;
  }

  if(shouldSkipBackendWsBootstrapHydrate()) {
    wsHydrationRan = true;
    rootScope.dispatchEventSingle('state_synchronized');
    return;
  }

  try {
    const strictUser = await socket.getCurrentUser();
    const strictChats = await socket.getChats();
    setBackendBootstrapPayload(strictUser, strictChats as unknown[]);

    await MTProtoMessagePort.getInstance<true>().invoke('manager', {
      name: 'appMessagesManager',
      method: 'hydrateBackendWsBootstrap',
      args: [strictUser, strictChats],
      accountNumber: getCurrentAccount()
    });

    wsHydrationRan = true;
    rootScope.dispatchEventSingle('state_synchronized');
  } catch(err) {
    console.error('[backend-ws] hydrateFromWsOnce failed', err);
  }
}

/**
 * Single WebSocket: push events + RPC (`getCurrentUser` / `getChats`) after connect, then hydrate worker mirrors.
 */
export function connectBackendRealtime(apiUpdatesManager: ApiUpdatesManager) {
  const {token, baseUrl} = getBackendWorkerSession();
  if(!token || !baseUrl) {
    return;
  }

  wsHydrationRan = false;

  const sendSessionOnOpen =
    import.meta.env.VITE_WS_SEND_SESSION_FRAME === 'true' ||
    import.meta.env.VITE_WS_SEND_SESSION_FRAME === '1';

  const socket = initSocketApi({
    heartbeatIntervalMs: 25000,
    buildConnectAuthFrame: sendSessionOnOpen ?
      () => JSON.stringify({type: 'session', token}) :
      undefined
  });

  attachRealtimeHandlers(socket, apiUpdatesManager);

  const url = createBackendRealtimeUrl(baseUrl, token);
  const ready = socket.whenOpen();
  socket.connect(url);
  void ready.then(() => hydrateFromWsOnce());
}
