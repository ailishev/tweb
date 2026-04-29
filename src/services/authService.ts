import {apiClient} from '@/services/apiClient';

export const authService = {
  requestOtp: (phone: string) => apiClient.request('/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({phone})
  }),
  verifyOtp: async(phone: string, code: string) => {
    const result = await apiClient.request<{token: string}>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({phone, code})
    });
    localStorage.setItem('session_token', result.token);
    return result;
  },
  logout: async() => {
    await apiClient.request('/auth/logout', {method: 'POST'});
    localStorage.removeItem('session_token');
  },
  validateSession: () => apiClient.request('/auth/session')
};
