import axios, { AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { z } from 'zod';
import type { ApiConfig } from './config';
import { ApiError, httpError, type ServiceMode } from './errors';

export type RequestOptions = { signal?: AbortSignal };
export type HttpRequest<T> = RequestOptions & {
  method: 'GET' | 'POST' | 'PATCH'; path: string; schema: z.ZodType<T>;
  statuses: readonly number[]; body?: unknown; query?: Record<string, unknown>;
  authenticated?: boolean;
};
export interface HttpClient {
  readonly mode: ServiceMode;
  request<T>(request: HttpRequest<T>): Promise<T>;
}

function responseHeader(headers: AxiosResponse['headers'], name: string): unknown {
  if (headers instanceof AxiosHeaders) return headers.get(name);
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

export function createHttpClient(config: ApiConfig, dependencies: {
  adapter?: AxiosAdapter; accessToken?: () => string | null; now?: () => number;
} = {}): HttpClient {
  const now = dependencies.now ?? Date.now;
  const instance = axios.create({
    baseURL: config.baseURL, timeout: config.timeoutMs, withCredentials: false,
    headers: { Accept: 'application/json' }, responseType: 'json',
    transitional: { silentJSONParsing: false, forcedJSONParsing: true, clarifyTimeoutError: true },
    validateStatus: () => true, maxRedirects: 0,
    ...(dependencies.adapter ? { adapter: dependencies.adapter } : {}),
  });
  const cooldowns = new Map<string, ApiError>();
  const remember = (key: string, error: ApiError) => {
    if (error.retryAt !== undefined && error.retryAt > now()) {
      if (cooldowns.size >= 100) cooldowns.delete(cooldowns.keys().next().value!);
      cooldowns.set(key, error);
    }
    return error;
  };
  return {
    mode: config.mode,
    async request<T>(request: HttpRequest<T>): Promise<T> {
      const source = config.mode;
      if (request.signal?.aborted) throw new ApiError('cancelled', { source });
      // Only internal relative API paths. A caller cannot redirect a bearer to another origin.
      if (!/^\/[A-Za-z0-9/-]+$/.test(request.path) || request.path.includes('//')) {
        throw new ApiError('configuration', { source });
      }
      const key = request.method + ' ' + request.path;
      for (const [route, error] of cooldowns) {
        if ((error.retryAt ?? 0) <= now()) cooldowns.delete(route);
      }
      const cooldown = cooldowns.get(key);
      if (cooldown) throw cooldown;
      const headers = new AxiosHeaders();
      if (request.body !== undefined) headers.setContentType('application/json');
      if (request.authenticated) {
        let token: string | null | undefined;
        try { token = dependencies.accessToken?.(); }
        catch { throw new ApiError('unauthorized', { source }); }
        if (token) {
          if (token.length > 4096 || !/^[^\s\u0000-\u001f\u007f]+$/.test(token)) {
            throw new ApiError('unauthorized', { source });
          }
          headers.set('Authorization', 'Bearer ' + token);
        }
      }
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      if (request.signal?.aborted) controller.abort();
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
      try {
        const response = await instance.request<unknown>({
          method: request.method, url: request.path, headers,
          params: request.query, data: request.body, signal: controller.signal,
        });
        if (controller.signal.aborted) throw new ApiError(timedOut ? 'timeout' : 'cancelled', { source });
        if (response.status < 200 || response.status >= 300) {
          const error = httpError(response.status, response.data, {
            correlationId: responseHeader(response.headers, 'X-Request-Id'),
            retryAfter: responseHeader(response.headers, 'Retry-After'),
          }, now(), source);
          // Bounded in-memory hints, never timers or request replays.
          throw remember(key, error);
        }
        if (!request.statuses.includes(response.status)) {
          throw new ApiError('invalid_response', { status: response.status, source });
        }
        const parsed = request.schema.safeParse(response.data);
        if (!parsed.success) throw new ApiError('invalid_response', { status: response.status, source });
        return parsed.data;
      } catch (error: unknown) {
        if (error instanceof ApiError) throw error;
        if (timedOut || (axios.isAxiosError(error) && ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? ''))) {
          throw new ApiError('timeout', { source });
        }
        if (request.signal?.aborted || axios.isCancel(error)) throw new ApiError('cancelled', { source });
        if (axios.isAxiosError(error) && error.response && error.response.status >= 400) {
          throw remember(key, httpError(error.response.status, undefined, {
            correlationId: responseHeader(error.response.headers, 'X-Request-Id'),
            retryAfter: responseHeader(error.response.headers, 'Retry-After'),
          }, now(), source));
        }
        if (axios.isAxiosError(error) && error.code === 'ERR_BAD_RESPONSE') throw new ApiError('invalid_response', { source });
        throw new ApiError('network', { source });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
      }
    },
  };
}
