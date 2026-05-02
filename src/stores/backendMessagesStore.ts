import {createStore} from 'solid-js/store';

/** Canonical backend message shape (WebSocket / diagnostics). */
export type BackendWsMessage = {
  id: string,
  chatId: string,
  senderId: string,
  text: string,
  /** Unix epoch milliseconds */
  createdAt: number
};

export type BackendMessagesSnapshot = {
  /** Messages keyed by backend chat UUID */
  byChatId: Record<string, BackendWsMessage[]>
};

const [backendMessagesStore, setBackendMessagesStore] = createStore<BackendMessagesSnapshot>({
  byChatId: {}
});

export function appendBackendWsMessage(msg: BackendWsMessage) {
  setBackendMessagesStore('byChatId', msg.chatId, (prev) => [...(prev || []), msg]);
}

/** Replace history for a chat (e.g. after `getMessages` RPC). */
export function setBackendWsMessagesForChat(chatId: string, messages: BackendWsMessage[]) {
  setBackendMessagesStore('byChatId', chatId, [...messages]);
}

export default backendMessagesStore;
