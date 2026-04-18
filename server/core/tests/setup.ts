import { closeDatabase } from '../src/db/database.js';
import { afterEach } from 'vitest';

process.env.MONITOR_DB_PATH = ':memory:';

afterEach(() => {
  closeDatabase();
});
