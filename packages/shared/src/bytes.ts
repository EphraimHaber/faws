const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/**
 * A byte count as something readable at a glance.
 *
 * Binary units, because that is what S3 consoles and `ls -lh` both show, and
 * one decimal place above a kibibyte: the difference between 1.4 and 1.5 GiB
 * is worth seeing, the digits after it are not.
 */
export function byteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Three significant figures keeps the column the same width whether it reads
  // 9.9 or 999 MiB.
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}
