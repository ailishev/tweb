import type {ApiManager} from '@appManagers/apiManager';
import type {
  Chat,
  ChatFull,
  ChatParticipant,
  Config,
  Dialog,
  Message,
  Peer,
  PeerNotifySettings,
  User,
  UserFull
} from '@layer';
import type {MethodDeclMap} from '@layer';
import type {InvokeApiOptions} from '@types';
import deferredPromise, {CancellablePromise} from '@helpers/cancellablePromise';
import makeError from '@helpers/makeError';
import {FOLDER_ID_ALL, NULL_PEER_ID} from '@appManagers/constants';
import {getBackendWorkerSession} from '@lib/backendWorkerSession';
import {
  backendMessageMid,
  backendUuidToChatPeerId,
  backendUuidToUserPeerId
} from '@lib/backendPeerIds';
import {backendDataLog} from '@lib/backendEnv';

/** Access managers from ApiManager without TS protected errors (adapter runs inside ApiManager). */
function mgr(api: ApiManager): any {
  return api;
}

const backendChatIdByPeer = new Map<PeerId, string>();
const backendUserIdByPeer = new Map<PeerId, string>();
const midToBackendMsgId = new Map<string, string>();

let cachedChatRows: any[] = [];
let selfBackendUserId: string | null = null;

export function getBackendChatIdForPeer(peerId: PeerId): string | undefined {
  return backendChatIdByPeer.get(peerId);
}

export function rememberChatPeer(peerId: PeerId, backendId: string) {
  backendChatIdByPeer.set(peerId, backendId);
}

export function rememberUserPeer(peerId: PeerId, backendId: string) {
  backendUserIdByPeer.set(peerId, backendId);
}

function registerMid(chatBackendId: string, mid: number, msgBackendId: string) {
  midToBackendMsgId.set(`${chatBackendId}:${mid}`, msgBackendId);
}

function deriveUsernameHandle(u: any): string | undefined {
  const fromProfile = u.profile?.username ?? u.summary?.username;
  if(fromProfile != null && String(fromProfile).trim()) {
    return String(fromProfile).trim().replace(/^@/, '');
  }
  const phone = u.phone || u.profile?.phoneNumber;
  if(phone) {
    const digits = String(phone).replace(/\D/g, '');
    if(digits.length) {
      return `u${digits.slice(-12)}`;
    }
  }
  return undefined;
}

export function mapBackendUser(u: any, flags?: {self?: boolean}): User.user {
  const id = backendUuidToUserPeerId(u.id);
  rememberUserPeer(id.toPeerId(false), u.id);
  const pFlags: User.user['pFlags'] = {};
  if(flags?.self) {
    pFlags.self = true;
  }

  const firstNameRaw = u.profile?.firstName ?? '';
  const lastNameRaw = u.profile?.lastName ?? '';
  const displayFirst = firstNameRaw || (u.phone ? String(u.phone) : 'User');

  return {
    _: 'user',
    pFlags,
    id,
    first_name: displayFirst,
    last_name: lastNameRaw,
    username: deriveUsernameHandle(u),
    phone: u.phone || u.profile?.phoneNumber || undefined,
    status: {_: 'userStatusRecently', pFlags: {}}
  };
}

function makeFallbackUserFromId(uid: UserId, self = false): User.user {
  const pFlags: User.user['pFlags'] = {};
  if(self) {
    pFlags.self = true;
  }

  return {
    _: 'user',
    pFlags,
    id: uid,
    first_name: '',
    last_name: '',
    status: {_: 'userStatusRecently', pFlags: {}}
  };
}

/** Normalize REST/WS timestamps to Unix seconds (handles numeric seconds vs ms vs ISO). */
export function backendCreatedAtToUnixSeconds(raw: unknown): number {
  if(raw === undefined || raw === null) {
    return Math.floor(Date.now() / 1000);
  }
  if(typeof raw === 'number') {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return Math.floor(ms / 1000);
  }
  const t = new Date(raw as string).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
}

function mapBackendChat(chat: any): Chat.chat {
  const peerId = backendUuidToChatPeerId(chat.id);
  rememberChatPeer(peerId, chat.id);
  const title = chat.title || 'Chat';
  const memberCount = chat.members?.length || 1;
  return {
    _: 'chat',
    pFlags: {},
    id: peerId.toChatId(),
    title,
    photo: {_: 'chatPhotoEmpty'},
    participants_count: memberCount,
    date: backendCreatedAtToUnixSeconds(chat.createdAt ?? Date.now()),
    version: 1
  };
}

