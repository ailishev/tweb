import {getBackendBaseUrl} from '@lib/backendEnv';

type BackendAuthRequest = Record<string, unknown>;

type BackendAuthResponse = {
  ok: boolean,
  data?: any,
  error?: string
};

function getAuthApiBaseUrl() {
  return getBackendBaseUrl();
}

async function request(paths: string[], body: BackendAuthRequest): Promise<BackendAuthResponse> {
  const baseUrl = getAuthApiBaseUrl();
  let lastError = 'NETWORK_ERROR';

  for(const path of paths) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body)
      });

      const data = await response.json().catch(() => ({}));
      if(response.status === 404) {
        lastError = 'HTTP_404';
        continue;
      }

      if(!response.ok) {
        return {
          ok: false,
          error: data?.error || data?.message || `HTTP_${response.status}`
        };
      }

      return {ok: true, data};
    } catch(err) {
      lastError = 'NETWORK_ERROR';
    }
  }

  return {ok: false, error: lastError};
}

export default {
  sendCode: (phoneNumber: string) => {
    return request(['/auth/request-otp', '/api/auth/send-code'], {
      phone: phoneNumber,
      phone_number: phoneNumber
    });
  },
  verifyCode: (payload: {phone_number: string, phone_code_hash?: string, phone_code: string, verify_token?: string}) => {
    return request(['/auth/verify-otp', '/api/auth/verify-code'], {
      phone: payload.phone_number,
      code: payload.phone_code,
      ...payload
    });
  },
  completeProfile: (payload: {phone_number: string, phone_code: string, first_name: string, last_name?: string}) => {
    return request(['/auth/complete-profile', '/api/auth/complete-profile'], {
      phone: payload.phone_number,
      code: payload.phone_code,
      firstName: payload.first_name,
      lastName: payload.last_name,
      ...payload
    });
  },
  signUp: (payload: {
    phone_number: string,
    phone_code_hash?: string,
    verify_token?: string,
    first_name: string,
    last_name?: string
  }) => {
    return request(['/auth/register', '/api/auth/register'], {
      phone: payload.phone_number,
      firstName: payload.first_name,
      lastName: payload.last_name,
      ...payload
    });
  },
  signIn: (payload: {phone_number: string, phone_code_hash?: string, verify_token?: string}) => {
    return request(['/auth/login', '/api/auth/login'], {
      phone: payload.phone_number,
      ...payload
    });
  }
};
