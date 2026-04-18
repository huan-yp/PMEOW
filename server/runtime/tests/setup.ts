import { afterEach } from 'vitest';
import { closeDatabase } from '@monitor/core';

process.env.MONITOR_DB_PATH = ':memory:';

afterEach(() => {
  closeDatabase();
});
