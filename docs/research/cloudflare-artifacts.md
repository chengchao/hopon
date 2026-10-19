# Cloudflare Artifacts for Draft Revisions

Researched 2026-10-18.

**Question:** Should the Talker store a Draft's **Revisions** in Cloudflare's Git-compatible storage product instead of plain R2 prefixes?

A Revision is a handful of small text files (`index.html`, `game.ts`, `game.js`, `audio.json`, `music.mjs`), plus sometimes `music.opus` (280–460 KB, usually unchanged). The Creator can go back to any earlier Revision (Undo), and the next turn builds from it. A Worker serves one Revision to the WebView, and Publish copies one Revision to permanent storage. The E2B sandbox has no network egress, so only the Durable Object can read or write.

**Short answer: no. Use R2.** The product exists, is named **Artifacts**, and fits the "repo per unit of agent work" shape. But for hopon it is the wrong tool:

- **The Workers binding cannot write.** You can only commit by speaking Git. The Durable Object would have to bundle `isomorphic-git`, rebuild the parent tree in memory, and `git push` over HTTPS on every turn.
- **It costs more.** Storage is $0.50/GB-month against R2's $0.015, and operations are $0.15 per 1,000 against R2's $4.50 per million. Even with Git's dedup and zlib, one Draft costs about 6× more to store than full R2 copies.
- **It is in open beta.** Open beta started 2026-10-01 and billing started 2026-10-14.
- **hopon can't use what makes it worth paying for.** Its value is a Git remote that any client can clone, plus forks and repo-scoped tokens. hopon's sandbox can't reach the network, so none of that applies.

Keep the R2 plan. Content-addressed blobs are a small, optional upgrade, mostly for `music.opus`.

## 1. What it is, and its status

