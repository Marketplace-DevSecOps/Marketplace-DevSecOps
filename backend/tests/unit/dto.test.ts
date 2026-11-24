import { describe, expect, it } from 'vitest';
import { serializePrice, toCategoryDto, toProductDto, toPublicSellerDto } from '../../src/contracts/dto.js';
import { Prisma } from '../../src/generated/prisma/client.js';

const createdAt = new Date('2025-01-02T03:04:05.678Z');
const updatedAt = new Date('2025-01-03T00:00:00.000Z');

/** A full joined row as Prisma would return it, including private columns. */
function productRow() {
  return {
    id: 'p-1',
    sellerId: 'u-1',
    categoryId: 'c-1',
    title: 'Vélo',
    description: 'Bon état',
    price: new Prisma.Decimal('1250.5'),
    currency: 'MAD',
    status: 'ACTIVE' as const,
    version: 3,
    createdAt,
    updatedAt,
    seller: {
      id: 'u-1',
      email: 'seller@example.test',
      displayName: 'Seller',
      passwordHash: '$argon2id$v=19$secret',
      role: 'USER' as const,
      status: 'ACTIVE' as const,
      createdAt,
      updatedAt,
    },
  };
}

describe('serializePrice', () => {
  it.each([
    ['0.01', '0.01'],
    ['10', '10.00'],
    ['1250.5', '1250.50'],
    ['1000000.00', '1000000.00'],
  ])('serializes %s as the string %s', (input, expected) => {
    expect(serializePrice(new Prisma.Decimal(input))).toBe(expected);
  });
});

describe('toProductDto', () => {
  it('copies only allowlisted fields, with the price as a string plus currency', () => {
    expect(toProductDto(productRow())).toEqual({
      id: 'p-1',
      title: 'Vélo',
      description: 'Bon état',
      price: '1250.50',
      currency: 'MAD',
      categoryId: 'c-1',
      seller: { id: 'u-1', displayName: 'Seller' },
      createdAt: '2025-01-02T03:04:05.678Z',
      updatedAt: '2025-01-03T00:00:00.000Z',
    });
  });

  it('never exposes private columns, even ones added to the row later', () => {
    const row = { ...productRow(), internalNote: 'do not leak' };
    const json = JSON.stringify(toProductDto(row));

    for (const secret of ['passwordHash', 'argon2', 'email', 'internalNote', 'sellerId', 'version', 'status']) {
      expect(json).not.toContain(secret);
    }
  });
});

describe('toPublicSellerDto and toCategoryDto', () => {
  it('keep only the public fields', () => {
    const { seller } = productRow();
    expect(toPublicSellerDto(seller)).toEqual({ id: 'u-1', displayName: 'Seller' });
    const category = { id: 'c-1', label: 'Sport', isActive: true, createdAt, updatedAt };
    expect(toCategoryDto(category)).toEqual({ id: 'c-1', label: 'Sport' });
  });
});
