/** ISO-8601 or null — the wire format every timestamp in the contracts uses. */
export function toIso(value: Date | string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "3m 12s ago" style relative label used across tables and detail headers. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "-";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";
  const deltaSeconds = Math.round((now - then) / 1000);
  const past = deltaSeconds >= 0;
  const abs = Math.abs(deltaSeconds);
  const label = formatDuration(abs);
  return past ? `${label} ago` : `in ${label}`;
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
