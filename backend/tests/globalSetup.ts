// Runs once before the whole test run: rebuilds the test database from the
// migrations so every run starts from the committed schema. The URL guard in
// testDbGuard.ts refuses anything but a local database named *test*.
import { resetTestDatabase } from './helpers/testDb.js';

export default function setup(): void {
  resetTestDatabase();
}
