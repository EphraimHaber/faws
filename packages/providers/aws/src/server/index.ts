/**
 * AWS on the server: one router per service, each gated on AWS being on, and
 * the terminals AWS contributes. The engines they call - SDK clients,
 * fetchers, actions - are in `@faws/core`.
 *
 * ECS exec and SSM are whole terminals. SSH belongs to the host, so AWS
 * contributes only the two routes to an SSH host that need it: an SSM tunnel
 * to an instance with no address, and an EC2 Instance Connect key pushed for
 * one session.
 */
import type { ExecHandshakeAuth, SshTransport } from "@faws/contracts";
import type { SshRouteContribution, TerminalContribution } from "@faws/kit/server";

import { ecsDriverFactory } from "./exec/ecs.driver.ts";
import { instanceConnectRoute } from "./exec/instanceConnect.ts";
import { ssmDriverFactory } from "./exec/ssm.driver.ts";
import { ssmTunnelRoute } from "./exec/ssmTunnel.ts";

export { apiGatewayRouter } from "./api-gateway.router.ts";
export { awsRouter } from "./aws.router.ts";
export { cloudwatchRouter } from "./cloudwatch.router.ts";
export { ecsActionsRouter } from "./ecs-actions.router.ts";
export { ecsRouter } from "./ecs.router.ts";
export { resolveSessionPlugin } from "./exec/sessionPlugin.ts";
export { awsProcedure, scopeInput } from "./procedures.ts";

export const awsTerminals: ReadonlyArray<TerminalContribution<"ecs" | "ssm", ExecHandshakeAuth>> = [
  { kind: "ecs", factory: ecsDriverFactory },
  { kind: "ssm", factory: ssmDriverFactory },
];

export const awsSshRoutes: ReadonlyArray<
  SshRouteContribution<"ssm-tunnel" | "ec2-instance-connect", SshTransport>
> = [ssmTunnelRoute, instanceConnectRoute];
