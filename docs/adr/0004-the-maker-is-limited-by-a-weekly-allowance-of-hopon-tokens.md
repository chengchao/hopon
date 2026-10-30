# 4. The Maker is limited by a weekly Allowance of hopon tokens

## Status

Accepted. To be built in [#34](https://github.com/chengchao/hopon/issues/34). Replaces today's limit of 10 builds per Creator per UTC day (`DAILY_BUILDS` in `apps/worker/src/talker-prompt.ts`), and the daily global dollar cap that #34 and ADR 0003 planned.

## Context

Today a Creator gets 10 `build` calls a day, charged before each build by `spend()`, an atomic upsert on `generation_limits` keyed `${account}:${YYYY-MM-DD}`. Only a box that can't start is refunded. Chat turns aren't counted at all, and a build counts the same whether it cost $0.004 or $0.025. Nothing measures what the Maker costs at runtime; the numbers exist only in the eval (`apps/maker/eval/results/`): about $0.011 a build and $0.0006 a chat turn on Haiku 5.5.

Consumer AI apps don't count messages or show dollars ([`docs/research/ai-chat-app-limits.md`](../research/ai-chat-app-limits.md)). Grok shows one compute-weighted weekly pool as a percentage; Muse names its own unit, "Muse tokens", with a published weekly allowance. Both weigh usage by what it really costs and hide the cost.

## Decision

- **The unit is the hopon token**, shown to Creators by that name. One hopon token is pi's priced cost of a call (`usage.cost.total`) × 10,000,000, so 1 hopon token is one Haiku 5.5 input token ($0.10 a million). A build is about 110,000; a chat turn about 6,000. Dollars stay internal.
- **Every model call of the Maker counts**: Talker turns and Coder steps, measured after each one. Screening (Llama Guard) and box time don't count.
- **Each Creator's Allowance is 3,000,000 hopon tokens a week**, about 25 builds with chat around them, at most about $0.30 a week. The number is a `vars` value in the Worker's wrangler config, so changing it is a deploy.
- **The week resets for everyone at Monday 00:00 UTC**, shown in the Creator's local time. `spend()`'s bucket key changes from the UTC date to the ISO week.
- **Check, then settle.** A turn or build starts only if the balance is above zero, and its measured cost is charged when it ends. The last one can push the balance below zero; the next week starts full anyway. The per-build ceilings (`MAX_STEPS`, the build deadline) bound the overshoot to one build.
- **At zero, the whole Maker stops for that Creator**, chat and builds, until the week resets. A turn already running finishes. Playing, browsing and sharing Games don't use the Allowance.
- **The Maker shows the balance** in one line, like "1.2M hopon tokens left · resets Mon 8:00 AM", and warns once when it drops below 20%.
- **No global cap in hopon.** The prepaid AI Gateway Unified Billing credits, with auto top-up off, are the backstop: when they run out, model calls fail and the Maker tells the Creator it's resting.

## Considered

- **Builds as the unit** (today). Simple to explain, but chat is free and a build's cost varies about 6×.
- **Dollars as the unit.** Exact, but the owner doesn't want money in front of Creators, and no consumer app shows it.
- **Grok's hidden-unit percentage bar.** Lets weights change unseen; the owner prefers a named unit Creators can count.
- **Fixed weights per action** (a build is 10% of the bar, a chat turn 0.5%). Needs no measuring, but misprices builds the same way counting builds does.
- **A rolling week from each Creator's first use.** Needs a start date per Creator; the fixed week reuses today's bucket scheme.
- **A hopon-side global daily cap.** Per-Creator limits don't bound how many Creators there are, but the prepaid credits already stop spend; a cap of our own would only add a nicer message and an alert.

## Consequences

- The Talker and the Coder read pi's `usage.cost` after each call and settle it into the Creator's weekly bucket; `spend()` takes an amount instead of adding one.
- `DAILY_BUILDS`, the "10 games today" message and the `busy` refund go: a box that can't start uses no model tokens, so it costs nothing.
- Box time isn't counted. It's about $0.003 a build plus up to $0.0045 while the box waits out its 5 minutes, bounded by the number of builds, which the Allowance bounds.
- Changing the model changes what a hopon token buys only through pi's prices; the 10,000,000 rate stays.
- When the credits run out, every Creator's Maker stops at once, and so do the eval and Previews, which share the gateway.
- AI Gateway refuses requests (402) under concurrency even with credit left (`apps/maker/eval/results/2026-10-20.md`), so "resting" can show while credit remains.

## Revisit when

- The credits run out in practice, or spend from many new accounts shows up: build the global cap.
- hopon sells anything: packs or tiers on top of the Allowance.
