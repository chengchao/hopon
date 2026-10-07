# AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `chengchao/hopon`, via the `gh` CLI. Read one with `gh issue view <n> --json title,body,labels,comments`; see `docs/agents/issue-tracker.md` for the rest.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`, created lazily. See `docs/agents/domain.md`.

### Vendored source

`repos/effect` is Effect's source (v4), vendored with `git subtree` as read-only reference. When writing or reviewing Effect code, grep it for the real API and idiomatic patterns (`packages/*/src`, `packages/*/test`) before guessing or searching the web. Import from the `effect` npm package; edit nothing under `repos/`. Update by re-adding it; `git subtree pull` fails because squash-merged PRs drop the subtree metadata:

```bash
git rm -rq repos/effect && git commit -m "chore: drop vendored Effect for re-add"
git subtree add --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash -m "chore: update vendored Effect"
```

## Code standards

Ultracite (oxlint + oxfmt) lints and formats. The pre-commit hook runs `ultracite fix` on staged files; `pnpm check` runs everything CI runs (tests, lint, format, typecheck). Before writing or reviewing TypeScript or React, read `docs/agents/ultracite.md`.
