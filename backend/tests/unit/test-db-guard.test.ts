import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabaseUrl, withDatabaseName } from '../helpers/testDbGuard.js';

const DEV = 'postgresql://u:p@localhost:5434/marketplace_dev';

describe('test database URL guard', () => {
  it.each([
    'postgresql://u:p@localhost:5433/marketplace_test',
    'postgres://u:p@127.0.0.1:5433/marketplace_test',
    'postgresql://u:p@[::1]:5433/test',
    'postgresql://u:p@db-test:5432/marketplace_test',
    'postgresql://u:p@localhost:5433/marketplace_test_blank_ab12',
  ])('accepts %s', (url) => {
    expect(() => assertSafeTestDatabaseUrl(url, DEV)).not.toThrow();
  });

  it.each([
    ['remote host', 'postgresql://u:p@db.example.com:5432/marketplace_test', /non-local/],
    ['dev compose host', 'postgresql://u:p@db-dev:5432/marketplace_test', /non-local/],
    ['non-test name', 'postgresql://u:p@localhost:5434/marketplace_dev', /does not contain "test"/],
    ['name merely containing test', 'postgresql://u:p@localhost:5433/latest', /does not contain "test"/],
    ['other scheme', 'mysql://u:p@localhost:3306/marketplace_test', /postgresql/],
    ['garbage', 'not a url', /valid URL/],
  ])('refuses a %s', (_label, url, message) => {
    expect(() => assertSafeTestDatabaseUrl(url, DEV)).toThrow(message);
  });

  it('refuses a URL equal to DATABASE_URL', () => {
    const url = 'postgresql://u:p@localhost:5433/marketplace_test';
    expect(() => assertSafeTestDatabaseUrl(url, url)).toThrow(/separate from DATABASE_URL/);
  });

  it('swaps only the database name', () => {
    expect(withDatabaseName('postgresql://u:p@localhost:5433/marketplace_test?x=1', 'other_test')).toBe(
      'postgresql://u:p@localhost:5433/other_test?x=1',
    );
  });
});
