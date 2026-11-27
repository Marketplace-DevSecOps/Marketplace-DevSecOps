// The database itself must refuse invalid rows, even if Zod or a service is
// bypassed: uniqueness, business CHECK constraints and ON DELETE RESTRICT.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Category, Product, User } from '../../src/generated/prisma/client.js';
import {
  createCategory,
  createConversation,
  createProduct,
  createTestPrisma,
  createUser,
  dbError,
  truncateAll,
} from '../helpers/testDb.js';

const prisma = createTestPrisma();

const UNIQUE = { prismaCode: 'P2002', sqlState: '23505' };
const CHECK = { sqlState: '23514' };
const RESTRICT = { prismaCode: 'P2003', sqlState: '23503' };

let seller: User;
let buyer: User;
let category: Category;
let product: Product;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  seller = await createUser(prisma);
  buyer = await createUser(prisma);
  category = await createCategory(prisma);
  product = await createProduct(prisma, { sellerId: seller.id, categoryId: category.id });
});

afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

describe('uniqueness constraints', () => {
  it('rejects a second user with the same email', async () => {
    await expect(dbError(createUser(prisma, { email: seller.email }))).resolves.toEqual({
      ...UNIQUE,
      constraint: 'User_email_key',
    });
  });

  it('rejects an email that is not stored lowercased and trimmed', async () => {
    await expect(dbError(createUser(prisma, { email: ' Mixed@Example.test' }))).resolves.toMatchObject({
      ...CHECK,
      constraint: 'User_email_normalized_check',
    });
  });

  it('rejects a second conversation for the same (productId, buyerId, sellerId)', async () => {
    await createConversation(prisma, { product, buyerId: buyer.id });

    await expect(dbError(createConversation(prisma, { product, buyerId: buyer.id }))).resolves.toEqual({
      ...UNIQUE,
      constraint: 'Conversation_productId_buyerId_sellerId_key',
    });
  });

  it('rejects a reused (senderId, clientMessageId) but allows the same key for another sender', async () => {
    const conversation = await createConversation(prisma, { product, buyerId: buyer.id });
    const base = { conversationId: conversation.id, body: 'Bonjour', clientMessageId: 'client-1' };
    await prisma.message.create({ data: { ...base, senderId: buyer.id, seq: 1 } });

    await expect(dbError(prisma.message.create({ data: { ...base, senderId: buyer.id, seq: 2 } }))).resolves.toEqual({
      ...UNIQUE,
      constraint: 'Message_senderId_clientMessageId_key',
    });
    await expect(prisma.message.create({ data: { ...base, senderId: seller.id, seq: 2 } })).resolves.toMatchObject({
      seq: 2,
    });
  });

  it('rejects a duplicate (conversationId, seq)', async () => {
    const conversation = await createConversation(prisma, { product, buyerId: buyer.id });
    const base = { conversationId: conversation.id, body: 'Bonjour', seq: 1 };
    await prisma.message.create({ data: { ...base, senderId: buyer.id, clientMessageId: 'a' } });

    await expect(
      dbError(prisma.message.create({ data: { ...base, senderId: seller.id, clientMessageId: 'b' } })),
    ).resolves.toEqual({ ...UNIQUE, constraint: 'Message_conversationId_seq_key' });
  });
});

describe('CHECK constraints', () => {
  it.each(['0.00', '-1.00', '1000000.01'])('rejects price %s', async (price) => {
    await expect(
      dbError(createProduct(prisma, { sellerId: seller.id, categoryId: category.id }, { price })),
    ).resolves.toMatchObject({ ...CHECK, constraint: 'Product_price_range_check' });
  });

  it.each(['0.01', '1000000.00'])('accepts boundary price %s', async (price) => {
    const row = await createProduct(prisma, { sellerId: seller.id, categoryId: category.id }, { price });
    expect(row.price.toFixed(2)).toBe(price);
  });

  it.each(['EUR', 'mad', '123'])('rejects currency %s', async (currency) => {
    await expect(
      dbError(createProduct(prisma, { sellerId: seller.id, categoryId: category.id }, { currency })),
    ).resolves.toMatchObject({ ...CHECK, constraint: 'Product_currency_allowlist_check' });
  });

  it('rejects a conversation whose buyer is the seller', async () => {
    await expect(dbError(createConversation(prisma, { product, buyerId: seller.id }))).resolves.toMatchObject({
      ...CHECK,
      constraint: 'Conversation_buyer_not_seller_check',
    });
  });
});

describe('ON DELETE RESTRICT', () => {
  it('refuses to delete a user who owns a product', async () => {
    await expect(dbError(prisma.user.delete({ where: { id: seller.id } }))).resolves.toEqual({
      ...RESTRICT,
      constraint: 'Product_sellerId_fkey',
    });
    await expect(prisma.user.count({ where: { id: seller.id } })).resolves.toBe(1);
  });

  it('refuses to delete a user who has a session', async () => {
    await prisma.session.create({
      data: {
        userId: buyer.id,
        refreshTokenHash: 'digest-1',
        familyId: '00000000-0000-4000-8000-000000000001',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      },
    });

    await expect(dbError(prisma.user.delete({ where: { id: buyer.id } }))).resolves.toEqual({
      ...RESTRICT,
      constraint: 'Session_userId_fkey',
    });
  });

  it('refuses to delete a category that still has products', async () => {
    await expect(dbError(prisma.category.delete({ where: { id: category.id } }))).resolves.toEqual({
      ...RESTRICT,
      constraint: 'Product_categoryId_fkey',
    });
    await expect(prisma.product.count({ where: { id: product.id } })).resolves.toBe(1);
  });

  it('refuses to delete a product that has a conversation', async () => {
    await createConversation(prisma, { product, buyerId: buyer.id });

    await expect(dbError(prisma.product.delete({ where: { id: product.id } }))).resolves.toEqual({
      ...RESTRICT,
      constraint: 'Conversation_productId_fkey',
    });
  });

  it('refuses to delete a conversation that has messages', async () => {
    const conversation = await createConversation(prisma, { product, buyerId: buyer.id });
    await prisma.message.create({
      data: { conversationId: conversation.id, senderId: buyer.id, body: 'Bonjour', clientMessageId: 'c1', seq: 1 },
    });

    await expect(dbError(prisma.conversation.delete({ where: { id: conversation.id } }))).resolves.toEqual({
      ...RESTRICT,
      constraint: 'Message_conversationId_fkey',
    });
    await expect(prisma.message.count({ where: { conversationId: conversation.id } })).resolves.toBe(1);
  });

  it('refuses to delete a conversation that has participants', async () => {
    const conversation = await createConversation(prisma, { product, buyerId: buyer.id });
    await prisma.conversationParticipant.create({
      data: { conversationId: conversation.id, userId: buyer.id, role: 'BUYER' },
    });

    await expect(dbError(prisma.conversation.delete({ where: { id: conversation.id } }))).resolves.toEqual({
      ...RESTRICT,
      constraint: 'ConversationParticipant_conversationId_fkey',
    });
  });
});
