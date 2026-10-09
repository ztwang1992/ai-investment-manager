import { describe, expect, it, vi } from 'vitest';
import { keepDeviceData } from './keepData';

// Real data lives on this device (IndexedDB): ask the browser not to clear it when space runs low
describe('keeping the data on this device', () => {
  it('asks the browser once', async () => {
    const persist = vi.fn(async () => true);
    await keepDeviceData({ storage: { persisted: async () => false, persist } });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when already kept', async () => {
    const persist = vi.fn(async () => true);
    await keepDeviceData({ storage: { persisted: async () => true, persist } });
    expect(persist).not.toHaveBeenCalled();
  });

  it('carries on quietly where the browser cannot', async () => {
    await expect(keepDeviceData({})).resolves.toBeUndefined();
    await expect(keepDeviceData({ storage: { persisted: async () => false, persist: async () => Promise.reject(new Error('no')) } })).resolves.toBeUndefined();
  });
});
