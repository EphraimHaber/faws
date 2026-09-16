/**
 * The server prints `faws-server-port: <port>` once it is listening; the
 * shell parses that line to build the BrowserWindow URL rather than guessing
 * a port and racing the bind.
 */
const PORT_PREFIX = "faws-server-port:";
const URL_PREFIX = "faws-server-url:";

export function parseBackendPort(line: string): number | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PORT_PREFIX)) return null;
  const value = Number(trimmed.slice(PORT_PREFIX.length).trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) return null;
  return value;
}

export function parseBackendUrl(line: string): string | null {
  const trimmed = line.trim();
  return trimmed.startsWith(URL_PREFIX) ? trimmed.slice(URL_PREFIX.length).trim() : null;
}
