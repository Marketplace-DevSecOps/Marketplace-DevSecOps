import { ApiError, type ServiceMode } from './errors';

export type PublicApiEnvironment = {
  mode?: string; url?: string; timeoutMs?: string; allowLocalHttp?: string;
};
export type ApiConfig = Readonly<{ mode: ServiceMode; baseURL: string; timeoutMs: number }>;

// Expo inlines these explicit property accesses. All EXPO_PUBLIC_* values are public.
export function publicApiEnvironment(): PublicApiEnvironment {
  return {
    mode: process.env.EXPO_PUBLIC_API_MODE,
    url: process.env.EXPO_PUBLIC_API_URL,
    timeoutMs: process.env.EXPO_PUBLIC_API_TIMEOUT_MS,
    allowLocalHttp: process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP,
  };
}

export function configuredServiceMode(): ServiceMode {
  return process.env.EXPO_PUBLIC_API_MODE === 'mock' ? 'mock' : 'real';
}

function localHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31);
}

export function readApiConfig(env = publicApiEnvironment(), development = __DEV__): ApiConfig {
  if (env.mode !== undefined && env.mode !== 'real' && env.mode !== 'mock') throw new ApiError('configuration');
  const mode = env.mode ?? 'real';
  const timeoutMs = env.timeoutMs === undefined ? 15_000 : Number(env.timeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new ApiError('configuration', { source: mode });
  }
  if (mode === 'mock') return { mode, baseURL: 'https://mock.marketplace.invalid/api/v1', timeoutMs };
  try {
    if (!env.url || !/^https?:\/\//.test(env.url)) throw new Error();
    const url = new URL(env.url);
    if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/api/v1') {
      throw new Error();
    }
    const https = url.protocol === 'https:';
    if (!https && !(url.protocol === 'http:' && development && env.allowLocalHttp === 'true' && localHost(url.hostname))) {
      throw new Error();
    }
    return { mode, baseURL: url.origin + '/api/v1', timeoutMs };
  } catch {
    throw new ApiError('configuration');
  }
}
