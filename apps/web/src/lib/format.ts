/** Presentation helpers shared by the tables and detail panes. */

export function shortId(value: string, keep = 8): string {
  return value.length <= keep ? value : `${value.slice(0, keep)}…`;
}

/** "1024" CPU units render as "1 vCPU"; anything unparsable passes through. */
export function cpuLabel(cpu: string | null): string {
  if (!cpu) return "-";
  const units = Number(cpu);
  if (!Number.isFinite(units)) return cpu;
  return units >= 1024
    ? `${(units / 1024).toFixed(units % 1024 === 0 ? 0 : 2)} vCPU`
    : `${units} u`;
}

export function memoryLabel(memory: string | null): string {
  if (!memory) return "-";
  const mib = Number(memory);
  if (!Number.isFinite(mib)) return memory;
  return mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GiB` : `${mib} MiB`;
}

/** "123456789012.dkr.ecr…/api:sha-abc123" -> "api:sha-abc123" */
export function imageLabel(image: string | null): string {
  if (!image) return "-";
  const slash = image.lastIndexOf("/");
  return slash === -1 ? image : image.slice(slash + 1);
}

export function percent(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

export function clockTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fullTimestamp(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

/**
 * Coarse "how long has this been up" for a list column: days and hours, not
 * seconds. Precision here would imply the number means more than it does —
 * it is time since ECS last reported the rollout complete.
 */
export function uptimeLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "-";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