- **Name and purpose:** "Artifacts", described as a "versioned file system that speaks Git". It has three surfaces: a Workers binding, a REST API, and the Git smart-HTTP protocol ([announcement blog](https://blog.cloudflare.com/artifacts-git-for-agents-beta/); [docs overview](https://developers.cloudflare.com/artifacts/)).
- **Timeline:**
  - **Private beta** on 2026-04-16.
  - **Wrangler commands** on 2026-05-18.
  - **Dashboard** on 2026-06-17.
  - **EU/US jurisdictions** on 2026-08-13.
  - **Open beta** on 2026-10-01, "available for customers on the Workers Paid plan".

  Source: [changelog](https://developers.cloudflare.com/artifacts/platform/changelog/). It is not GA.

- **Plan:** It is available on Workers Paid only. Workers Free is "Unavailable", and billing began on **October 14, 2026** ([pricing](https://developers.cloudflare.com/artifacts/platform/pricing/)).
- **How it is built:** Each repo is a Durable Object. Git objects live in its SQLite, through `state.storage.kv`, chunked to fit the 2 MB row limit. Snapshots go to R2, and the Git server is Zig compiled to Wasm ([blog](https://blog.cloudflare.com/artifacts-git-for-agents-beta/)). Repo data is "replicated synchronously across multiple data centers" ([How Artifacts works](https://developers.cloudflare.com/artifacts/concepts/how-artifacts-works/)).

## 2. The Workers binding API

Configure it in Wrangler as `"artifacts": [{ "binding": "ARTIFACTS", "namespace": "…" }]`, which needs Wrangler ≥ 4.145.0 ([Workers binding](https://developers.cloudflare.com/artifacts/api/workers-binding/)). The authoritative types are in `@cloudflare/workers-types` 5.20261019.1 (`interface Artifacts`, `interface ArtifactsRepo`). The binding is an ordinary `env` binding, so a Durable Object can call it.

| Need | Binding call | Notes |
| --- | --- | --- |
| Create a repo per Draft | `env.ARTIFACTS.create(name, { setDefaultBranch })` | Returns `remote`, an initial `token`, and an `id`. It throws `ALREADY_EXISTS` if the name is taken |
| **Commit files** | **None** | The types have no write, commit, or put method. The docs say "The Git protocol is the data-plane interface. Use it to read and write commits" ([Repositories](https://developers.cloudflare.com/artifacts/concepts/repositories/)) |
| Read a file at a commit | `using repo = await env.ARTIFACTS.get(name); await repo.readFile({ ref, path })` | `ref` can be a branch, tag, or commit SHA. It returns a MIME-typed `Blob` or `null`, and can throw `MEMORY_LIMIT` because the file is buffered whole. `readBlob(sha)`, `readTree(sha)` and `readCommit(sha)` read raw objects |
| List commits | `repo.log({ ref, limit, offset })` | First-parent chain, newest first, at most 1,000 per page |
| Delete a repo | `env.ARTIFACTS.delete(name)` | Returns `boolean`, and also deletes the repo's tokens |
| Fork | `repo.fork(name, opts)` | Creates a new repo from this one's history |

**Writing from a Durable Object without a git binary** works only through `isomorphic-git` with an in-memory filesystem. Cloudflare's own example does `git.init`, `git.add`, `git.commit` and `git.push` with `isomorphic-git/http/web` ([isomorphic-git example](https://developers.cloudflare.com/artifacts/examples/isomorphic-git/)). That page says the binding "cannot read or write files inside them". It was last updated in May, before `readFile` was added, so the read half is stale, but the write half still holds. Push supports Git protocol v1 receive-pack only ([Git protocol](https://developers.cloudflare.com/artifacts/api/git-protocol/)).

For hopon, each build turn would have to:

1. Get the parent Revision's objects into memory. Either shallow-fetch the selected commit, which costs one more operation, or keep a Git object store in the Talker's SQLite.
2. Write the new files.
3. Commit with that parent.
4. Push with a write token minted through `repo.createToken("write", ttl)`.

Undo means committing on top of an older commit. That leaves you two options: force-push the branch, or push each Revision to its own ref. Either way, the Revision list would still live in the Talker's SQLite, because `log()` only follows the first parent.

## 3. Pricing, limits, and deletion

**Pricing** ([pricing](https://developers.cloudflare.com/artifacts/platform/pricing/)):

|            | Workers Paid included | Overage            |
| ---------- | --------------------- | ------------------ |
| Operations | 10,000 / month        | $0.15 per 1,000    |
| Storage    | 1 GB-month            | $0.50 per GB-month |

Operations are "repo operations, such as `create`, `push`, `pull`, and `clone`". The metrics event types are `create`, `fork`, `push`, `pull` and `delete` ([metrics](https://developers.cloudflare.com/artifacts/observability/metrics/)). The docs never say whether binding reads (`readFile`, `log`) are billed operations. Storage is billed by the average of each day's peak, like Durable Objects SQL storage, and replicas are free.

**Limits** ([limits](https://developers.cloudflare.com/artifacts/platform/limits/)):

- 1 GB per repo.
- 32 MB per file or blob.
- 1 TB per account, which can be raised.
- Unlimited repos and namespaces.
- 2,000 control-plane requests per 10 s per namespace.
- 2,000 Git requests per 10 s per repo.
- Token TTL from 60 s to 1 year ([errors](https://developers.cloudflare.com/artifacts/api/errors/)).

**Deletion:**

- "Repos remain stored until you explicitly delete them" ([pricing](https://developers.cloudflare.com/artifacts/platform/pricing/)).
- `delete(name)` removes the repo and its tokens, and emits a `delete` event ([event subscriptions](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/)).
- No API deletes a single commit or object, and the docs say nothing about garbage collection after a force-push. Pruning old Revisions would mean deleting the whole repo.

## 4. Can a Worker serve a Revision straight from Artifacts?

Functionally, yes. `readFile({ ref: commitSha, path })` returns a typed `Blob` that goes straight into `new Response(blob, { headers: { "content-type": blob.type } })`. Cloudflare's binding example does exactly this.

What's missing:

- **No latency figures.** Cloudflare publishes none for binding reads; it only exposes p50–p999 durations in your own metrics.
- **One trip per file, to one place.** Each file is an RPC to the repo's Durable Object, which lives in one location.
- **Whole-file buffering.** The file is buffered whole, and can throw `MEMORY_LIMIT`.
- **No HTTP caching.** You would add `Cache-Control: immutable` keyed by the commit SHA yourself.

Loading a game takes about 5–6 reads. That's acceptable for the Creator's own preview, but unmeasured. Publish would still copy to R2, because a published Game should not depend on a beta service whose read billing is undocumented.

## 5. Dedup of an unchanged `music.opus`

Git stores content by address, so an unchanged file has the same blob SHA and is stored once per repo. A new commit adds only a new tree and commit object, plus blobs for the files that changed. Text blobs are zlib-compressed. Opus is already compressed, so zlib won't shrink it.

The blog says Artifacts persists the deltas that clients send, but does not compute its own ([blog](https://blog.cloudflare.com/artifacts-git-for-agents-beta/)). So small edits to `game.js` cost roughly a compressed full copy each time, unless the pusher sends deltas.

The docs don't say whether forks share storage.

## 6. Comparison and recommendation

Assume one Draft with 30 Revisions, two music renders, and about 150 KB of changed text per turn:

|  | R2 full copy (`drafts/<id>/<n>/…`) | R2 content-addressed (`drafts/<id>/blobs/<sha256>` + manifest in Talker SQLite) | Artifacts |
| --- | --- | --- | --- |
| Stored per Draft | ~15 MB | ~5–7 MB | ~2–3 MB (dedup + zlib) |
| Storage price | $0.015/GB-mo, 10 GB free ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)) | same | $0.50/GB-mo, 1 GB free |
| ≈ cost per Draft-month | $0.0002 | $0.0001 | $0.0013 |
| Writes per Revision | ~6 Class A ($4.50/M, 1M free) | 2–4 Class A | 1 push, +1 fetch unless the Talker keeps a Git object store ($0.15/1k, 10k free) |
| Write code in the Talker | `R2.put` per file | `crypto.subtle.digest` + `put` if new + one SQLite row | `isomorphic-git` + an in-memory filesystem + a token + a push, plus parent rehydration |
| Serve to WebView | `R2.get(key)` | manifest lookup, then `R2.get(hash)` | `readFile` RPC per file, latency unpublished |
| Undo | pick `n` | pick a manifest | push on an old parent, or force-push |
| Prune or delete | per-object delete, or a lifecycle rule | per-blob delete (needs a reference check) | whole repo only |
| Maturity | GA | GA | open beta, billing since 2026-10-14 |

**Recommendation:** Store Revisions in R2. Full copies per Revision are fine to start with: at about $0.0002 per Draft-month, storage is not a cost driver, and serving is a single `get` with no lookup.

Move to content-addressed blobs once storage shows up on the bill. The change is about 20 lines and removes the repeated `music.opus`, which is most of each Revision's bytes. Publish copies the selected Revision's files under the Game's key in either scheme.

Don't use Artifacts for this. Its strengths are a cloneable Git remote, forks and scoped tokens for outside Git clients, and hopon has no Git client that can reach it.

**When to revisit:**

- Creators or outside tools need to `git clone` a game.
- Remixing becomes `fork()`.
- The binding gains a write or commit method.
