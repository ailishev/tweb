import backendAuthApi from '@lib/backendAuthApi';
import {getBackendBaseUrl} from '@lib/backendEnv';

export type BackendResponse<T> =
  | {ok: true; data: T}
  | {ok: false; error: string};

function getToken() {
  try {
    return localStorage.getItem('db_token') || '';
  } catch(err) {
    return '';
  }
}

// (keep backendAuthApi import to share base URL env var semantics if needed later)

async function request<T>(path: string, options: RequestInit = {}): Promise<BackendResponse<T>> {
  try {
    const baseUrl = getBackendBaseUrl();

    const token = getToken();
    const headers = new Headers(options.headers || {});
    if(!headers.has('content-type') && options.body) {
      headers.set('content-type', 'application/json');
    }
    if(token) {
      headers.set('authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${baseUrl}${path}`, {...options, headers});
    const data = await response.json().catch(() => ({}));
    if(!response.ok) {
      return {ok: false, error: data?.error || data?.message || `HTTP_${response.status}`};
    }
    return {ok: true, data};
  } catch(err) {
    return {ok: false, error: 'NETWORK_ERROR'};
  }
}

export default {
  me: () => request<any>('/user/me'),
  /** Paginated `{items, nextCursor, hasMore}` from backend. */
  chatsList: () => request<{items: any[], nextCursor?: string | null, hasMore?: boolean}>('/chats/list'),
  messagesPack: (chatId: string, limit = 80) =>
    request<{messages: any[], hasMore?: boolean}>(`/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`),
  /** @deprecated Prefer chatsList(); kept for callers expecting a bare array shape. */
  chats: async() => {
    const r = await request<{items: any[], nextCursor?: string | null, hasMore?: boolean}>('/chats/list');
    if(!r.ok) {
      return r as BackendResponse<any[]>;
    }
    const items = r.data?.items;
    return {ok: true as const, data: Array.isArray(items) ? items : []};
  },
  messages: (chatId: string) =>
    request<{messages: any[], hasMore?: boolean}>(`/chats/${encodeURIComponent(chatId)}/messages?limit=80`),
  sendMessage: (payload: {chatId: string, text: string}) => request<any>('/messages/send', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
};

