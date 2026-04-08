import { describe, expect, it } from 'vitest';
import { getOwnerColor, FREE_COLOR, UNKNOWN_COLOR, UNATTRIBUTED_COLOR } from '../src/utils/ownerColor.js';

describe('getOwnerColor', () => {
  it('returns a fixed caution color for unknown ownerKind', () => {
    expect(getOwnerColor('unknown', 'unknown')).toBe(UNKNOWN_COLOR);
  });

  it('returns a fixed slate color for unattributed ownerKey', () => {
    expect(getOwnerColor('unattributed', 'unknown')).toBe(UNATTRIBUTED_COLOR);
  });

  it('returns a palette color for person ownerKind', () => {
    const color = getOwnerColor('person:abc123', 'person');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color).not.toBe(UNKNOWN_COLOR);
    expect(color).not.toBe(UNATTRIBUTED_COLOR);
  });

  it('returns a palette color for user ownerKind', () => {
    const color = getOwnerColor('user:alice', 'user');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color).not.toBe(UNKNOWN_COLOR);
  });

  it('returns the same color for the same ownerKey across calls', () => {
    const key = 'person:stable-test-id';
    const color1 = getOwnerColor(key, 'person');
    const color2 = getOwnerColor(key, 'person');
    expect(color1).toBe(color2);
  });

  it('produces different colors for different ownerKeys (probabilistically)', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      colors.add(getOwnerColor(`person:user-${i}`, 'person'));
    }
    // With 16 palette colors and 20 keys, we should get multiple distinct colors
    expect(colors.size).toBeGreaterThan(1);
  });

  it('FREE_COLOR is defined as a valid CSS color', () => {
    expect(FREE_COLOR).toBeTruthy();
  });
});
