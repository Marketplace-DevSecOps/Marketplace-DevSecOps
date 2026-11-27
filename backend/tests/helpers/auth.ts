// Auth flows driven through the HTTP API, for integration and security tests.
import type { Express } from 'express';
import request from 'supertest';
import { ALLOWED_ORIGIN } from './testApp.js';

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export interface RegisteredUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

let counter = 0;

/** Registers a fresh account through POST /auth/register. */
export async function registerUser(
  app: Express,
  { email, password = TEST_PASSWORD, displayName }: { email?: string; password?: string; displayName?: string } = {},
): Promise<RegisteredUser & { password: string }> {
  counter += 1;
  const body = {
    email: email ?? `member${String(counter)}@example.test`,
    displayName: displayName ?? `Member ${String(counter)}`,
    password,
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed with ${String(res.status)}`);
  return { ...(res.body as RegisteredUser), password };
}

export function webLoginRequest(app: Express, email: string, password: string) {
  return request(app).post('/api/v1/auth/login').set('Origin', ALLOWED_ORIGIN).send({ email, password });
}

export function mobileLoginRequest(app: Express, email: string, password: string) {
  return request(app).post('/api/v1/auth/mobile/login').send({ email, password });
}

/** The Set-Cookie header values of a response (always an array). */
export function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const header = res.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? (header as string[]) : [String(header)];
}

/** `name=value` of the named cookie in a Set-Cookie list, for sending it back. */
export function cookiePair(cookies: readonly string[], name: string): string | undefined {
  return cookies.find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0];
}

/** Value of the named cookie in a Set-Cookie list. */
export function cookieValue(cookies: readonly string[], name: string): string | undefined {
  return cookiePair(cookies, name)?.slice(name.length + 1);
}

export async function webLogin(app: Express, email: string, password: string = TEST_PASSWORD) {
  const res = await webLoginRequest(app, email, password);
  if (res.status !== 200) throw new Error(`web login failed with ${String(res.status)}`);
  return { res, accessToken: res.body.accessToken as string, cookies: setCookies(res) };
}

export async function mobileLogin(app: Express, email: string, password: string = TEST_PASSWORD) {
  const res = await mobileLoginRequest(app, email, password);
  if (res.status !== 200) throw new Error(`mobile login failed with ${String(res.status)}`);
  return { res, accessToken: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
}
