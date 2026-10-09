import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('returns a v4 UUID', () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it('still works where crypto.randomUUID is missing (plain http on the LAN)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) });
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
