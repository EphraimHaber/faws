# Architecture

faws is a desktop operations console. It talks to AWS, Kubernetes/OpenShift and S3-compatible storage on your own network, and it works with any combination of them, including none of the clouds.

## Processes

```
apps/desktop (Electron main)
  ├─ spawns apps/server  (Fastify: tRPC at /trpc, Socket.IO at /ws, bytes at /api/*)
  └─ loads  apps/web     (React renderer, served by the server in a packaged build)
```

- **`apps/desktop`** is a thin shell. It holds the window, the app menu, the preload bridge (`window.faws`) and, eventually, the updater. It owns no domain logic.
- **`apps/server`** does all the work. It runs the AWS SDK calls, the `kubectl`/`oc`/`virtctl` subprocesses, the terminals (node-pty, ssh2) and the settings file. The renderer reaches it through:
  - **tRPC over HTTP** for queries and mutations. `AppRouter` is the only thing the web app imports from the server, and it is a type.
  - **Socket.IO** for push: settings sync, terminal streams, S3 scans and navigation.
  - **Plain HTTP under `/api/`** for bytes (object reads and uploads). superjson would buffer them and base64 them.
- **`apps/web`** is the UI: TanStack Router, TanStack Query through `@trpc/tanstack-react-query`, and zustand for client state.

Every path that is not `/trpc`, `/ws` or `/api/*` serves the web app's shell, so deep links and reloads land on the right page. New server HTTP routes go under `/api/`.

## Packages

Internal packages are **just-in-time**: their `exports` point at TypeScript source, and they have no build step. The apps compile them: Vite for web, tsdown for server and desktop.

| Package | Role | May import |
|---|---|---|
| `@faws/shared` | Pure helpers: time, bytes, arn, glob, data dir | nothing internal |
| `@faws/kit` | Provider SDK. `.`: `DomainError` and the shared errors; `./guard`: the write-mode switches; `./server`: the tRPC instance, effect meta and error classification | nothing internal |
| `@faws/contracts` | Zod schemas and types every layer agrees on, including the settings file | `shared`, `kit` (root only) |
| `@faws/socket-io-events` | Typed Socket.IO event maps | `contracts` |
| `@faws/core` | AWS clients, fetchers and actions; the S3-compatible endpoint client and stores | `contracts`, `shared`, `kit/guard` |
| `@faws/server` (app) | tRPC routers, socket namespaces, settings store, exec host | everything above |
| `@faws/web` (app) | UI | `contracts`, `shared`, `socket-io-events`; **types only** from `@faws/server` |

`.dependency-cruiser.cjs` enforces these edges (`pnpm check:deps`).

## Where this is heading

The app is moving from "an AWS console with extras" to **providers and capabilities**:

- **Provider.** AWS, Kubernetes, and S3-compatible storage are each a provider, which the user can switch on or off. Each one is declared once with `defineProvider` in `@faws/kit`. The tRPC router, routes, settings section, sidebar group, command palette entries and app menu are all derived from that declaration.
- **Capability.** A cross-provider interface such as `objectStorage`, `logs`, `terminal` or `workloads`. Generic UI is written once against a capability. For example, one bucket browser serves both AWS S3 and MinIO.
- **Connection.** Where a provider points: an AWS profile and region, a kube context and namespace, or an S3 endpoint. Each provider has an active connection, stored as its scope.

- `packages/providers/kubernetes` is the reference provider: `./manifest` for the nav, and `./server` for its tRPC router (built from `providerProcedure("kubernetes")`), the shell it contributes as a `TerminalContribution`, and the lookups the host's first-run detection uses. It depends on `@faws/kit/server` for everything host-like: the gate, logging, binary lookup, pty spawning and the terminal driver contract.
- `packages/providers/aws` has `./server` too: one router per AWS service, gated by `awsProcedure`, calling the engines in `@faws/core`. Its terminal drivers (ECS exec, SSM, EC2 Instance Connect) are still in the host's exec stack.
- `packages/providers/s3compat` and the AWS manifest have a `./manifest` subpath: plain data (services, sections, capabilities, runtime defaults, icon names) built with `defineProvider`. `apps/web/src/services/registry.ts` derives the nav from them. Each provider will grow `./contracts`, `./server` and `./web` subpaths as its code moves in.
- `packages/lib-aws` and `packages/lib-s3` (planned): engines with no UI, shared by providers.

The boundary rules for them are already in `.dependency-cruiser.cjs`: providers never import each other, kit never imports providers, and web modules see server code as types only.

Code moves into this shape a step at a time, with the app working after every step. While it does, `apps/web/src/services/registry.ts` remains the nav seam, and `ScopeContext.tsx` remains where scope is read.
