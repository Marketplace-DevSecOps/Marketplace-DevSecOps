import { AxiosError, AxiosHeaders, CanceledError, type AxiosAdapter } from 'axios';
import { z } from 'zod';
import { createHttpClient, type HttpRequest } from '../services/http';
import { ApiError, apiStatuses, httpError, parseRetryAfter, retryDelayMs, type ApiCode } from '../services/errors';
import { readApiConfig } from '../services/config';
import { createAuthService } from '../services/auth';
import { createUsersService } from '../services/users';
import { createProductsService } from '../services/products';
import { MOCK_PRODUCTS, MOCK_USER, MOCK_PASSWORD } from '../services/mock/fixtures';

const config = readApiConfig({ url: 'https://api.example.invalid/api/v1', timeoutMs: '1000' }, false);
const read: HttpRequest<{ ok: boolean }> = {
  method: 'GET', path: '/products', statuses: [200], schema: z.strictObject({ ok: z.boolean() }),
};
function respond(status: number, data: unknown, headers: Record<string, string> = {}): AxiosAdapter {
  return async (request) => ({ status, data, headers: AxiosHeaders.from(headers), statusText: 'Test', config: request });
}
const errorBody = (code: ApiCode) => ({
  error: { code, message: 'secret server detail must not escape', correlationId: 'test-request-01' },
});

afterEach(() => { jest.useRealTimers(); });

it.each([
  ['VALIDATION_ERROR', 'validation'], ['UNAUTHORIZED', 'unauthorized'], ['FORBIDDEN', 'forbidden'],
  ['NOT_FOUND', 'not_found'], ['CONFLICT', 'conflict'], ['RATE_LIMITED', 'rate_limited'],
  ['INTERNAL_ERROR', 'server'], ['SERVICE_UNAVAILABLE', 'server'],
] as const)('normalizes HTTP %s without disclosing raw transport data', async (code, kind) => {
  const adapter = jest.fn(respond(apiStatuses[code], errorBody(code)));
  const client = createHttpClient(config, { adapter });
  const error = await client.request(read).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ kind, code, status: apiStatuses[code], correlationId: 'test-request-01', source: 'real' });
  expect(JSON.stringify(error)).not.toContain('secret server detail');
  expect(error).not.toHaveProperty('config');
  expect(error).not.toHaveProperty('response');
  expect(error).not.toHaveProperty('cause');
  expect(adapter).toHaveBeenCalledTimes(1);
});

it('keeps neutral field validation and ignores untrusted paths and messages', () => {
  const error = httpError(400, {
    error: { ...errorBody('VALIDATION_ERROR').error, details: [
      { location: 'body', path: 'email', code: 'invalid_format', message: 'private email value' },
      { location: 'body', path: 'private-token-value', code: 'custom', message: 'private token value' },
    ] },
  }, {}, 0, 'real');
  expect(error.fields).toEqual([{ location: 'body', path: 'email', code: 'invalid_format', message: 'Valeur invalide.' }]);
  expect(JSON.stringify(error)).not.toContain('private');
});

it('handles malformed error bodies and mismatched error codes by HTTP status', async () => {
  const client = createHttpClient(config, { adapter: respond(404, errorBody('FORBIDDEN'), { 'X-Request-Id': 'header-id' }) });
  await expect(client.request(read)).rejects.toMatchObject({ kind: 'not_found', code: 'NOT_FOUND', correlationId: 'header-id' });
  const server = createHttpClient(config, { adapter: respond(502, '<html>internal details</html>') });
  await expect(server.request(read)).rejects.toMatchObject({ kind: 'server', status: 502 });
});

it.each([
  { ...MOCK_PRODUCTS[0]!, price: 250 },
  { ...MOCK_PRODUCTS[0]!, currency: 'EUR' },
  { ...MOCK_PRODUCTS[0]!, createdAt: '2026-11-25' },
  { ...MOCK_PRODUCTS[0]!, seller: { ...MOCK_PRODUCTS[0]!.seller, email: 'private@example.invalid' } },
  { ...MOCK_PRODUCTS[0]!, passwordHash: 'private-hash' },
])('rejects an invalid product response instead of returning data', async (product) => {
  const products = createProductsService(createHttpClient(config, { adapter: respond(200, product) }));
  await expect(products.get(MOCK_PRODUCTS[0]!.id)).rejects.toMatchObject({ kind: 'invalid_response', source: 'real' });
});

it('does not interpret an unexpected success status as a successful mutation', async () => {
  const adapter = jest.fn(respond(200, MOCK_USER)); // register requires 201
  const auth = createAuthService(createHttpClient(config, { adapter }));
  await expect(auth.register({ email: MOCK_USER.email, displayName: MOCK_USER.displayName, password: MOCK_PASSWORD }))
    .rejects.toMatchObject({ kind: 'invalid_response' });
  expect(adapter).toHaveBeenCalledTimes(1);
});

it('rejects malformed JSON on success and preserves server status and backoff on malformed errors', async () => {
  const invalid = createHttpClient(config, { adapter: respond(200, '{"ok":') });
  await expect(invalid.request(read)).rejects.toMatchObject({ kind: 'invalid_response' });
  const adapter = jest.fn(respond(503, '{"error":', { 'Retry-After': '5', 'X-Request-Id': 'malformed-json' }));
  const server = createHttpClient(config, { adapter });
  await expect(server.request(read)).rejects.toMatchObject({ kind: 'server', status: 503 });
  await expect(server.request(read)).rejects.toMatchObject({ kind: 'server', status: 503 });
  expect(adapter).toHaveBeenCalledTimes(1);
});

