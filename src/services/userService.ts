import {apiClient} from '@/services/apiClient';

export const userService = {
  me: () => apiClient.request('/user/me'),
  byId: (id: string) => apiClient.request(`/user/${id}`)
};
