import { z } from 'zod';
import { input, messageSchema, messagesQuery, pageSchema, sendMessageInput, uuid, type MessagesQuery } from '../schemas/api';
import { ApiError } from './errors';
import type { HttpClient, RequestOptions } from './http';

function utf8Size(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function createMessagesService(http: HttpClient) {
  return {
    async list(conversationId: string, query: MessagesQuery = {}, options: RequestOptions = {}) {
      const id = input(uuid, conversationId, http.mode).toLowerCase();
      const params = input(messagesQuery, query, http.mode);
      return http.request({
        method: 'GET', path: '/conversations/' + id + '/messages', statuses: [200], authenticated: true,
        schema: pageSchema(messageSchema).refine((page) => {
          let previous = params.afterSeq ?? 0;
          const ids = new Set<string>();
          return page.items.length <= (params.limit ?? 20) && page.items.every((message) => {
            if (message.conversationId !== id || message.seq <= previous || ids.has(message.id)) return false;
            previous = message.seq;
            ids.add(message.id);
            return true;
          });
        }), query: params, signal: options.signal,
      });
    },
    async send(conversationId: string, body: z.input<typeof sendMessageInput>, options: RequestOptions = {}) {
      const id = input(uuid, conversationId, http.mode).toLowerCase();
      const payload = input(sendMessageInput, body, http.mode);
      if (utf8Size(JSON.stringify(payload)) > 8192) {
        throw new ApiError('validation', { code: 'PAYLOAD_TOO_LARGE', source: http.mode });
      }
      return http.request({
        method: 'POST', path: '/conversations/' + id + '/messages', statuses: [200, 201], authenticated: true,
        schema: messageSchema.refine((message) => message.conversationId === id
          && message.clientMessageId === payload.clientMessageId && message.body === payload.body),
        body: payload, signal: options.signal,
      });
    },
  };
}