function defaultNotify(): PeerNotifySettings.peerNotifySettings {
  return {_: 'peerNotifySettings'};
}

function peerChatFromPeerId(peerId: PeerId): Peer.peerChat {
  return {_: 'peerChat', chat_id: peerId.toChatId()};
}

export function buildMessageFromBackend(row: any, chatBackendId: string, api: ApiManager): Message.message {
  const peerId = backendUuidToChatPeerId(chatBackendId);
  const fromPid = backendUuidToUserPeerId(row.senderId);
  rememberUserPeer(fromPid.toPeerId(false), row.senderId);
  const mid = backendMessageMid(chatBackendId, row.id);
  registerMid(chatBackendId, mid, row.id);
  const selfP = mgr(api).appPeersManager.peerId;
  const out = !!selfP && fromPid === selfP;
  return {
    _: 'message',
    pFlags: out ? {out: true} : {},
    id: mid,
    mid,
    from_id: {_: 'peerUser', user_id: fromPid},
    peer_id: peerChatFromPeerId(peerId),
    date: backendCreatedAtToUnixSeconds(row.createdAt),
    message: row.text || ''
  };
}

function buildDialogForChat(chatRow: any, lastMsg: any): Dialog.dialog {
  const peerId = backendUuidToChatPeerId(chatRow.id);
  const unread = +chatRow.unreadCount || 0;
  const mid = backendMessageMid(chatRow.id, lastMsg.id);
  const readInbox = mid;

  return {
    _: 'dialog',
    pFlags: {},
    folder_id: FOLDER_ID_ALL,
    peer: peerChatFromPeerId(peerId),
    top_message: mid,
    read_inbox_max_id: readInbox,
    read_outbox_max_id: readInbox,
    unread_count: unread,
    unread_mentions_count: 0,
    unread_reactions_count: 0,
    notify_settings: defaultNotify(),
    peerId
  };
}

/** Local stub so `dialogsStorage.applyDialogs` never sees `top_message === 0` (those rows are dropped). */
function stubLastMessageRowForEmptyChat(chatBackendId: string, selfBackendId: string) {
  return {
    id: `__backend_empty__:${chatBackendId}`,
    senderId: selfBackendId,
    createdAt: Date.now(),
    text: ''
  };
}

/** Build `messages.dialogsSlice` from REST/WS-shaped chat rows (worker hydration). */
export function buildDialogsSliceFromBackendChatRows(rows: any[], me: any, api: ApiManager) {
  const dialogs: Dialog.dialog[] = [];
  const messages: Message.message[] = [];
  const chats: Chat.chat[] = [];
  const users: User.user[] = [];
  const seenUsers = new Set<string>();
  const selfId = typeof me?.id === 'string' ? me.id : '';

  users.push(mapBackendUser(me, {self: true}));
  seenUsers.add(me.id);

  for(const chat of rows) {
    chats.push(mapBackendChat(chat));
    for(const m of chat.members || []) {
      const u = m.user;
      if(u && !seenUsers.has(u.id)) {
        seenUsers.add(u.id);
        users.push(mapBackendUser(u));
      }
    }

    const lmRaw = chat.lastMessage;
    const lm = (lmRaw && typeof lmRaw === 'object' && lmRaw.id != null && String(lmRaw.id).trim() !== '') ?
      lmRaw :
      (selfId ? stubLastMessageRowForEmptyChat(String(chat.id), selfId) : null);
    if(lm) {
      messages.push(buildMessageFromBackend(lm, chat.id, api));
      dialogs.push(buildDialogForChat(chat, lm));
    }
  }

  return {
    _: 'messages.dialogsSlice',
    count: dialogs.length,
    dialogs,
    messages,
    chats,
    users
  };
}

