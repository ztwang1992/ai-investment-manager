import { describe, expect, it } from 'vitest';
import { mergeLatest } from './merge';

type Item = { id: string; name: string };
const key = (x: Item) => x.id;
const local = new Map([
  ['a', { updatedAt: '2026-09-30T08:00:00.000Z', order: 0 }],
  ['b', { updatedAt: '2026-09-30T08:00:00.000Z', order: 1 }],
]);
const current: Item[] = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
];

describe('merging cloud changes into this device', () => {
  it('takes a newer version from the cloud and ignores an older one', () => {
    const r = mergeLatest(
      current,
      local,
      [
        { value: { id: 'a', name: 'A2' }, updatedAt: '2026-09-30T09:00:00.000Z', order: 0 },
        { value: { id: 'b', name: 'B-old' }, updatedAt: '2026-09-30T07:00:00.000Z', order: 1 },
      ],
      key,
    );
    expect(r.list).toEqual([
      { id: 'a', name: 'A2' },
      { id: 'b', name: 'B' },
    ]);
    expect(r.won.map((w) => w.value.id)).toEqual(['a']);
  });

  it('adds new items in their position', () => {
    const r = mergeLatest(current, local, [{ value: { id: 'z', name: 'Z' }, updatedAt: '2026-09-30T09:00:00.000Z', order: 1 }], key);
    expect(r.list.map((x) => x.id)).toEqual(['a', 'z', 'b']);
  });

  it('never lets a global preset replace something the user made', () => {
    const own = new Map([['a', { updatedAt: '2026-09-30T08:00:00.000Z', order: 0, own: true }]]);
    const r = mergeLatest(
      [{ id: 'a', name: '我的' }],
      own,
      [{ value: { id: 'a', name: '预置' }, updatedAt: '2026-10-09T00:00:00.000Z', order: 0, own: false }],
      key,
    );
    expect(r.list).toEqual([{ id: 'a', name: '我的' }]);
    expect(r.won).toEqual([]);
  });

  it('keeps items only this device has, such as ones not uploaded yet', () => {
    const withNew = [...current, { id: 'n', name: 'New' }];
    const r = mergeLatest(withNew, local, [{ value: { id: 'a', name: 'A2' }, updatedAt: '2026-09-30T09:00:00.000Z', order: 0 }], key);
    expect(r.list.map((x) => x.id)).toEqual(['a', 'b', 'n']);
  });
});
