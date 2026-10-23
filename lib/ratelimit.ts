// Sliding-window counters for the site's public endpoints (spec §14: by IP and by phone).
// shortcut: in memory, so one CRM container only; move the counters to Postgres if a second instance ever appears
const hits = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs = 3_600_000, now = Date.now()) {
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, recent);
  if (recent.length >= limit) return false;
  recent.push(now);
  return true;
}
