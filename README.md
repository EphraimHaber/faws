# faws

A desktop console for AWS. Early work in progress.

The shell is service-agnostic: each AWS service is a module that registers
itself, rather than the app being built around any one of them.

ECS was the first one implemented — clusters, services, tasks, deployments,
logs, metrics and load balancer health. S3 is the second: buckets, a paged
object browser, viewers for text, JSON, tables, images, media and raw bytes,
recursive search, uploads and deletes, plus bucket properties, versions and
size. CloudWatch, Lambda and SQS are next.

## Running

```bash
pnpm install
pnpm dev
```

Uses your existing `~/.aws` configuration — profiles, SSO and assume-role all
work, because credentials resolve through the SDK's own provider chain.

Read-only unless you say otherwise. Start with `FAWS_ALLOW_MUTATIONS=1`, or
turn writes on in Settings for the session.

Deleting has a second switch of its own, which is never persisted and is off
again on every start: writing something new and destroying something that was
already there are different risks. Deleting more than one object also asks for
the bucket name to be typed, and says whether the bucket keeps versions, so
"this can be undone" is never a guess.

The ECS mutations remain stubs that return `NOT_IMPLEMENTED`.

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
