# Architecture

faws is a desktop operations console. It talks to AWS, Kubernetes/OpenShift and S3-compatible storage on your own network, and it works with any combination of them, including none of the clouds.

## Processes

```
apps/desktop (Electron main)
  ├─ spawns apps/server  (Fastify: tRPC at /trpc, Socket.IO at /ws, bytes at /api/*)
  └─ loads  apps/web     (React renderer, served by the server in a packaged build)
```

- **`apps/desktop`** is a thin shell. It holds the window, the app menu, the preload bridge (`window.faws`) and the updater. It owns no domain logic. It reads one thing from the settings file the server writes: `settings.trust`, so its own network stack (the window and the updater's downloads) accepts the certificates the server does (`apps/desktop/src/trust.ts`).
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
| `@faws/shared` | Pure helpers: time, bytes, arn, glob, TLS trust codes, data dir | nothing internal |
| `@faws/kit` | Provider SDK. `.`: `DomainError` and the shared errors, `ConnectionRef`, the capability view models; `./guard`: the write-mode switches; `./server`: the tRPC instance, effect meta, error classification, the provider gate and the capability ports (`ObjectStoragePort`); `./testing`: the contract suites a port runs against itself | nothing internal |
| `@faws/contracts` | Zod schemas and types every layer agrees on, including the settings file | `shared`, `kit` (root only) |
| `@faws/socket-io-events` | Typed Socket.IO event maps | `contracts`, `kit` (root only) |
| `@faws/core` | AWS clients, fetchers and actions for the AWS services | `contracts`, `shared`, `kit/guard` |
| `@faws/lib-s3` | The S3 engine: `createS3ObjectStoragePort`, and the client, stores and probe for S3 endpoints that are not AWS | `contracts`, `shared`, `kit` |
| `@faws/provider-*` | One per provider: `./manifest`, and `./server` for its routers and capability ports | `contracts`, `shared`, `kit`, `core`, `lib-*` |
| `@faws/server` (app) | Host: tRPC root, capability routes, socket namespaces, settings store, exec host | everything above |
| `@faws/web` (app) | UI | `contracts`, `shared`, `socket-io-events`, `kit` (root only); **types only** from `@faws/server`; never `lib-*` |

`.dependency-cruiser.cjs` enforces these edges (`pnpm check:deps`).

### Why manifests are packages of their own
Each provider's manifest is a separate workspace package (`packages/providers/<id>/manifest`, `@faws/provider-<id>-manifest`) that depends only on `@faws/kit`. Contracts reads the manifests to shape the settings file, and provider server code reads contracts. If the manifest lived inside the provider package, those two edges would form a package cycle, and turbo refuses to build a workspace with one. The provider package re-exports it as `./manifest`.

## Where this is heading

The app is moving from "an AWS console with extras" to **providers and capabilities**:

- **Provider.** AWS, Kubernetes, and S3-compatible storage are each a provider, which the user can switch on or off. Each one is declared once with `defineProvider` in `@faws/kit`. The tRPC router, routes, settings section, sidebar group, command palette entries and app menu are all derived from that declaration.
- **Capability.** A cross-provider interface such as `objectStorage`, `logs`, `terminal` or `workloads`. Generic UI is written once against a capability. For example, one bucket browser serves both AWS S3 and MinIO.
- **Connection.** Where a provider points: an AWS profile and region, a kube context and namespace, or an S3 endpoint. Capability code names one as a `ConnectionRef` (`{ provider, id }`, from `@faws/kit`); only the provider reads `id`. AWS encodes `profile@region` (`awsConnectionRef` in contracts), a saved endpoint uses its record id (`s3EndpointRef`).

## Capabilities

A capability is an interface in `@faws/kit/server` that providers implement and the host serves. The host never branches on which provider answers: it looks the provider up from the `ConnectionRef`, checks that provider is switched on (`assertProviderEnabled`), and calls its port.

**Object storage** is the first one.

- `ObjectStoragePort` covers what the bucket browser does: features, buckets and their region, versioning and configuration, storage metrics, listings, versions, head, a ranged read stream, scans, single and multipart uploads, delete, copy, folders, tags and signed URLs. Write methods check the write-mode guard themselves, because the byte routes reach them without tRPC.
- Providers register a port at startup with `registerObjectStorage(provider, port)`; the host reaches it with `objectStorageFor(ref)`.
- `@faws/lib-s3` builds a port for anything that speaks S3 from `createS3ObjectStoragePort(resolveClient, options)`. AWS (`packages/providers/aws/src/server/objectStorage.ts`) resolves a client in the bucket's own region and adds CloudWatch metrics; saved endpoints (`packages/providers/s3compat/src/server/objectStorage.ts`) resolve the endpoint client for the stored record.
- The host serves it as the `storage` tRPC router, the `/storage-scan` socket namespace and the `/api/storage/*` byte routes (`apps/server/src/api/storage/`), each taking a `ConnectionRef`.
- The renderer's bucket browser is `apps/web/src/capabilities/object-storage/`, written once against the port's view models and keyed by the `ConnectionRef` its page provides with `StorageConnectionProvider`. The `/s3/...` pages render it for AWS, or for the saved endpoint a `connection` search param names.
- `describeObjectStoragePort` in `@faws/kit/testing` is the behaviour every port owes the browser. `packages/lib-s3/src/port.test.ts` runs it against an AWS-style and an endpoint-style resolver over an in-memory S3 built with `aws-sdk-client-mock`.

A new capability follows the same shape: view models in kit's root, the port and its registry in `kit/server`, a contract suite in `kit/testing`, host routes that dispatch on `ref.provider`, and a renderer component under `apps/web/src/capabilities/`.

## Providers

- `packages/providers/kubernetes` is the reference provider: `./manifest` for the nav, and `./server` for `kubernetesServer` (its tRPC router, built from `providerProcedure("kubernetes")`, paired with the manifest id), the shell it contributes as a `TerminalContribution`, and the lookups the host's first-run detection uses. It depends on `@faws/kit/server` for everything host-like: the gate, logging, binary lookup, pty spawning and the terminal driver contract.
- A provider's router is mounted in `apps/server/src/router.ts` through `mountProviders` from `@faws/kit/server`, which keys it by the manifest id. The client path is therefore the provider id (`trpc.kubernetes.…`) and cannot drift from it.
- `packages/providers/aws` has `./server` too: one router per AWS service, gated by `awsProcedure`, calling the engines in `@faws/core`, plus its object storage port built on `@faws/lib-s3`. Those routers still sit directly under the root as `aws`, `ecs`, `ecsActions`, `cloudwatch` and `apiGateway`, not under one `aws` key through `mountProviders`; nesting them renames every AWS call in the web app, a large codemod that is its own change. It contributes the ECS exec and SSM shells as `awsTerminals`, and `awsSshRoutes` for the two ways AWS reaches an SSH host (an SSM tunnel, an EC2 Instance Connect key). SSH itself stays in the host: its driver owns the handshake, host keys and jump chains, and asks a contributed `SshRouteContribution` for the stream or key when `transport.via` names one.
- The host registers every terminal and SSH route under the provider that contributed it (`apps/server/src/api/exec/index.ts`), and refuses a handshake with `ProviderDisabled` while that provider is switched off.
- `packages/providers/s3compat` has `./server`: the router that saves, tests and removes endpoints (`s3Connections`), its object storage port, and the store contract the host fills with the settings file and the credentials file.
- Every provider has a `./manifest` subpath (its own package, see below): plain data built with `defineProvider`. `apps/web/src/services/registry.ts` derives the nav from them.
- `packages/lib-s3` is an engine with no UI, shared by providers; `packages/lib-aws` is planned.

The boundary rules for them are in `.dependency-cruiser.cjs`: providers never import each other, kit never imports providers, a lib never imports a provider or `core`, the renderer never imports a lib, and web modules see server code as types only.

Code moves into this shape a step at a time, with the app working after every step. `apps/web/src/services/registry.ts` is the nav seam, and provider scope is read through the selector hooks in `apps/web/src/stores/scope.ts`.

## Known gaps

What the current shape does not do yet, or has not been checked against the real thing. Remove an entry when it is done.

**Architecture**
- AWS routers sit directly under the root (`aws`, `ecs`, `ecsActions`, `cloudwatch`, `apiGateway`) rather than under one `aws` key through `mountProviders`. Nesting them renames every AWS call in the web app.
- `@faws/core` is still the AWS engine; splitting it into `lib-aws` is planned, not done.
- Pages keep their original URLs (`/ecs/...`, `/s3/...`) rather than living under `/<provider>/...`; bookmarks and recents depend on them.
- Providers have no `./web` or `./contracts` subpaths yet: their pages are in `apps/web/src/features` and their types in `@faws/contracts`.
- Providers cannot contribute a Socket.IO namespace, so there is no live pod watch: pod lists poll.

**Not verified against the real thing**
- OpenShift sign-in against a real cluster: whether `openshift-cli-client` accepts any loopback port for browser sign-in, token revoke under real RBAC (`oauthaccesstokens` vs `useroauthaccesstokens`), expiry reporting, and an OAuth host with a different CA from the API host. All are covered only by the fake in `packages/providers/kubernetes/src/server/testing`.
- KubeVirt reads through `@kubernetes/client-node`, and contexts that use exec plugins (they stay on the CLI path by design).
- The desktop `openExternal` bridge, and the desktop trust store against a real re-signing proxy (only the decision function is tested).
- Object storage against a live S3-compatible server (MinIO, Ceph); uploads were not exercised in the app.
- The release pipeline: `version.yml` and `release.yml` have never run on GitHub, so tagging, the per-platform builds and the update check between two published versions are untested. Builds are unsigned: macOS needs right-click > Open on first launch and never installs updates in place; Windows SmartScreen warns.

**Known rough edges**
- A Kubernetes username containing spaces (some LDAP setups) produces a context name the context schema refuses.
- When faws creates a kubeconfig from nothing, its one-time backup is taken on the second write rather than the first.
- Which saved S3 endpoint a storage page reads is set by its URL (`?connection=`); the sidebar's Buckets link always opens AWS.
- Desktop ignores `trust.useSystemStore`, since Chromium already uses the operating system's store.