async function backendFetch(path: string, init: RequestInit = {}): Promise<any> {
  const {token, baseUrl} = getBackendWorkerSession();
  if(!baseUrl) {
    throw makeError('UNKNOWN');
  }
  const headers = new Headers(init.headers);
  if(!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }
  if(token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const tryFetch = async(basePath: string) => {
    const res = await fetch(`${baseUrl}${basePath}`, {...init, headers});
    const data = await res.json().catch(() => ({}));
    if(!res.ok) {
      throw makeError('NETWORK_BAD_RESPONSE');
    }
    return data;
  };

  try {
    return await tryFetch(path);
  } catch(firstErr) {
    if(path.startsWith('/api/')) {
      throw firstErr;
    }
    try {
      return await tryFetch(`/api${path}`);
    } catch(_e) {
      throw firstErr;
    }
  }
}

async function ensureSelf(api: ApiManager): Promise<string> {
  if(selfBackendUserId) {
    return selfBackendUserId;
  }
  const me = await backendFetch('/user/me');
  selfBackendUserId = me.id;
  rememberUserPeer(backendUuidToUserPeerId(me.id).toPeerId(false), me.id);
  const mapped = mapBackendUser(me, {self: true});
  mgr(api).appUsersManager.saveApiUsers([mapped]);
  backendDataLog('currentUser loaded', me.id, mapped.username, mapped.first_name);
  return selfBackendUserId;
}

async function loadAllChats(): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | null | undefined = undefined;
  for(;;) {
    const qs =
      cursor ?
        `?cursor=${encodeURIComponent(cursor)}&limit=50` :
        '?limit=50';
    const page = await backendFetch(`/chats/list${qs}`);
    items.push(...(page.items || []));
    cursor = page.nextCursor;
    if(!cursor) {
      break;
    }
  }
  cachedChatRows = items;
  backendDataLog('chats loaded', items.length);
  return items;
}

function syntheticConfig(): Config.config {
  const now = Math.floor(Date.now() / 1000);
  return {
    _: 'config',
    pFlags: {},
    date: now,
    expires: now + 3600,
    test_mode: false,
    this_dc: 2,
    dc_options: [{
      _: 'dcOption',
      pFlags: {},
      id: 2,
      ip_address: '127.0.0.1',
      port: 443
    }],
    dc_txt_domain_name: '',
    chat_size_max: 200,
    megagroup_size_max: 200000,
    forwarded_count_max: 100,
    online_update_period_ms: 21000,
    offline_blur_timeout_ms: 5000,
    offline_idle_timeout_ms: 30000,
    online_cloud_timeout_ms: 300000,
    notify_cloud_delay_ms: 30000,
    notify_default_delay_ms: 15000,
    push_chat_period_ms: 60000,
    push_chat_limit: 2,
    edit_time_limit: 172800,
    revoke_time_limit: 2147483647,
    revoke_pm_time_limit: 2147483647,
    rating_e_decay: 2419200,
    stickers_recent_limit: 200,
    channels_read_media_period: 604800,
    call_receive_timeout_ms: 20000,
    call_ring_timeout_ms: 90000,
    call_connect_timeout_ms: 30000,
    call_packet_timeout_ms: 10000,
    me_url_prefix: 'https://',
    caption_length_max: 1024,
    message_length_max: 4096,
    webfile_dc_id: 2,
    reactions_default: {_: 'reactionEmoji', emoticon: '👍'}
  };
}

function inputPeerToPeerId(peer: AnyLiteral | undefined, api: ApiManager): PeerId {
  if(!peer) return NULL_PEER_ID;
  switch(peer._) {
    case 'inputPeerSelf':
      return mgr(api).appPeersManager.peerId;
    case 'inputPeerUser':
      return peer.user_id.toPeerId(false);
    case 'inputPeerChat':
      return peer.chat_id.toPeerId(true);
    case 'inputPeerChannel':
      return peer.channel_id.toPeerId(true);
    default:
      return NULL_PEER_ID;
  }
}

type AnyLiteral = Record<string, any>;

async function findMessageIsoDate(chatBackendId: string, msgBackendId: string): Promise<string | undefined> {
  try {
    const pack = await backendFetch(`/chats/${encodeURIComponent(chatBackendId)}/messages?limit=80`);
    const hit = (pack.messages || []).find((m: any) => m.id === msgBackendId);
    return hit ? new Date(hit.createdAt).toISOString() : undefined;
  } catch(_e) {
    return undefined;
  }
}

