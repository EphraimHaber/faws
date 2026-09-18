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

S3 also reads S3 compatible storage on your own network - MinIO, Ceph RGW,
StorageGRID and the rest. Add an endpoint under Settings: its URL, path style
addressing, its own keys (or an AWS profile, or none for public buckets), and
whatever its certificate needs - a CA file or pasted PEM, a client certificate
for mTLS, a name to verify against when the URL reaches it by IP. Test shows
the certificate it presents before anything is trusted, so a self signed one
can be pinned by fingerprint rather than met by turning verification off, which
is also offered and says what it costs.

Panes that only AWS can fill - daily storage metrics, a bucket's home region -
are absent rather than failing on an endpoint that has no answer for them.

Read-only unless you say otherwise. Start with `FAWS_ALLOW_MUTATIONS=1`, or
turn writes on in Settings for the session.

Deleting has a second switch of its own, which is never persisted and is off
again on every start: writing something new and destroying something that was
already there are different risks. Deleting more than one object also asks for
the bucket name to be typed, and says whether the bucket keeps versions, so
"this can be undone" is never a guess.

The ECS mutations remain stubs that return `NOT_IMPLEMENTED`.

## Settings

Preferences - the AWS profile and region, the refresh interval, the log
columns, the theme, the terminal dock, the saved S3 endpoints, and the list of
silenced warnings - belong to the machine, not to a browser. The server keeps
them in `$FAWS_DATA_DIR/settings/settings.json`, alongside `logs/` and `recordings/`,
and writes it atomically with `0600`.

An S3 endpoint's keys are the one thing that file does not hold. It is read by
the renderer on first paint and broadcast to every window on every change, so
the records live there and the keys live in `s3-secrets.json` beside it, which
nothing broadcasts. A connection carries only which of its secrets are set, so
a form can edit an endpoint without ever being handed what it is editing.

`FAWS_DATA_DIR` defaults to `~/.faws`; the dev runner uses `~/.faws-dev`, and
the desktop shell passes Electron's userData path. Web and desktop on one
machine therefore share one file, and a change in either shows up in every
open window immediately over the existing Socket.IO connection.

The file carries a `version`. An older file is migrated on read and written
back once. A file written by a **newer** faws is served as far as this build
understands it and never written back, so downgrading cannot discard the
preferences the newer install made - the Settings page says so while that
lasts. An unreadable file is moved aside as `settings.json.corrupt-<time>`
rather than deleted, and the app starts from defaults.

If the file cannot be written at all, everything still works from memory for
the life of the server, including the sync between windows; only survival
across a restart is lost, and the Settings page says which errno caused it.

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
