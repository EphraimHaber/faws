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

const log = createLogger("exec");

export function registerExecDrivers(): void {
  if (process.env["FAWS_EXEC_DEV_ECHO"] === "1") {
    // Deliberately every kind: the echo driver stands in for whichever one is
    // being debugged.
    registerExecDriver("ecs", echoDriverFactory);
    registerExecDriver("ssm", echoDriverFactory);
    registerExecDriver("ssh", echoDriverFactory);
    log.warn("FAWS_EXEC_DEV_ECHO=1 - every exec session is a local echo, nothing will connect");
  }
}
