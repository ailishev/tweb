let backendToken = '';
let backendBaseUrl = '';

export function setBackendWorkerSession(payload: {token: string, baseUrl: string}) {
  backendToken = payload.token || '';
  backendBaseUrl = (payload.baseUrl || '').replace(/\/$/, '');
}

export function getBackendWorkerSession() {
  return {
    token: backendToken,
    baseUrl: backendBaseUrl
  };
}
