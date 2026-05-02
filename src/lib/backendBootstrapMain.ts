import Modes from '@config/modes';
import backendApi from '@lib/backendApi';
import {mapBackendUser} from '@lib/backendMtprotoAdapter';
import {backendUuidToChatPeerId, backendUuidToUserPeerId} from '@lib/backendPeerIds';
import MTProtoMessagePort from '@lib/mainWorker/mainMessagePort';
import {getCurrentAccount} from '@lib/accounts/getCurrentAccount';
import {setBackendBootstrapFailed, setBackendBootstrapPayload} from '@stores/backendBootstrapStore';
import {setBackendWsMessagesForChat, type BackendWsMessage} from '@stores/backendMessagesStore';
import {reconcilePeer} from '@stores/peers';

/** Chat PeerId string key → backend chat UUID (for REST message fetch on open). */
const chatPeerKeyToBackendUuid = new Map<string, string>();
let backendSavedChatUuid: string | undefined;

function peerKey(peerId: PeerId) {
  return String(peerId);
}

export function rememberBackendChatPeersFromItems(items: unknown[], selfUserId?: string) {
  chatPeerKeyToBackendUuid.clear();
  backendSavedChatUuid = undefined;
  for(const raw of items) {
    const it = raw as {id?: string, type?: string};
    if(typeof it?.id !== 'string') {
      continue;
    }

    if(it.type === 'saved') {
      backendSavedChatUuid = it.id;
      if(selfUserId) {
        const selfPeerId = backendUuidToUserPeerId(selfUserId).toPeerId(false);
        chatPeerKeyToBackendUuid.set(peerKey(selfPeerId), it.id);
      }
      continue;
    }

    const pid = backendUuidToChatPeerId(it.id);
    chatPeerKeyToBackendUuid.set(peerKey(pid), it.id);
  }
}

export function getBackendChatUuidForPeer(peerId: PeerId): string | undefined {
  const direct = chatPeerKeyToBackendUuid.get(peerKey(peerId));
  if(direct) {
    return direct;
  }
  if(peerId?.isUser?.() && backendSavedChatUuid) {
    return backendSavedChatUuid;
  }
  return undefined;
}

function pickTrimmedString(...candidates: unknown[]): string {
  for(const c of candidates) {
    if(typeof c === 'string' && c.trim()) {
      return c.trim();
    }
  }

  return '';
}

function strictUserFromMe(meData: Record<string, unknown>) {
  const summary = (meData.summary && typeof meData.summary === 'object') ?
    meData.summary as Record<string, unknown> :
    {};
  const profile = (meData.profile && typeof meData.profile === 'object') ?
    meData.profile as Record<string, unknown> :
    {};
  const profileData = (meData.profileData && typeof meData.profileData === 'object') ?
    meData.profileData as Record<string, unknown> :
    {};
  const id = meData.id;
  const username = pickTrimmedString(
    profileData.username,
    summary.username,
    profile.username,
    meData.username,
    meData.handle
  );
  const usernamesRaw = (
    Array.isArray(profileData.usernames) ? profileData.usernames :
      (Array.isArray(profile.usernames) ? profile.usernames : undefined)
  );
  const usernames = Array.isArray(usernamesRaw) ?
    usernamesRaw.filter((it): it is string => typeof it === 'string' && !!it.trim()).map((it) => it.trim()) :
    [];
  const bio = pickTrimmedString(profileData.bio, profile.bio, meData.bio, meData.about, meData.description);
  const gifts = Array.isArray(meData.gifts) ? meData.gifts : [];
  return {
    id: typeof id === 'string' ? id : String(id || ''),
    username,
    usernames: usernames.length ? usernames : (username ? [username] : []),
    bio,
    about: bio,
    description: bio,
    avatar: pickTrimmedString(profileData.avatar, summary.avatar, profile.avatarUrl, meData.avatar),
    status: pickTrimmedString(profileData.status, summary.status, profile.status, meData.status),
    firstName: pickTrimmedString(profileData.firstName, profile.firstName, meData.firstName),
    lastName: pickTrimmedString(profileData.lastName, profile.lastName, meData.lastName),
    phone: pickTrimmedString(profileData.phoneNumber, meData.phone),
    phoneNumber: pickTrimmedString(profileData.phoneNumber, profile.phoneNumber, meData.phone),
    verified: !!(profileData.verified ?? profileData.isVerified ?? profile.verified ?? profile.isVerified ?? meData.verified ?? meData.isVerified),
    lastSeen: profileData.lastSeen ?? profile.lastSeen ?? meData.lastSeen ?? null,
    birthday: profileData.birthday ?? profile.birthday ?? null,
    location: profileData.location ?? profile.location ?? null,
    businessHours: profileData.businessHours ?? profile.businessHours ?? null,
    businessLocation: profileData.businessLocation ?? profile.businessLocation ?? null,
    link: pickTrimmedString(profileData.link, profile.link),
    contactNote: pickTrimmedString(profileData.contactNote, profile.contactNote),
    savedMusic: profileData.savedMusic ?? profile.savedMusic ?? null,
    gifts,
    isPremium: !!(profileData.isPremium ?? profile.isPremium ?? meData.isPremium)
  };
}

/** Solid `peers` store is main-thread-only; hydrate self immediately so profile/header can render. */
function mirrorBackendSelfPeerOnMain(meData: Record<string, unknown>) {
  const idVal = meData.id;
  const uid = typeof idVal === 'string' ? idVal : String(idVal || '');
  if(!uid) {
    return;
  }

  reconcilePeer(backendUuidToUserPeerId(uid).toPeerId(false), mapBackendUser({...meData, id: uid}, {self: true}) as any);
}

