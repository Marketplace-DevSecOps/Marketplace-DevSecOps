import { AxiosHeaders, type AxiosAdapter } from 'axios';
import { createServices } from '../services';
import { readApiConfig } from '../services/config';
import { createHttpClient } from '../services/http';
import { createMessagesService } from '../services/messages';
import { createUsersService } from '../services/users';
import { createAuthService } from '../services/auth';
import { MOCK_CONVERSATION, MOCK_PASSWORD, MOCK_PRODUCTS, MOCK_USER } from '../services/mock/fixtures';

const mockConfig = readApiConfig({ mode: 'mock' }, true);
const key = '66666666-6666-4666-8666-666666666666';
const credentials = { email: MOCK_USER.email, password: MOCK_PASSWORD };
function mockServices() {
  let token: string | null = null;
  const api = createServices(mockConfig, { accessToken: () => token });
  return { api, useToken: (value: string) => { token = value; }, login: async () => {
    const session = await api.auth.login(credentials);
    token = session.accessToken;
    return session;
  } };
}

it('has deterministic isolated fixtures and explicitly identifies mock services', async () => {
  const first = mockServices();
  const second = mockServices();
  expect(first.api.mode).toBe('mock');
  expect(await first.api.products.list()).toEqual(await second.api.products.list());
  expect(await first.login()).toEqual(await second.login());
  await first.api.users.updateMe({ displayName: 'Nom fictif modifié' });
  await expect(second.api.users.getMe()).resolves.toMatchObject({ displayName: MOCK_USER.displayName });
});

it('filters and paginates public data, preserving opaque cursors and their scope', async () => {
  const { api } = mockServices();
  const first = await api.products.list({ limit: 1 });
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  const second = await api.products.list({ limit: 1, cursor: first.nextCursor! });
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  await expect(api.categories.list({ cursor: first.nextCursor! })).rejects.toMatchObject({ kind: 'validation', source: 'mock' });
  await expect(api.products.list({ q: 'clavier', minPrice: '200.00', maxPrice: '300.00' }))
    .resolves.toMatchObject({ items: [MOCK_PRODUCTS[0]], nextCursor: null });
  await expect(api.products.list({ q: 'absent' })).resolves.toEqual({ items: [], nextCursor: null });
});

it('simulates auth rotation, replay refusal and idempotent logout in memory', async () => {
  const { api, login } = mockServices();
  await expect(api.users.getMe()).rejects.toMatchObject({ kind: 'unauthorized' });
  const session = await login();
  const rotated = await api.auth.refresh({ refreshToken: session.refreshToken });
  expect(rotated.refreshToken).not.toBe(session.refreshToken);
  await expect(api.auth.refresh({ refreshToken: session.refreshToken })).rejects.toMatchObject({ kind: 'unauthorized' });
  await expect(api.users.getMe()).rejects.toMatchObject({ kind: 'unauthorized' });
  await expect(api.auth.logout({ refreshToken: rotated.refreshToken })).resolves.toBeUndefined();
  await expect(api.auth.logout({ refreshToken: rotated.refreshToken })).resolves.toBeUndefined();
});

it('returns the registered user without opening a session', async () => {
  const { api } = mockServices();
  await expect(api.auth.register({
    email: ' nouveau@example.invalid ', displayName: ' Nouveau fictif ', password: MOCK_PASSWORD,
  })).resolves.toMatchObject({ email: 'nouveau@example.invalid', displayName: 'Nouveau fictif' });
  await expect(api.users.getMe()).rejects.toMatchObject({ kind: 'unauthorized' });
  await expect(api.auth.register({ ...credentials, displayName: 'Doublon' })).rejects.toMatchObject({ kind: 'conflict' });
});

