import { AxiosHeaders, CanceledError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { apiStatuses, type ApiCode } from '../errors';
import { priceCents, type ConversationDto, type CurrentUserDto, type MessageDto, type MobileSessionDto } from '../../schemas/api';
import { MOCK_CATEGORY, MOCK_CONVERSATION, MOCK_PASSWORD, MOCK_PRODUCTS, MOCK_USER } from './fixtures';

type Session = { userId: string; family: number; version: number };
type Cursor = { scope: string; offset: number };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Each factory creates an isolated, repeatable in-memory simulation. No network or disk.
export function createMockAdapter(): AxiosAdapter {
  const users = new Map<string, CurrentUserDto>([[MOCK_USER.id, clone(MOCK_USER)]]);
  const conversations = new Map<string, ConversationDto>([[MOCK_CONVERSATION.id, clone(MOCK_CONVERSATION)]]);
  const messages: MessageDto[] = [];
  const accesses = new Map<string, Session>();
  const refreshes = new Map<string, Session>();
  const usedRefreshes = new Set<string>();
  const revokedFamilies = new Set<number>();
  const cursors = new Map<string, Cursor>();
  const cursorTokens = new Map<string, string>();
  let resourceNumber = 0;
  let familyNumber = 0;
  let requestNumber = 0;
  const newId = () => '90000000-0000-4000-8000-' + (++resourceNumber).toString(16).padStart(12, '0');
  const sessionDto = (session: Session): MobileSessionDto => {
    const suffix = session.family + '-' + session.version;
    const accessToken = 'mock-access-' + suffix;
    const refreshToken = 'mock-refresh-' + suffix;
    accesses.set(accessToken, session);
    refreshes.set(refreshToken, session);
    return {
      user: clone(users.get(session.userId)!), tokenType: 'Bearer', accessToken, refreshToken,
      accessTokenExpiresAt: '2030-01-01T00:10:00.000Z', refreshTokenExpiresAt: '2030-01-08T00:00:00.000Z',
    };
  };

  return async (config: InternalAxiosRequestConfig) => {
    if (config.signal?.aborted) throw new CanceledError();
    await Promise.resolve();
    if (config.signal?.aborted) throw new CanceledError();
    const correlationId = 'mock-request-' + (++requestNumber);
    const respond = (status: number, data: unknown) => ({
      status, data: data === '' ? '' : clone(data), statusText: 'MOCK', config,
      headers: AxiosHeaders.from({ 'X-Request-Id': correlationId, 'X-Mock-Mode': 'true' }),
    });
    const fail = (code: ApiCode) => respond(apiStatuses[code], {
      error: { code, message: 'Simulated API error.', correlationId },
    });
    const page = <T,>(items: T[], query: Record<string, unknown>, scope: string, start = 0) => {
      const cursor = query.cursor === undefined ? undefined : cursors.get(String(query.cursor));
      if (query.cursor !== undefined && (!cursor || cursor.scope !== scope)) return fail('VALIDATION_ERROR');
      const offset = cursor?.offset ?? start;
      const limit = Number(query.limit ?? 20);
      const next = offset + limit;
      let nextCursor: string | null = null;
      if (next < items.length) {
        const positionKey = scope + ':' + next;
        nextCursor = cursorTokens.get(positionKey) ?? 'mock_cursor_' + (cursors.size + 1);
        cursors.set(nextCursor, { scope, offset: next });
        cursorTokens.set(positionKey, nextCursor);
      }
      return respond(200, { items: items.slice(offset, next), nextCursor });
    };
    const path = config.url;
    const method = config.method?.toUpperCase();
    const query = (config.params ?? {}) as Record<string, unknown>;
    let body: Record<string, string> = {};
    try { body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {}; }
    catch { return fail('MALFORMED_JSON'); }

    if (path === '/auth/register' && method === 'POST') {
      if (body.password !== MOCK_PASSWORD) return fail('VALIDATION_ERROR');
      if ([...users.values()].some((user) => user.email === body.email)) return fail('CONFLICT');
      const user = { id: newId(), email: body.email!, displayName: body.displayName! };
      users.set(user.id, user);
      return respond(201, user);
    }
    if (path === '/auth/mobile/login' && method === 'POST') {
      const user = [...users.values()].find((entry) => entry.email === body.email);
      if (!user || body.password !== MOCK_PASSWORD) return fail('UNAUTHORIZED');
      return respond(200, sessionDto({ userId: user.id, family: ++familyNumber, version: 1 }));
    }
    if (path === '/auth/mobile/refresh' && method === 'POST') {
      const session = refreshes.get(body.refreshToken!);
      if (!session || revokedFamilies.has(session.family)) return fail('UNAUTHORIZED');
      if (usedRefreshes.has(body.refreshToken!)) {
        revokedFamilies.add(session.family);
        return fail('UNAUTHORIZED');
      }
      usedRefreshes.add(body.refreshToken!);
      return respond(200, sessionDto({ ...session, version: session.version + 1 }));
    }
    if (path === '/auth/mobile/logout' && method === 'POST') {
      const session = refreshes.get(body.refreshToken!);
      if (session) revokedFamilies.add(session.family);
      return respond(204, '');
    }
    if (path === '/categories' && method === 'GET') return page([MOCK_CATEGORY], query, 'categories');
    if (path === '/products' && method === 'GET') {
      const search = String(query.q ?? '').toLocaleLowerCase('fr');
      const products = MOCK_PRODUCTS.filter((product) =>
        (query.categoryId === undefined || product.categoryId === query.categoryId)
        && (product.title + ' ' + product.description).toLocaleLowerCase('fr').includes(search)
        && (query.minPrice === undefined || priceCents(product.price) >= priceCents(String(query.minPrice)))
        && (query.maxPrice === undefined || priceCents(product.price) <= priceCents(String(query.maxPrice))));
      products.sort((left, right) => query.sort === 'price_asc' ? priceCents(left.price) - priceCents(right.price)
        : query.sort === 'price_desc' ? priceCents(right.price) - priceCents(left.price)
        : right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const { cursor: _cursor, limit: _limit, ...filters } = query;
      return page(products, query, 'products:' + JSON.stringify(filters));
    }
    if (path?.startsWith('/products/') && method === 'GET') {
      const product = MOCK_PRODUCTS.find((entry) => entry.id === path.slice('/products/'.length));
      return product ? respond(200, product) : fail('NOT_FOUND');
    }
    const bearer = String(AxiosHeaders.from(config.headers).get('Authorization') ?? '').replace(/^Bearer /, '');
    const session = accesses.get(bearer);
    if (!session || revokedFamilies.has(session.family)) return fail('UNAUTHORIZED');
    const user = users.get(session.userId)!;
    if (path === '/users/me' && method === 'GET') return respond(200, user);
    if (path === '/users/me' && method === 'PATCH') {
      user.displayName = body.displayName!;
      for (const conversation of conversations.values()) {
        if (conversation.buyer.id === user.id) conversation.buyer.displayName = user.displayName;
      }
      return respond(200, user);
    }
    const owned = (conversation: ConversationDto) => conversation.buyer.id === user.id || conversation.seller.id === user.id;
    if (path === '/conversations' && method === 'GET') {
      const items = [...conversations.values()].filter(owned).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return page(items, query, 'conversations:' + user.id);
    }
    if (path === '/conversations' && method === 'POST') {
      const product = MOCK_PRODUCTS.find((entry) => entry.id === body.productId);
      if (!product) return fail('NOT_FOUND');
      if (product.seller.id === user.id) return fail('FORBIDDEN');
      const found = [...conversations.values()].find((entry) => entry.productId === product.id && entry.buyer.id === user.id);
      if (found) return respond(200, found);
      const conversation: ConversationDto = {
        id: newId(), productId: product.id, buyer: { id: user.id, displayName: user.displayName },
        seller: { ...product.seller }, lastMessageSeq: 0, lastMessage: null,
        createdAt: '2026-11-25T12:00:00.000Z', updatedAt: '2026-11-25T12:00:00.000Z',
      };
      conversations.set(conversation.id, conversation);
      return respond(201, conversation);
    }
    const match = path?.match(/^\/conversations\/([0-9a-f-]+)\/messages$/);
    if (!match) return fail('NOT_FOUND');
    const conversation = conversations.get(match[1]!);
    if (!conversation || !owned(conversation)) return fail('NOT_FOUND');
    if (method === 'GET') {
      const items = messages.filter((entry) => entry.conversationId === conversation.id);
      const after = Number(query.afterSeq ?? 0);
      const start = items.findIndex((entry) => entry.seq > after);
      return page(items, query, 'messages:' + user.id + ':' + conversation.id, start === -1 ? items.length : start);
    }
    if (method === 'POST') {
      const prior = messages.find((entry) => entry.senderId === user.id && entry.clientMessageId === body.clientMessageId);
      if (prior) return prior.conversationId === conversation.id && prior.body === body.body
        ? respond(200, prior) : fail('CONFLICT');
      const message: MessageDto = {
        id: newId(), conversationId: conversation.id, senderId: user.id,
        clientMessageId: body.clientMessageId!, body: body.body!, seq: conversation.lastMessageSeq + 1,
        createdAt: new Date(Date.UTC(2026, 10, 25, 12, 1) + messages.length * 1000).toISOString(),
      };
      messages.push(message);
      conversation.lastMessage = message;
      conversation.lastMessageSeq = message.seq;
      conversation.updatedAt = message.createdAt;
      return respond(201, message);
    }
    return fail('NOT_FOUND');
  };
}
