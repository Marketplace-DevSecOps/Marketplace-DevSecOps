// Development seed: FICTITIOUS data only (spec 3.2, "jeux de tests fictifs").
// Run with `npm run db:seed` (prisma db seed). Re-running is safe: every row
// is upserted on a stable key (category label, user email, fixed product id).
//
// WARNING: the passwords below are obvious development placeholders. They are
// public in this repository and must never be used in production or on any
// shared/exposed environment. The script refuses to run when
// NODE_ENV=production.
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

if (existsSync('.env')) process.loadEnvFile('.env');

if (process.env.NODE_ENV === 'production') {
  process.stderr.write('Refusing to seed: NODE_ENV=production\n');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write('DATABASE_URL is required\n');
  process.exit(1);
}

// Argon2id with the OWASP minimum profile (19 MiB, t=2, p=1). Phase 3 will
// measure and justify the production parameters.
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const categories = [
  { label: 'Électronique', isActive: true },
  { label: 'Maison', isActive: true },
  { label: 'Livres', isActive: true },
  { label: 'Archives', isActive: false },
];

const users = [
  { email: 'alice@example.test', displayName: 'Alice (A)', role: 'USER', password: 'dev-only-password-A' },
  { email: 'bob@example.test', displayName: 'Bob (B)', role: 'USER', password: 'dev-only-password-B' },
  { email: 'carol@example.test', displayName: 'Carol (C)', role: 'USER', password: 'dev-only-password-C' },
  { email: 'admin@example.test', displayName: 'Admin', role: 'ADMIN', password: 'dev-only-password-admin' },
] as const;

const products = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    sellerEmail: 'alice@example.test',
    categoryLabel: 'Électronique',
    title: 'Casque audio fictif',
    description: 'Annonce de démonstration. Casque sans fil, bon état.',
    price: '450.00',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    sellerEmail: 'bob@example.test',
    categoryLabel: 'Livres',
    title: 'Lot de romans fictifs',
    description: 'Annonce de démonstration. Dix romans de poche.',
    price: '120.50',
  },
];

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const categoryIds = new Map<string, string>();
  for (const c of categories) {
    const row = await prisma.category.upsert({
      where: { label: c.label },
      create: c,
      update: { isActive: c.isActive },
    });
    categoryIds.set(c.label, row.id);
  }

  const userIds = new Map<string, string>();
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email }, select: { id: true } });
    // Hash only on creation so re-runs stay fast and do not churn hashes.
    const row = existing
      ? await prisma.user.update({
          where: { email: u.email },
          data: { displayName: u.displayName, role: u.role, status: 'ACTIVE' },
        })
      : await prisma.user.create({
          data: {
            email: u.email,
            displayName: u.displayName,
            role: u.role,
            passwordHash: await argon2.hash(u.password, HASH_OPTIONS),
          },
        });
    userIds.set(u.email, row.id);
  }

  for (const p of products) {
    const sellerId = userIds.get(p.sellerEmail);
    const categoryId = categoryIds.get(p.categoryLabel);
    if (!sellerId || !categoryId) throw new Error(`Seed reference missing for product ${p.id}`);
    const data = { title: p.title, description: p.description, price: p.price, currency: 'MAD', categoryId };
    await prisma.product.upsert({
      where: { id: p.id },
      create: { id: p.id, sellerId, ...data },
      update: data,
    });
  }

  process.stdout.write(
    `Seeded ${categories.length} categories, ${users.length} users, ${products.length} products\n`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
