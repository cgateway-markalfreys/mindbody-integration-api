const seen = new Set<string>();

export const once = (key: string, ttlMs = 600_000): boolean => {
  if (seen.has(key)) {
    return false;
  }

  seen.add(key);
  setTimeout(() => seen.delete(key), ttlMs).unref?.();
  return true;
};
