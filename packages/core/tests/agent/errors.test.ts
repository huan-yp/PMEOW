import { describe, expect, it } from 'vitest';
import { AgentCommandError, isAgentCommandError } from '../../src/agent/errors.js';

describe('AgentCommandError', () => {
  it('should construct with code and default message', () => {
    const error = new AgentCommandError('offline');
    expect(error.code).toBe('offline');
    expect(error.message).toBe('Agent 未在线');
    expect(error.name).toBe('AgentCommandError');
    expect(error).toBeInstanceOf(Error);
  });

  it('should construct with custom message', () => {
    const error = new AgentCommandError('internal', 'something broke');
    expect(error.code).toBe('internal');
    expect(error.message).toBe('something broke');
  });

  it('should have default messages for all codes', () => {
    const codes = ['offline', 'timeout', 'not_supported', 'not_found', 'invalid_target', 'invalid_input', 'internal'] as const;
    for (const code of codes) {
      const error = new AgentCommandError(code);
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('isAgentCommandError', () => {
  it('should return true for AgentCommandError', () => {
    expect(isAgentCommandError(new AgentCommandError('offline'))).toBe(true);
  });

  it('should return false for plain Error', () => {
    expect(isAgentCommandError(new Error('offline'))).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isAgentCommandError(null)).toBe(false);
    expect(isAgentCommandError(undefined)).toBe(false);
    expect(isAgentCommandError('offline')).toBe(false);
    expect(isAgentCommandError({ code: 'offline' })).toBe(false);
  });
});
