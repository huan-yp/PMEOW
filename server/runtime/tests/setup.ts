import { afterEach } from 'vitest';
import { closeDatabase } from '@pmeow/core';

process.env.MONITOR_DB_PATH = ':memory:';

afterEach(() => {
  closeDatabase();
});
