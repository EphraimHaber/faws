/**
 * Driver registration.
 *
 * One place decides which kinds this build can serve, so `main.ts` gains a
 * single import rather than knowing about every driver, and an unregistered
 * kind fails at the handshake with a clear refusal instead of halfway through a
 * connection.
 *
 * SSH is the host's own. Everything else is a provider's contribution, and is
 * registered under that provider's id so the handshake refuses it while the
 * provider is switched off.
 */
import type { ExecHandshakeAuth, ExecKind } from "@faws/contracts";
import type { TerminalContribution } from "@faws/kit/server";
import { awsSshRoutes, awsTerminals } from "@faws/provider-aws/server";
import { kubernetesTerminals } from "@faws/provider-kubernetes/server";

// Installs the provider gate the handshake consults, whichever routers have loaded.
import "../../trpc/providers.ts";
import { createLogger } from "../../shared/logger.ts";
import { echoDriverFactory } from "./drivers/echo.driver.ts";
import { registerSshRoute, sshDriverFactory, sshProvider } from "./drivers/ssh.driver.ts";
import { registerExecDriver, type ExecDriverFactory } from "./exec.service.ts";
import { sweepRecordings } from "./recorder.ts";

const log = createLogger("exec");

/** Every provider's terminals, keyed by the provider that contributes them. */
const contributions: ReadonlyArray<
  readonly [provider: string, ReadonlyArray<TerminalContribution<ExecKind, ExecHandshakeAuth>>]
> = [
  ["aws", awsTerminals],
  ["kubernetes", kubernetesTerminals],
];

export function registerExecDrivers(): void {
  // At startup rather than on a timer: a desktop app is not running when nobody
  // is using it, so a nightly sweep would never fire.
  sweepRecordings();

  for (const route of awsSshRoutes) registerSshRoute("aws", route);

  // The echo driver stands in for every kind, whichever one is being debugged.
  // Each still answers to its provider's switch, so the refusal path can be
  // exercised without a connection too.
  const echo = process.env["FAWS_EXEC_DEV_ECHO"] === "1";
  const pick = (factory: ExecDriverFactory) => (echo ? echoDriverFactory : factory);

  registerExecDriver("ssh", pick(sshDriverFactory), sshProvider);
  for (const [provider, terminals] of contributions) {
    for (const terminal of terminals) {
      registerExecDriver(terminal.kind, pick(terminal.factory), provider);
    }
  }

  if (echo) {
    log.warn("FAWS_EXEC_DEV_ECHO=1 - every exec session is a local echo, nothing will connect");
  }
}
