/**
 * Driver registration.
 *
 * One place decides which kinds this build can serve, so `main.ts` gains a
 * single import rather than knowing about every driver, and an unregistered
 * kind fails at the handshake with a clear refusal instead of halfway through a
 * connection.
 */
import { createLogger } from "../../shared/logger.ts";
import { echoDriverFactory } from "./drivers/echo.driver.ts";
import { registerExecDriver } from "./exec.service.ts";
import { sweepRecordings } from "./recorder.ts";

const log = createLogger("exec");

export function registerExecDrivers(): void {
  // At startup rather than on a timer: a desktop app is not running when nobody
  // is using it, so a nightly sweep would never fire.
  sweepRecordings();

  if (process.env["FAWS_EXEC_DEV_ECHO"] === "1") {
    // Deliberately every kind: the echo driver stands in for whichever one is
    // being debugged.
    registerExecDriver("ecs", echoDriverFactory);
    registerExecDriver("ssm", echoDriverFactory);
    registerExecDriver("ssh", echoDriverFactory);
    log.warn("FAWS_EXEC_DEV_ECHO=1 - every exec session is a local echo, nothing will connect");
  }
}
