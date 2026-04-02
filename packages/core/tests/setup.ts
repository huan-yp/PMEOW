import { closeDatabase } from '../src/db/database.js';
import { afterEach } from 'vitest';

// Use in-memory database for tests
process.env.MONITOR_DB_PATH = ':memory:';

afterEach(() => {
  closeDatabase();
});
