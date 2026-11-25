import { z } from 'zod';
import { ApiError, type ServiceMode } from '../services/errors';

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const utcDate = z.iso.datetime({ precision: 3 });
function text(max: number) {
  return z.string().max(max * 2).refine((value) => {
    const count = [...value].length;
    return count >= 1 && count <= max && value.trim().length > 0;
  });
}
export const priceSchema = z.string().regex(/^(0|[1-9]\d{0,6})\.\d{2}$/).refine((value) => {
  const cents = priceCents(value);
  return cents >= 1 && cents <= 100_000_000;
});
export function priceCents(value: string): number {
  const [whole, fractional] = value.split('.');
  return Number(whole) * 100 + Number(fractional);
}
const cursor = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
export const paginationQuery = z.strictObject({
  limit: z.number().int().min(1).max(100).optional(), cursor: cursor.optional(),
});
export const publicSellerSchema = z.strictObject({ id: uuid, displayName: text(50) });
export const categorySchema = z.strictObject({ id: uuid, label: text(60) });
export const productSchema = z.strictObject({
  id: uuid, title: text(120), description: text(5000), price: priceSchema,
  currency: z.literal('MAD'), categoryId: uuid, seller: publicSellerSchema,
  createdAt: utcDate, updatedAt: utcDate,
}).refine((product) => product.updatedAt >= product.createdAt);
export const currentUserSchema = z.strictObject({
  id: uuid, email: z.email().max(254), displayName: text(50),
});
export const mobileSessionSchema = z.strictObject({
  user: currentUserSchema, tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/),
  refreshToken: z.string().min(1).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/),
  accessTokenExpiresAt: utcDate, refreshTokenExpiresAt: utcDate,
}).refine((session) => session.refreshTokenExpiresAt > session.accessTokenExpiresAt);
export const messageSchema = z.strictObject({
  id: uuid, conversationId: uuid, senderId: uuid, body: text(2000),
  clientMessageId: uuid, seq: z.number().int().min(1).max(2147483647), createdAt: utcDate,
});
export const conversationSchema = z.strictObject({
  id: uuid, productId: uuid, buyer: publicSellerSchema, seller: publicSellerSchema,
  lastMessageSeq: z.number().int().min(0).max(2147483647), lastMessage: messageSchema.nullable(),
  createdAt: utcDate, updatedAt: utcDate,
}).refine((conversation) => {
  const message = conversation.lastMessage;
  return conversation.buyer.id !== conversation.seller.id && conversation.updatedAt >= conversation.createdAt
    && (message === null ? conversation.lastMessageSeq === 0
      : message.conversationId === conversation.id && message.seq === conversation.lastMessageSeq);
});
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item).max(100), nextCursor: cursor.nullable() })
    .refine((page) => page.nextCursor === null || page.items.length > 0);
}
const emailInput = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordInput = z.string().max(256).refine((value) => [...value].length >= 12 && [...value].length <= 128);
export const registerInput = z.strictObject({ email: emailInput, displayName: z.string().trim().pipe(text(50)), password: passwordInput });
export const loginInput = z.strictObject({ email: emailInput, password: passwordInput });
export const refreshInput = z.strictObject({ refreshToken: z.string().min(1).max(4096) });
export const updateUserInput = z.strictObject({ displayName: z.string().trim().pipe(text(50)) });
export const productsQuery = paginationQuery.extend({
  q: z.string().trim().pipe(text(120)).optional(), categoryId: uuid.optional(),
  minPrice: priceSchema.optional(), maxPrice: priceSchema.optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).optional(),
}).refine((query) => query.minPrice === undefined || query.maxPrice === undefined
  || priceCents(query.minPrice) <= priceCents(query.maxPrice));
export const messagesQuery = paginationQuery.extend({
  afterSeq: z.number().int().min(0).max(2147483647).optional(),
}).refine((query) => query.cursor === undefined || query.afterSeq === undefined);
export const createConversationInput = z.strictObject({ productId: uuid });
export const sendMessageInput = z.strictObject({
  clientMessageId: uuid,
  body: z.string().max(8000).transform((value) => value.replace(/\r\n?/g, '\n').trim()).pipe(text(2000)),
});
export const emptyResponse = z.union([z.literal(''), z.undefined()]).transform(() => undefined);

export function input<T extends z.ZodType>(schema: T, value: unknown, source: ServiceMode): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError('validation', { code: 'VALIDATION_ERROR', source });
  return parsed.data;
}
export type CategoryDto = z.infer<typeof categorySchema>;
export type ProductDto = z.infer<typeof productSchema>;
export type CurrentUserDto = z.infer<typeof currentUserSchema>;
export type MobileSessionDto = z.infer<typeof mobileSessionSchema>;
export type ConversationDto = z.infer<typeof conversationSchema>;
export type MessageDto = z.infer<typeof messageSchema>;
export type Page<T> = { items: T[]; nextCursor: string | null };
export type PaginationQuery = z.input<typeof paginationQuery>;
export type ProductsQuery = z.input<typeof productsQuery>;
export type MessagesQuery = z.input<typeof messagesQuery>;