function normalizeChatType(t: unknown): string {
  if(t === 'channel') {
    return 'group';
  }
  if(t === 'saved') {
    return 'private';
  }
  return typeof t === 'string' ? t : 'private';
}

/** Map GET /chats/list item → shape expected by `hydrateBackendWsBootstrap`. */
export function normalizeChatListItemForHydrate(item: Record<string, unknown>) {
  const lm = item.lastMessage as Record<string, unknown> | null | undefined;
  const uid = typeof item.id === 'string' ? item.id : '';
  return {
    id: uid,
    title: (typeof item.title === 'string' && item.title.trim()) ? item.title.trim() : 'Chat',
    type: normalizeChatType(item.type),
    createdAt: item.createdAt ?? new Date(),
    members: Array.isArray(item.members) ? item.members : [],
    lastMessage: lm && typeof lm === 'object' && lm.id != null ? {
      id: String(lm.id),
      senderId: typeof lm.senderId === 'string' ? lm.senderId : uid,
      text: typeof lm.text === 'string' ? lm.text : '',
      createdAt: lm.createdAt ?? Date.now()
    } : null,
    unreadCount: typeof item.unreadCount === 'number' ? item.unreadCount : 0
  };
}

function prismaMessagesToBackendStore(chatId: string, rows: any[]): BackendWsMessage[] {
  return rows.map((m) => ({
    id: String(m?.id ?? ''),
    chatId,
    senderId: String(m?.senderId ?? ''),
    text: typeof m?.text === 'string' ? m.text : '',
    createdAt: m?.createdAt ? new Date(m.createdAt).getTime() : Date.now()
  }));
}

let mainBootstrapRan = false;
/** Worker received hydrated dialogs from REST main bootstrap successfully. WS may skip repeating getChats/hydrate. */
let mainBootstrapWorkerOk = false;

export function shouldSkipBackendWsBootstrapHydrate() {
  return mainBootstrapWorkerOk;
}

/**
 * REST bootstrap on **main thread** after worker states load.
 * Keeps `@stores/backendBootstrapStore` in sync and hydrates dialogs in the worker.
 */
export async function runBackendMainDataBootstrap(): Promise<void> {
  if(!Modes.backend) {
    return;
  }

  if(mainBootstrapRan) {
    return;
  }

  let token = '';
  try {
    token = localStorage.getItem('db_token') || '';
  } catch(err) {}

  if(!token) {
    setBackendBootstrapFailed('NO_TOKEN');
    return;
  }

  mainBootstrapRan = true;
  mainBootstrapWorkerOk = false;

  try {
    console.log('[backend] getCurrentUser called');
    const meRes = await backendApi.me();
    if(!meRes.ok || !meRes.data || typeof meRes.data !== 'object') {
      setBackendBootstrapFailed(meRes.ok === false ? meRes.error : 'ME_FAILED');
      return;
    }

    console.log('[backend] getChats called');
    const chatsRes = await backendApi.chatsList();
    if(chatsRes.ok === false) {
      setBackendBootstrapFailed(chatsRes.error);
      const strictMe = strictUserFromMe(meRes.data as Record<string, unknown>);
      setBackendBootstrapPayload(strictMe, []);
      mirrorBackendSelfPeerOnMain(meRes.data as Record<string, unknown>);
      rememberBackendChatPeersFromItems([], strictMe.id);
      await MTProtoMessagePort.getInstance<true>().invoke('manager', {
        name: 'appMessagesManager',
        method: 'hydrateBackendWsBootstrap',
        args: [strictMe, []],
        accountNumber: getCurrentAccount()
      });
      mainBootstrapWorkerOk = true;
      return;
    }

    const items = Array.isArray(chatsRes.data?.items) ? chatsRes.data.items : [];
    const strictMe = strictUserFromMe(meRes.data as Record<string, unknown>);
    const strictChats = items.map((it: Record<string, unknown>) => normalizeChatListItemForHydrate(it));

    setBackendBootstrapPayload(strictMe, items);
    mirrorBackendSelfPeerOnMain(meRes.data as Record<string, unknown>);
    rememberBackendChatPeersFromItems(items, strictMe.id);

    await MTProtoMessagePort.getInstance<true>().invoke('manager', {
      name: 'appMessagesManager',
      method: 'hydrateBackendWsBootstrap',
      args: [strictMe, strictChats],
      accountNumber: getCurrentAccount()
    });
    mainBootstrapWorkerOk = true;
  } catch(err) {
    console.error('[backend] runBackendMainDataBootstrap', err);
    setBackendBootstrapFailed(err instanceof Error ? err.message : 'BOOTSTRAP_ERROR');
  }
}

/**
 * When user opens a chat: pull history from REST and merge into worker storage + Solid store.
 */
export async function prefetchBackendHistoryForOpenedChat(peerId: PeerId): Promise<void> {
  if(!Modes.backend || !peerId || (!peerId.isAnyChat() && !peerId.isUser())) {
    return;
  }

  const chatUuid = getBackendChatUuidForPeer(peerId);
  if(!chatUuid) {
    return;
  }

  console.log('[backend] getMessages called', chatUuid);
  const pack = await backendApi.messagesPack(chatUuid, 80);
  if(!pack.ok || !pack.data) {
    return;
  }

  const rows = Array.isArray(pack.data.messages) ? pack.data.messages : [];
  setBackendWsMessagesForChat(chatUuid, prismaMessagesToBackendStore(chatUuid, rows));

  await MTProtoMessagePort.getInstance<true>().invoke('manager', {
    name: 'appMessagesManager',
    method: 'applyBackendFetchedMessages',
    args: [chatUuid, rows],
    accountNumber: getCurrentAccount()
  });
}