async function invokeBackendApiInner<T>(method: keyof MethodDeclMap, params: any, api: ApiManager): Promise<T> {
  switch(method) {
    case 'help.getConfig':
      return syntheticConfig() as T;

    case 'help.getNearestDc':
      return {
        _: 'nearestDc',
        country: 'US',
        this_dc: 2,
        nearest_dc: 2
      } as T;

    case 'help.getAppConfig': {
      const hash = params?.hash || 0;
      return {
        _: 'help.appConfig',
        config: {
          hash,
          pinned_orders: {dialogs: [], archived: []},
          dialogs_pinned_limit_default: 5,
          dialogs_pinned_limit_premium: 10
        } as any,
        hash
      } as T;
    }

    case 'updates.getState': {
      const st = mgr(api).apiUpdatesManager.updatesState;
      return {
        _: 'updates.state',
        pts: st.pts || 1000,
        qts: 0,
        date: st.date || Math.floor(Date.now() / 1000),
        seq: st.seq || 1,
        unread_count: 0
      } as T;
    }

    case 'updates.getDifference':
      return {
        _: 'updates.differenceEmpty',
        date: Math.floor(Date.now() / 1000),
        seq: mgr(api).apiUpdatesManager.updatesState.seq || 1
      } as T;

    case 'contacts.getContacts':
      await ensureSelf(api);
      return {
        _: 'contacts.contacts',
        contacts: [],
        users: [],
        saved_count: 0
      } as T;

    case 'account.updateStatus':
      return true as T;

    case 'users.getUsers': {
      await ensureSelf(api);
      const ids = (params?.id || []) as any[];
      const users: User[] = [];
      for(const input of ids) {
        if(input?._ === 'inputUserSelf') {
          const me = await backendFetch('/user/me');
          users.push(mapBackendUser(me, {self: true}));
          continue;
        }
        const uid = input?.user_id as UserId | undefined;
        if(!uid) continue;

        let bid = backendUserIdByPeer.get(uid.toPeerId(false));
        if(!bid && uid === mgr(api).appPeersManager.peerId) {
          const me = await backendFetch('/user/me');
          bid = me.id;
          rememberUserPeer(uid.toPeerId(false), bid);
        }
        if(!bid) {
          users.push({_:'userEmpty', id: uid} as User.userEmpty);
          continue;
        }
        const u = await backendFetch(`/user/${encodeURIComponent(bid)}`);
        users.push(mapBackendUser(u));
      }
      return users as T;
    }

    case 'messages.getDialogs': {
      await ensureSelf(api);
      if(params.folder_id && params.folder_id !== 0) {
        return {
          _: 'messages.dialogsSlice',
          count: 0,
          dialogs: [],
          messages: [],
          chats: [],
          users: []
        } as T;
      }

      const rows = await loadAllChats();
      const dialogs: Dialog.dialog[] = [];
      const messages: Message.message[] = [];
      const chats: Chat.chat[] = [];
      const users: User.user[] = [];
      const seenUsers = new Set<string>();

      const me = await backendFetch('/user/me');
      users.push(mapBackendUser(me, {self: true}));
      seenUsers.add(me.id);

      for(const chat of rows) {
        chats.push(mapBackendChat(chat));
        for(const m of chat.members || []) {
          const u = m.user;
          if(u && !seenUsers.has(u.id)) {
            seenUsers.add(u.id);
            users.push(mapBackendUser(u));
          }
        }

        const lm = chat.lastMessage;
        if(lm) {
          messages.push(buildMessageFromBackend(lm, chat.id, api));
        }

        dialogs.push(buildDialogForChat(chat, lm || null));
      }

      backendDataLog('dialogs slice', dialogs.length, 'messages', messages.length);
      return {
        _: 'messages.dialogsSlice',
        count: dialogs.length,
        dialogs,
        messages,
        chats,
        users
      } as T;
    }

    case 'messages.getPeerDialogs': {
      await ensureSelf(api);
      const peers = params.peers || [];
      const want = new Set<string>();
      for(const p of peers) {
        const peer = p?.peer?.peer;
        if(peer?._ === 'peerChat') {
          const pid = peer.chat_id.toPeerId(true);
          const bid = backendChatIdByPeer.get(pid);
          if(bid) want.add(bid);
        }
      }

      const rows =
        cachedChatRows.length ?
          cachedChatRows.filter((r) => want.has(r.id)) :
          (await loadAllChats()).filter((r) => want.has(r.id));

      const dialogs: Dialog.dialog[] = [];
      const messages: Message.message[] = [];
      const chats: Chat.chat[] = [];
      const users: User.user[] = [];
      const me = await backendFetch('/user/me');
      users.push(mapBackendUser(me, {self: true}));

      for(const chat of rows) {
        chats.push(mapBackendChat(chat));
        for(const m of chat.members || []) {
          const u = m.user;
          if(u) users.push(mapBackendUser(u));
        }
        const lm = chat.lastMessage;
        if(lm) messages.push(buildMessageFromBackend(lm, chat.id, api));
        dialogs.push(buildDialogForChat(chat, lm || null));
      }

      const st = mgr(api).apiUpdatesManager.updatesState;
      return {
        _: 'messages.peerDialogs',
        dialogs,
        messages,
        chats,
        users,
        state: {
          _: 'updates.state',
          pts: st.pts || 1000,
          qts: 0,
          date: st.date || Math.floor(Date.now() / 1000),
          seq: st.seq || 1,
          unread_count: 0
        }
      } as T;
    }

    case 'messages.getHistory': {
      await ensureSelf(api);
      const peerId = inputPeerToPeerId(params.peer, api);
      const bid = backendChatIdByPeer.get(peerId);
      if(!bid) {
        return {
          _: 'messages.messagesSlice',
          count: 0,
          messages: [],
          chats: [],
          users: [],
          topics: []
        } as T;
      }

      const limit = Math.min(Math.max(params.limit || 30, 1), 100);
      const qs = new URLSearchParams();
      qs.set('limit', String(limit));
      if(params.offset_id) {
        const mb = midToBackendMsgId.get(`${bid}:${params.offset_id}`);
        if(mb) {
          const iso = await findMessageIsoDate(bid, mb);
          if(iso) qs.set('before', iso);
        }
      }

      const pack = await backendFetch(`/chats/${encodeURIComponent(bid)}/messages?${qs.toString()}`);
      const rows = pack.messages || [];
      const chatObj = mapBackendChat({id: bid, title: 'Chat', createdAt: new Date(), members: []});
      const me = await backendFetch('/user/me');
      const usersMap = new Map<string, User.user>();
      usersMap.set(me.id, mapBackendUser(me, {self: true}));
      for(const row of rows) {
        const s = row.sender;
        if(s?.id && !usersMap.has(s.id)) {
          usersMap.set(s.id, mapBackendUser(s));
        }
      }
      const usersArr = [...usersMap.values()];
      const msgs = rows.map((row: any) => buildMessageFromBackend(row, bid, api));
      backendDataLog('messages loaded', bid, msgs.length, 'users', usersArr.length);

      return {
        _: 'messages.messagesSlice',
        count: msgs.length,
        messages: msgs,
        chats: [chatObj],
        users: usersArr,
        topics: []
      } as T;
    }

    case 'messages.sendMessage': {
      await ensureSelf(api);
      const peerId = inputPeerToPeerId(params.peer, api);
      const bid = backendChatIdByPeer.get(peerId);
      if(!bid) {
        throw makeError('PEER_ID_INVALID');
      }

      const created = await backendFetch('/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          chatId: bid,
          text: params.message || ''
        })
      });

      const msg = buildMessageFromBackend(created, bid, api);
      const chatObj = mapBackendChat({id: bid, title: 'Chat', createdAt: new Date(), members: []});
      const me = await backendFetch('/user/me');
      const st = mgr(api).apiUpdatesManager.updatesState;
      const nextPts = (st.pts || 1000) + 1;

      return {
        _: 'updates',
        updates: [{
          _: 'updateNewMessage',
          message: msg,
          pts: nextPts,
          pts_count: 1
        }],
        users: [mapBackendUser(me, {self: true})],
        chats: [chatObj],
        date: Math.floor(Date.now() / 1000),
        seq: st.seq || 1
      } as T;
    }

    case 'messages.readHistory': {
      await ensureSelf(api);
      const peerId = inputPeerToPeerId(params.peer, api);
      const bid = backendChatIdByPeer.get(peerId);
      if(!bid) {
        return {_:'messages.affectedMessages', pts: mgr(api).apiUpdatesManager.updatesState.pts, pts_count: 0} as T;
      }
      await backendFetch(`/chats/${encodeURIComponent(bid)}/read`, {method: 'POST', body: '{}'});
      const pts = (mgr(api).apiUpdatesManager.updatesState.pts || 1000) + 1;
      return {_:'messages.affectedMessages', pts, pts_count: 1} as T;
    }

    case 'channels.readHistory':
      return true as T;

    case 'messages.getMessages':
      return {_:'messages.messages', messages: [], chats: [], users: [], topics: []} as T;

    case 'users.getFullUser': {
      await ensureSelf(api);
      const input = params.id;
      let uid = input?.user_id as UserId | undefined;
      let isSelf = false;
      if(input?._ === 'inputUserSelf') {
        uid = mgr(api).appPeersManager.peerId;
        isSelf = true;
      }
      if(!uid) {
        return {
          _: 'users.userFull',
          full_user: {
            _: 'userFull',
            pFlags: {},
            id: 0 as UserId,
            about: '',
            settings: {_:'peerSettings', pFlags: {}},
            notify_settings: defaultNotify(),
            common_chats_count: 0
          },
          chats: [],
          users: []
        } as T;
      }

      let bid = backendUserIdByPeer.get(uid.toPeerId(false));
      if(!bid) {
        try {
          const me = await backendFetch('/user/me');
          if(backendUuidToUserPeerId(me.id) === uid) {
            bid = me.id;
            isSelf = true;
          }
        } catch(_e) {
          // Keep fallback path below.
        }
      }

      let u: any | undefined;
      if(isSelf) {
        try {
          u = await backendFetch('/user/me/full');
        } catch(_e) {
          // Fall back to id-based full endpoint or synthetic.
        }
      }
      if(!u && bid) {
        try {
          u = await backendFetch(`/user/${encodeURIComponent(bid)}/full`);
        } catch(_e) {
          // Fall through to synthetic profile below.
        }
      }

      const user = u ? mapBackendUser(u, {self: isSelf}) : makeFallbackUserFromId(uid, isSelf);

      const fullUser: UserFull.userFull = {
        _: 'userFull',
        pFlags: {},
        id: user.id,
        about: u?.profile?.bio || u?.profile?.status || u?.summary?.status || '',
        settings: {_:'peerSettings', pFlags: {}},
        notify_settings: defaultNotify(),
        common_chats_count: 0
      };

      return {
        _: 'users.userFull',
        full_user: fullUser,
        chats: [],
        users: [user]
      } as T;
    }

    case 'messages.getFullChat': {
      await ensureSelf(api);
      const chatId = params.chat_id as ChatId;
      const peerId = chatId.toPeerId(true);
      const bid = backendChatIdByPeer.get(peerId);
      if(!bid) {
        const emptyChat: Chat.chat = {
          _: 'chat',
          pFlags: {},
          id: chatId,
          title: 'Chat',
          photo: {_: 'chatPhotoEmpty'},
          participants_count: 0,
          date: Math.floor(Date.now() / 1000),
          version: 1
        };

        const emptyFull: ChatFull.chatFull = {
          _: 'chatFull',
          pFlags: {},
          id: chatId,
          about: '',
          participants: {
            _: 'chatParticipants',
            chat_id: chatId,
            participants: [],
            version: 1
          },
          notify_settings: defaultNotify()
        };

        return {
          _: 'messages.chatFull',
          full_chat: emptyFull,
          chats: [emptyChat],
          users: []
        } as T;
      }

      const raw = await backendFetch(`/chats/${encodeURIComponent(bid)}/full`);
      const chatObj = mapBackendChat(raw);
      const users: User.user[] = [];
      const participants: ChatParticipant.chatParticipant[] = [];

      for(const m of raw.members || []) {
        const u = m.user;
        if(!u) continue;
        users.push(mapBackendUser(u));
        participants.push({
          _: 'chatParticipant',
          user_id: backendUuidToUserPeerId(u.id),
          inviter_id: backendUuidToUserPeerId(u.id),
          date: Math.floor(Date.now() / 1000)
        });
      }

      const fullChat: ChatFull.chatFull = {
        _: 'chatFull',
        pFlags: {},
        id: chatObj.id,
        about: '',
        participants: {
          _: 'chatParticipants',
          chat_id: chatObj.id,
          participants,
          version: 1
        },
        notify_settings: defaultNotify()
      };

      return {
        _: 'messages.chatFull',
        full_chat: fullChat,
        chats: [chatObj],
        users
      } as T;
    }

    default:
      console.warn('[backend] unsupported MTProto method:', method);
      throw makeError('UNKNOWN', String(method));
  }
}

export function invokeBackendApi<T extends keyof MethodDeclMap>(
  method: T,
  params: MethodDeclMap[T]['req'],
  api: ApiManager,
  _options?: InvokeApiOptions
): CancellablePromise<MethodDeclMap[T]['res']> {
  void _options;
  const def = deferredPromise<MethodDeclMap[T]['res']>();
  invokeBackendApiInner(method, params || {}, api).then(def.resolve.bind(def), def.reject.bind(def));
  return def as any;
}
