/**
 * Logging for code that lives outside the server app.
 *
 * Provider packages log through this, and the server plugs its own logger in
 * at startup with `setLoggerFactory`. A logger made before that point - at
 * module load, which is when most are - still ends up in the server's log,
 * because each call looks the factory up when it happens.
 */
export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

type LoggerFactory = (name: string) => Logger;

const consoleLogger: LoggerFactory = (name) => ({
  debug: () => {},
  info: (obj, msg) => console.info(`[${name}]`, msg ?? obj, msg ? obj : ""),
  warn: (obj, msg) => console.warn(`[${name}]`, msg ?? obj, msg ? obj : ""),
  error: (obj, msg) => console.error(`[${name}]`, msg ?? obj, msg ? obj : ""),
});

let factory: LoggerFactory = consoleLogger;
const made = new Map<string, Logger>();

export function setLoggerFactory(next: LoggerFactory): void {
  factory = next;
  made.clear();
}

export function createLogger(name: string): Logger {
  const current = () => {
    let logger = made.get(name);
    if (!logger) {
      logger = factory(name);
      made.set(name, logger);
    }
    return logger;
  };
  return {
    debug: (obj, msg) => current().debug(obj, msg),
    info: (obj, msg) => current().info(obj, msg),
    warn: (obj, msg) => current().warn(obj, msg),
    error: (obj, msg) => current().error(obj, msg),
  };
}
