import type { RecordCtx } from '../domain/record';

/**
 * Makes a v4 UUID. crypto.randomUUID only works over HTTPS or on localhost;
 * previewing on a phone at a LAN address is plain http, so fall back to building one from getRandomValues.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The id and time for a record made in the interface. */
export const recordCtx: RecordCtx = {
  newId,
  now: () => new Date().toISOString(),
};
