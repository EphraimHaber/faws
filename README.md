# faws

A desktop console for AWS. Early work in progress.

The shell is service-agnostic: each AWS service is a module that registers
itself, rather than the app being built around any one of them. ECS is the
first one implemented — clusters, services, tasks, deployments, logs, metrics
and load balancer health. CloudWatch, S3, Lambda and SQS are next.

## Running

```bash
pnpm install
pnpm dev
```

Uses your existing `~/.aws` configuration — profiles, SSO and assume-role all
work, because credentials resolve through the SDK's own provider chain.

Read-only today. Mutating operations sit behind a guard and return
`NOT_IMPLEMENTED`.

## Layout

| | |
| --- | --- |
| `apps/server` | Fastify + tRPC over the AWS SDK; the UI never holds credentials |
| `apps/web` | React + TanStack Router/Query/Form/Hotkeys |
| `apps/desktop` | Electron shell |
| `packages/*` | contracts, AWS clients and fetchers, shared helpers |

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