it('simulates message idempotence and ascending history without automatic retries', async () => {
  const { api, login } = mockServices();
  await login();
  const conversation = await api.conversations.create({ productId: MOCK_PRODUCTS[0]!.id });
  expect(conversation.id).toBe(MOCK_CONVERSATION.id);
  const first = await api.messages.send(conversation.id, { clientMessageId: key, body: ' Bonjour\r\nfictif. ' });
  expect(first.body).toBe('Bonjour\nfictif.');
  expect(first.seq).toBe(1);
  const repeated = await api.messages.send(conversation.id, { clientMessageId: key, body: first.body });
  expect(repeated).toEqual(first);
  await expect(api.messages.send(conversation.id, { clientMessageId: key, body: 'Autre texte' }))
    .rejects.toMatchObject({ kind: 'conflict' });
  await expect(api.messages.list(conversation.id, { afterSeq: 0 })).resolves.toEqual({ items: [first], nextCursor: null });
  await expect(api.messages.list(conversation.id, { afterSeq: 1 })).resolves.toEqual({ items: [], nextCursor: null });
  await expect(api.conversations.list()).resolves.toMatchObject({ items: [{ lastMessageSeq: 1, lastMessage: first }] });
});

it('does not expose another mock user’s conversations', async () => {
  const { api, useToken } = mockServices();
  await api.auth.register({ email: 'tiers@example.invalid', displayName: 'Tiers fictif', password: MOCK_PASSWORD });
  const thirdSession = await api.auth.login({ email: 'tiers@example.invalid', password: MOCK_PASSWORD });
  useToken(thirdSession.accessToken);
  await expect(api.users.getMe()).resolves.toMatchObject({ email: 'tiers@example.invalid' });
  await expect(api.conversations.list()).resolves.toEqual({ items: [], nextCursor: null });
  await expect(api.messages.list(MOCK_CONVERSATION.id)).rejects.toMatchObject({ kind: 'not_found', code: 'NOT_FOUND' });
  // Independent mock bundles do not share a token registry.
  const other = createServices(mockConfig, { accessToken: () => thirdSession.accessToken });
  await expect(other.users.getMe()).rejects.toMatchObject({ kind: 'unauthorized' });
});

it('validates inputs, page bounds and payloads before the adapter runs', async () => {
  const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>();
  const client = createHttpClient({ ...mockConfig, mode: 'real' }, { adapter });
  const messages = createMessagesService(client);
  await expect(messages.list(MOCK_CONVERSATION.id, { cursor: 'opaque', afterSeq: 0 })).rejects.toMatchObject({ kind: 'validation' });
  await expect(messages.send('../outside', { clientMessageId: key, body: 'Bonjour' })).rejects.toMatchObject({ kind: 'validation' });
  await expect(messages.send(MOCK_CONVERSATION.id, { clientMessageId: key, body: '\u0000'.repeat(2000) }))
    .rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  await expect(createUsersService(client).updateMe({ displayName: 'Fictif', role: 'ADMIN' } as never))
    .rejects.toMatchObject({ kind: 'validation' });
  expect(adapter).not.toHaveBeenCalled();
});

it('rejects history from a different conversation and unexpected logout bodies', async () => {
  const adapter: AxiosAdapter = async (request) => ({
    status: 200, data: { items: [{
      id: '77777777-7777-4777-8777-777777777777', conversationId: MOCK_PRODUCTS[0]!.id,
      senderId: MOCK_USER.id, body: 'Message fictif', clientMessageId: key,
      seq: 1, createdAt: '2026-11-25T12:01:00.000Z',
    }], nextCursor: null }, headers: new AxiosHeaders(), statusText: 'Test', config: request,
  });
  await expect(createMessagesService(createHttpClient({ ...mockConfig, mode: 'real' }, { adapter }))
    .list(MOCK_CONVERSATION.id)).rejects.toMatchObject({ kind: 'invalid_response' });
  const logout: AxiosAdapter = async (request) => ({
    status: 204, data: { success: true }, headers: new AxiosHeaders(), statusText: 'Test', config: request,
  });
  await expect(createAuthService(createHttpClient({ ...mockConfig, mode: 'real' }, { adapter: logout }))
    .logout({ refreshToken: 'test-refresh' })).rejects.toMatchObject({ kind: 'invalid_response' });
});
