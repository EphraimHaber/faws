# Changesets

The app's version and its changelog (`apps/desktop/CHANGELOG.md`, which the
app also shows under "What's new") come from the notes in this folder.

Add one for every change a user would notice:

```bash
pnpm change "Show each provider's health on the overview" minor
```

The kind is `patch` (fixes, the default), `minor` (new features) or `major`.
Write the summary the way the commit subjects are written: one plain sentence
about what the user sees. Chores, refactors and dependency bumps get none.

Only `@faws/desktop` is ever named: it is the one thing that is released, and
its version is the app's version.