it('never retries a failed non-idempotent mutation', async () => {
  const adapter = jest.fn(respond(503, errorBody('SERVICE_UNAVAILABLE'), { 'Retry-After': '5' }));
  const auth = createAuthService(createHttpClient(config, { adapter }));
  await expect(auth.register({ email: MOCK_USER.email, displayName: MOCK_USER.displayName, password: MOCK_PASSWORD }))
    .rejects.toMatchObject({ kind: 'server' });
  await Promise.resolve();
  expect(adapter).toHaveBeenCalledTimes(1);
});

it('honors Retry-After without sleeping or replaying the request', async () => {
  let now = Date.UTC(2026, 10, 25, 12);
  const adapter = jest.fn<ReturnType<AxiosAdapter>, Parameters<AxiosAdapter>>()
    .mockImplementationOnce(respond(429, errorBody('RATE_LIMITED'), { 'Retry-After': '5' }))
    .mockImplementation(respond(200, { ok: true }));
  const client = createHttpClient(config, { adapter, now: () => now });
  const error = await client.request(read).catch((reason: unknown) => reason) as ApiError;
  expect(retryDelayMs(error, now)).toBe(5000);
  now += 4000;
  await expect(client.request(read)).rejects.toMatchObject({ kind: 'rate_limited' });
  expect(retryDelayMs(error, now)).toBe(1000);
  expect(adapter).toHaveBeenCalledTimes(1);
  now += 1000;
  await expect(client.request(read)).resolves.toEqual({ ok: true });
  expect(adapter).toHaveBeenCalledTimes(2);
});

it('parses Retry-After dates, past dates and invalid hints safely', () => {
  const now = Date.UTC(2026, 10, 25, 12);
  expect(parseRetryAfter('Wed, 25 Nov 2026 12:00:05 GMT', now)).toBe(now + 5000);
  expect(parseRetryAfter('Wed, 25 Nov 2026 11:00:00 GMT', now)).toBe(now);
  for (const value of ['-1', '1.5', 'tomorrow', '9999999999999999999999', undefined]) {
    expect(parseRetryAfter(value, now)).toBeUndefined();
  }
});

const cancellable: AxiosAdapter = (request) => new Promise((_resolve, reject) => {
  request.signal?.addEventListener?.('abort', () => reject(new CanceledError('secret', request)), { once: true });
});

it('aborts the underlying request at the total deadline and returns a neutral timeout', async () => {
  jest.useFakeTimers();
  const adapter = jest.fn(cancellable);
  const client = createHttpClient(config, { adapter });
  const promise = client.request(read);
  const assertion = expect(promise).rejects.toMatchObject({ kind: 'timeout', code: 'TIMEOUT' });
  await jest.advanceTimersByTimeAsync(1000);
  await assertion;
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(adapter.mock.calls[0]![0].signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

it('normalizes Axios timeout and network errors without retaining the request body', async () => {
  const timeout = createHttpClient(config, { adapter: async () => { throw new AxiosError('secret', 'ETIMEDOUT'); } });
  await expect(timeout.request(read)).rejects.toMatchObject({ kind: 'timeout' });
  const offline = createHttpClient(config, { adapter: async () => { throw new AxiosError('secret', 'ERR_NETWORK'); } });
  await expect(offline.request(read)).rejects.toMatchObject({ kind: 'network' });
});

it('supports in-flight and already-aborted caller signals', async () => {
  const controller = new AbortController();
  const adapter = jest.fn(cancellable);
  const client = createHttpClient(config, { adapter });
  const promise = client.request({ ...read, signal: controller.signal });
  const assertion = expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
  controller.abort();
  await assertion;
  await expect(client.request({ ...read, signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  expect(adapter).toHaveBeenCalledTimes(1);
});

it('adds bearer only to protected requests and never to public or auth calls', async () => {
  const accessToken = jest.fn(() => 'test-access-token');
  const adapter = jest.fn(respond(200, MOCK_USER));
  const client = createHttpClient(config, { adapter, accessToken });
  await createUsersService(client).getMe();
  expect(adapter.mock.calls[0]![0].headers.get('Authorization')).toBe('Bearer test-access-token');
  const publicAdapter = jest.fn(respond(200, { items: [], nextCursor: null }));
  const publicClient = createHttpClient(config, { adapter: publicAdapter, accessToken });
  await createProductsService(publicClient).list();
  expect(publicAdapter.mock.calls[0]![0].headers.get('Authorization')).toBeUndefined();
  expect(accessToken).toHaveBeenCalledTimes(1);
  const authAdapter = jest.fn(respond(401, errorBody('UNAUTHORIZED')));
  await expect(createAuthService(createHttpClient(config, { adapter: authAdapter, accessToken }))
    .login({ email: MOCK_USER.email, password: MOCK_PASSWORD })).rejects.toMatchObject({ kind: 'unauthorized' });
  expect(authAdapter.mock.calls[0]![0].headers.get('Authorization')).toBeUndefined();
});

it('rejects external URLs before credentials or transport are accessed', async () => {
  const adapter = jest.fn(respond(200, { ok: true }));
  const accessToken = jest.fn(() => 'secret');
  const client = createHttpClient(config, { adapter, accessToken });
  await expect(client.request({ ...read, authenticated: true, path: 'https://other.example.invalid/' }))
    .rejects.toMatchObject({ kind: 'configuration' });
  expect(adapter).not.toHaveBeenCalled();
  expect(accessToken).not.toHaveBeenCalled();
});
