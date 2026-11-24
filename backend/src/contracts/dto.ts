import type { Category, Product, User } from '../generated/prisma/client.js';

/**
 * DTO mappers: the only way a database row reaches a response.
 *
 * Rules (docs/backend/api-conventions.md):
 * - Every field is copied by name (allowlist). Rows are never spread, so a column
 *   added to the schema later is not exposed until a mapper lists it.
 * - Prices are sent as a decimal string with exactly two digits plus an ISO 4217
 *   currency, never as a JSON number (no float rounding).
 * - Dates are ISO 8601 strings in UTC.
 */

type Decimal = Product['price'];

/** Serializes a money amount as a string with two decimals, e.g. "1250.00". */
export function serializePrice(price: Decimal): string {
  return price.toFixed(2);
}

export interface CategoryDto {
  id: string;
  label: string;
}

export function toCategoryDto(row: Pick<Category, 'id' | 'label'>): CategoryDto {
  return { id: row.id, label: row.label };
}

/** Public view of a seller: no email, role, status or password hash. */
export interface PublicSellerDto {
  id: string;
  displayName: string;
}

export function toPublicSellerDto(row: Pick<User, 'id' | 'displayName'>): PublicSellerDto {
  return { id: row.id, displayName: row.displayName };
}

/** Public view of an active product listing. */
export interface ProductDto {
  id: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  categoryId: string;
  seller: PublicSellerDto;
  createdAt: string;
  updatedAt: string;
}

export type ProductRow = Pick<
  Product,
  'id' | 'title' | 'description' | 'price' | 'currency' | 'categoryId' | 'createdAt' | 'updatedAt'
> & { seller: Pick<User, 'id' | 'displayName'> };

export function toProductDto(row: ProductRow): ProductDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: serializePrice(row.price),
    currency: row.currency,
    categoryId: row.categoryId,
    seller: toPublicSellerDto(row.seller),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
