// Merges settings pulled from the cloud into the local ones: newer ones replace the local copy (last change wins), new ones are added, sorted by position.
// A global preset (own false) never replaces a user's own item of the same name.

export interface Versioned<T> {
  value: T;
  updatedAt: string;
  order: number;
  own?: boolean;
}

export interface LocalVersion {
  updatedAt: string;
  order: number;
  own?: boolean;
}

/**
 * current is the list now in the interface (it may hold new changes not yet in the database); local holds each item's version in the local database.
 * Returns the merged list and the remote versions that won (to write to the local database).
 */
export function mergeLatest<T>(
  current: readonly T[],
  local: ReadonlyMap<string, LocalVersion>,
  remote: readonly Versioned<T>[],
  key: (x: T) => string,
): { list: T[]; won: Versioned<T>[] } {
  const won = remote.filter((r) => {
    const l = local.get(key(r.value));
    if (!l) return true;
    if (r.own === false && l.own) return false;
    return r.updatedAt > l.updatedAt;
  });
  if (won.length === 0) return { list: [...current], won };
  const winner = new Map(won.map((w) => [key(w.value), w]));
  // Items with no version (just added, not yet in the database) go last, in their original order
  const orderOf = (x: T) => winner.get(key(x))?.order ?? local.get(key(x))?.order ?? Number.MAX_SAFE_INTEGER;
  const merged = current.map((x) => winner.get(key(x))?.value ?? x);
  const known = new Set(current.map(key));
  const added = won.filter((w) => !known.has(key(w.value))).map((w) => w.value);
  // At the same position, the one from the cloud goes first (its position is the one it declared)
  const list = [...merged, ...added]
    .map((x, index) => ({ x, order: orderOf(x), remote: winner.has(key(x)) ? 0 : 1, index }))
    .sort((p, q) => p.order - q.order || p.remote - q.remote || p.index - q.index)
    .map((p) => p.x);
  return { list, won };
}
