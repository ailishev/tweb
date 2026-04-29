import {apiClient} from '@/services/apiClient';

export const messageService = {
  send: (chatId: string, text: string) => apiClient.request('/messages/send', {
    method: 'POST',
    body: JSON.stringify({chatId, text})
  })
};
