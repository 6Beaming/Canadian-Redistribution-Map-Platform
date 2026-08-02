const cache = new Map();

export async function getDaStatistics(dguid, { signal, force = false } = {}) {
  const key = String(dguid ?? "");
  if (!force && cache.has(key)) return cache.get(key);
  const response = await fetch(`/api/map/da/${encodeURIComponent(key)}/statistics`, { signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Statistics request failed (${response.status}).`);
  cache.set(key, payload);
  return payload;
}

export function clearDaStatisticsCache(dguid) {
  if (dguid) cache.delete(String(dguid));
  else cache.clear();
}
