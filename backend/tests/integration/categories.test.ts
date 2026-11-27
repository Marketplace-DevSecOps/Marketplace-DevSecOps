import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CATEGORIES_CACHE_CONTROL } from '../../src/modules/categories/categories.controller.js';
import { MAX_CATEGORIES } from '../../src/modules/categories/categories.service.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
const { app } = buildTestApp({ prisma });

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

describe('GET /api/v1/categories (API-14)', () => {
  it('returns only active categories, ordered by label', async () => {
    await prisma.category.createMany({
      data: [
        { label: 'Maison', isActive: true },
        { label: 'Archives', isActive: false },
        { label: 'Livres', isActive: true },
      ],
    });

    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.items.map((c: { label: string }) => c.label)).toEqual(['Livres', 'Maison']);
  });

  it('exposes only id and label', async () => {
    const row = await prisma.category.create({ data: { label: 'Électronique' } });

    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: row.id, label: 'Électronique' }] });
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['id', 'label']);
  });

  it('returns an empty list when no category is active', async () => {
    await prisma.category.create({ data: { label: 'Archives', isActive: false } });

    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it(`caps the list at ${MAX_CATEGORIES} items with a stable order`, async () => {
    const labels = Array.from({ length: MAX_CATEGORIES + 5 }, (_, i) => `Cat ${String(i).padStart(3, '0')}`);
    await prisma.category.createMany({ data: labels.map((label) => ({ label })) });

    const first = await request(app).get('/api/v1/categories');
    const second = await request(app).get('/api/v1/categories');

    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(MAX_CATEGORIES);
    expect(first.body.items.map((c: { label: string }) => c.label)).toEqual(labels.slice(0, MAX_CATEGORIES));
    expect(second.body).toEqual(first.body);
  });

  it('sets a short public Cache-Control and the correlation id', async () => {
    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(CATEGORIES_CACHE_CONTROL);
    expect(CATEGORIES_CACHE_CONTROL).toBe('public, max-age=60');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('sends Vary: Origin on the cacheable response even without an Origin header', async () => {
    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(CATEGORIES_CACHE_CONTROL);
    expect(res.headers['vary']).toMatch(/\bOrigin\b/);
  });
});
