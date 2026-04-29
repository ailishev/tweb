import {apiClient} from '@/services/apiClient';

export const chatService = {
  list: () => apiClient.request('/chats/list'),
  messages: (chatId: string) => apiClient.request(`/chats/${chatId}/messages`)
};
