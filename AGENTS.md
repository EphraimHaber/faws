# faws

Desktop operations console for AWS, Kubernetes and S3-compatible storage. Read `ARCHITECTURE.md` before moving code between packages, adding a package, or adding a server route.

## Dependencies
- Every external dependency is declared once in `pnpm-workspace.yaml`, and a package references it as `catalog:` or `catalog:<family>`. Families that are upgraded together each get a named catalog: react, tanstack, trpc, aws, electron, build.
- Internal packages are referenced as `workspace:*`.
- `pnpm check:catalog` fails on any other specifier.
- Internal packages export TypeScript source and have no build script. The apps bundle them.

## Settings file
- `packages/contracts/src/settings.ts` is the schema. Give every leaf a `.catch(default)`: that fallback is the single definition of the default, and one bad stored value costs only itself.
- Adding a section needs no migration. Moving or renaming data does:
  - Append a raw migration in `apps/server/src/api/settings/migrations.ts`. Migrations transform plain objects and never use the current schema.
  - Bump `SETTINGS_VERSION`.
  - Freeze a fixture of the old file in `__fixtures__/`.

## Safety
- The app is read-only by default. A write goes through the server's write-mode guard. A delete needs the second, never-persisted switch.
- Byte transfer and any other non-tRPC HTTP route lives under `/api/`.

## Vocabulary
- "cluster" means an ECS cluster and nothing else. Kubernetes UI says context, namespace and workload.

## Commits and changes
- Commit subjects are one plain sentence about the user-visible outcome, in the imperative. No `feat:`/`fix:` prefixes.
- Before calling work done, run `pnpm check:catalog`, `pnpm fmt:check`, `pnpm lint`, `pnpm check:deps`, `pnpm typecheck` and `pnpm test`. CI runs the same list.
