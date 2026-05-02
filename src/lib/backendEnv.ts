/**
 * Shared backend base URL for REST + WebSocket session sync (main thread + worker).
 */
export function getBackendBaseUrl(): string {
  const envUrl = (import.meta.env?.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') || '';
  if(envUrl) {
    return envUrl;
  }

  if(typeof location !== 'undefined') {
    if(location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    return `${location.protocol}//${location.hostname}:3001`;
  }

  return '';
}

export function isBackendDataDebug(): boolean {
  return import.meta.env.VITE_DEBUG_BACKEND === '1' || import.meta.env.VITE_DEBUG_BACKEND === 'true';
}

export function backendDataLog(...args: unknown[]): void {
  if(isBackendDataDebug()) {
    console.log('[backend-data]', ...args);
  }
}
