import { createAuthService } from './auth';
import { createCategoriesService } from './categories';
import { readApiConfig, type ApiConfig } from './config';
import { createConversationsService } from './conversations';
import { createHttpClient } from './http';
import { createMessagesService } from './messages';
import { createMockAdapter } from './mock/adapter';
import { createProductsService } from './products';
import { createUsersService } from './users';

export function createServices(config: ApiConfig, dependencies: {
  accessToken?: () => string | null; now?: () => number;
} = {}) {
  const http = createHttpClient(config, {
    ...dependencies, adapter: config.mode === 'mock' ? createMockAdapter() : undefined,
  });
  return {
    mode: http.mode, auth: createAuthService(http), users: createUsersService(http),
    products: createProductsService(http), categories: createCategoriesService(http),
    conversations: createConversationsService(http), messages: createMessagesService(http),
  } as const;
}
export type ApiServices = ReturnType<typeof createServices>;
let services: ApiServices | undefined;

// Lazy: missing real configuration fails on use; it never selects a mock fallback.
// Session integration should create its own bundle with an in-memory accessToken getter.
export function getApiServices(): ApiServices {
  return services ??= createServices(readApiConfig());
}
