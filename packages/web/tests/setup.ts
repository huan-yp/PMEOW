import { closeDatabase } from '@monitor/core';
import { afterEach } from 'vitest';

process.env.MONITOR_DB_PATH = ':memory:';

afterEach(() => {
  closeDatabase();
});