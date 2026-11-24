# faws

Desktop operations console for AWS, Kubernetes and S3-compatible storage. Read `ARCHITECTURE.md` before moving code between packages, adding a package, or adding a server route.

## Dependencies
- Every external dependency is declared once in `pnpm-workspace.yaml`, and a package references it as `catalog:` or `catalog:<family>`. Families that are upgraded together each get a named catalog: react, tanstack, trpc, aws, electron, build.
- Internal packages are referenced as `workspace:*`.
- `pnpm check:catalog` fails on any other specifier.
- Internal packages export TypeScript source and have no build script. The apps bundle them.

## Settings file
- `packages/contracts/src/settings.ts` is the schema. Give every leaf a `.catch(default)`: that fallback is the single definition of the default, and one bad stored value costs only itself.
- Adding a section needs no migration. Moving or renaming data in a file a release has shipped does:
  1. Freeze a fixture of the current file as `apps/server/src/api/settings/__fixtures__/settings-v<N>.json` if there isn't one. Never edit a committed fixture.
  2. Bump `SETTINGS_VERSION` and append a raw migration in `migrations.ts`. Migrations transform plain objects and never use the current schema.
  3. Move the value's `read` in `fixtures.test.ts` to where it now lands, and add a fixture for the new version.
- Until the first release, reshape freely: there are no users' files to migrate.
- The renderer reads settings from the Zustand store in `apps/web/src/stores/settings.ts` through narrow selector hooks (`stores/scope.ts` for provider scope and on/off). Use a selector hook, never a React context, for state that the server persists.

## UI patterns
- Every widget that shows fetched data offers refresh and its age. A panel passes its queries to `<PanelHeader refresh={query}>`. Anything else uses `RefreshControl`, or `useRefreshable` to draw its own, from `~/components/refresh`.
- Relative times on screen read `useClock()`, one shared timer, never their own interval.

## Safety
- Every tRPC mutation declares `.meta({ effect })`: `local`, `write` or `destructive`. The tRPC layer enforces write mode from it, and `apps/server/src/router.test.ts` fails on an undeclared one.
- Expected failures extend `DomainError` from `@faws/kit` and are thrown directly. The transport turns them into their declared status and `error.data.cause`.
- The app is read-only by default. A write goes through the server's write-mode guard. A delete needs the second, never-persisted switch.
- Byte transfer and any other non-tRPC HTTP route lives under `/api/`.

## Vocabulary
- "cluster" means an ECS cluster and nothing else. Kubernetes UI says context, namespace and workload.

## Commits and changes
- A change a user would notice also gets a changeset: `pnpm change "one plain sentence" [patch|minor|major]`. That note becomes the release notes and the in-app "What's new".
- Commit subjects are one plain sentence about the user-visible outcome, in the imperative. No `feat:`/`fix:` prefixes.
- Before calling work done, run `pnpm check:catalog`, `pnpm fmt:check`, `pnpm lint`, `pnpm check:deps`, `pnpm typecheck` and `pnpm test`. CI runs the same list.
