import {createStore} from 'solid-js/store';

export type BackendBootstrapSnapshot = {
  currentUser: Record<string, unknown> | null,
  chats: unknown[],
  /** True after main-thread REST bootstrap attempted (success or fail). */
  bootstrapAttempted: boolean,
  /** Last bootstrap error message for empty-state debugging. */
  bootstrapError: string | null
};

const [backendBootstrapStore, setBackendBootstrapStoreInner] = createStore<BackendBootstrapSnapshot>({
  currentUser: null,
  chats: [],
  bootstrapAttempted: false,
  bootstrapError: null
});

/** Snapshot from REST/WS bootstrap (profile UI + diagnostics + empty states). */
export function setBackendBootstrapPayload(user: unknown, chats: unknown[]) {
  setBackendBootstrapStoreInner({
    currentUser: user && typeof user === 'object' ? user as Record<string, unknown> : null,
    chats: Array.isArray(chats) ? chats : [],
    bootstrapAttempted: true,
    bootstrapError: null
  });
}

export function setBackendBootstrapFailed(message: string) {
  setBackendBootstrapStoreInner({
    bootstrapAttempted: true,
    bootstrapError: message
  });
}

export default backendBootstrapStore;
