const seenKeys = new Set<string>();

export const once = (key: string, ttlMs = 600_000): boolean => {
  if (seenKeys.has(key)) {
    return false;
  }

  seenKeys.add(key);

  const timeout = setTimeout(() => {
    seenKeys.delete(key);
  }, ttlMs);

  if (typeof timeout.unref === "function") {
    timeout.unref();
  }

  return true;
};
