import { readApiConfig } from '../services/config';

it('requires explicit real configuration and does not fall back to mock', () => {
  expect(() => readApiConfig({}, true)).toThrow();
  expect(readApiConfig({ mode: 'mock' }, false)).toMatchObject({ mode: 'mock', timeoutMs: 15000 });
  expect(readApiConfig({ url: 'https://api.example.invalid/api/v1/' }, false))
    .toMatchObject({ mode: 'real', baseURL: 'https://api.example.invalid/api/v1' });
});

it.each([
  'http://api.example.invalid/api/v1',
  'https://user:password@api.example.invalid/api/v1',
  'https://api.example.invalid/api/v1?token=secret',
  'https://api.example.invalid/api/v1#secret',
  'https://api.example.invalid/wrong',
])('rejects an unsafe or malformed API URL: %s', (url) => {
  expect(() => readApiConfig({ url, allowLocalHttp: 'true' }, true)).toThrow();
});

it.each(['localhost', '10.0.2.2', '192.168.1.50', '172.20.10.2', '127.0.0.1'])(
  'allows development HTTP for %s only with explicit opt-in', (host) => {
    const url = 'http://' + host + ':3000/api/v1';
    expect(() => readApiConfig({ url }, true)).toThrow();
    expect(readApiConfig({ url, allowLocalHttp: 'true' }, true).baseURL).toBe(url);
    expect(() => readApiConfig({ url, allowLocalHttp: 'true' }, false)).toThrow();
  },
);

it('rejects unknown modes and invalid timeout values', () => {
  expect(() => readApiConfig({ mode: 'auto' }, true)).toThrow();
  for (const timeoutMs of ['', '-1', 'NaN', '60001', '1.5']) {
    expect(() => readApiConfig({ mode: 'mock', timeoutMs }, true)).toThrow();
  }
});
