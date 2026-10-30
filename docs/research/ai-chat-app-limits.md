# How consumer AI chat apps charge for and limit usage

Researched 2026-10-29. Every page below was checked that day. These limits change often (OpenAI renamed its models twice this year, and xAI changed plans in June and again in October), so recheck before relying on a number.

**Question:** How do ChatGPT, Claude, Grok and Muse price their plans and limit usage? For each tier: what unit is a limit counted in, how is it shown, what happens at the limit, and how are expensive features (deep research, images, video, agents, coding agents, voice) metered? hopon wants to decide whether to count the Maker's limits in builds, tokens or dollars, per person and globally.

**Short answer:**

- **No one charges a consumer per token for chat.** Every app sells flat monthly tiers ($8 to $500) with an included allowance. Pay-as-you-go only starts once that allowance runs out, as "credits" or "usage credits" priced at API rates (Claude, OpenAI's Codex and Work, Grok, Muse).
- **The unit is an opaque "usage" amount, not messages.** Claude, OpenAI's agent products, Grok and Muse all say the cost of a request depends on the model, the length of the conversation, the tools and the task. None says how much a plan holds in absolute terms. Meta is the exception: it names "Muse tokens" per week but doesn't define them. Plain message counts survive only for chat on some ChatGPT models and for voice hours.
- **Rolling windows are the norm.** Claude has a 5-hour session plus a weekly limit. OpenAI's Codex and Work use 5-hour and weekly windows. Grok and Muse use one weekly pool. Free tiers reset on shorter windows: 5 hours for Claude, daily for Grok.
- **Users see a percentage, not tokens or dollars.** Claude, Grok and Muse show a progress bar or percentage with the reset time. Claude and ChatGPT also warn as the limit nears.
- **At the limit, the default is a hard stop that shows the reset time, with a way to pay.** The options are to upgrade, buy credits or wait. ChatGPT sometimes falls back to a smaller model instead, and Grok drops 720p video to 480p. Claude Code and Codex let a turn already in progress finish.
- **Expensive features draw from the shared pool at a higher rate rather than having a quota of their own.** On Grok, a video or a long coding task "uses far more" of the weekly pool than a chat. Claude's Research "can use up your limits faster". OpenAI image generations use included limits "about 3–5x faster". The exceptions with separate quotas are ChatGPT's deep research (monthly), voice (hours per day) and image limits on Free, and Claude's Fable models (capped at 50% of the weekly limit on Max).

## Sources and how they were read

- OpenAI's help center (help.openai.com), chatgpt.com/pricing and x.ai/pricing returned HTTP 403 to the fetch tool. Their content was read through search-engine excerpts of those official pages, marked **(search excerpt)** below. Everything else was fetched directly.
- **Secondary** marks press or third-party claims where no primary page was found.

## ChatGPT (OpenAI)

OpenAI runs two meters. **Chat** has per-model message caps and per-tool caps. **ChatGPT Work and Codex** (the agent and coding-agent products) share a separate usage allowance in 5-hour and weekly windows, with credits after that ([Codex pricing](https://learn.chatgpt.com/docs/pricing), [Codex with your plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) (search excerpt)).

### Free ($0)

|  |  |
| --- | --- |
| Price | $0 ([Codex pricing](https://learn.chatgpt.com/docs/pricing)) |
| Unit | "Unlimited everyday text chats, subject to abuse-prevention safeguards". Uploads, image generation, voice and data analysis have their own limits ([Free tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) (search excerpt)). Image limits are unpublished. The last published figure was 2 a day in 2024, which is out of date ([release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) (search excerpt)). |
| Shown | The reset time is shown in-product when a limit is hit ([Free tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) (search excerpt)). |
| At limit | Access to that model pauses until reset, or upgrading resets the limit ([Free tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) (search excerpt)). |
| Expensive features | Voice: "limited access" to a small voice model, with no number ([ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice) (search excerpt)). Codex: "quick coding tasks", with no number ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). Credit purchases are open to "a limited group of Free and Go users" ([credits](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro-sora) (search excerpt)). |

### Go ($8/month)

|  |  |
| --- | --- |
| Price | $8/month in the US, with local pricing elsewhere and ads ([announcement](https://openai.com/index/introducing-chatgpt-go/), [What is Go](https://help.openai.com/en/articles/11989085-what-is-chatgpt-go) (search excerpt)) |
| Unit | Unlimited everyday chat as on Free, with "higher limits" for images, uploads and data analysis. No numbers are published ([What is Go](https://help.openai.com/en/articles/11989085-what-is-chatgpt-go) (search excerpt)). |
| Shown / at limit | As on Free. |
| Expensive features | Voice: up to 3 hours on a mini voice model, over a rolling 24 hours ([ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice) (search excerpt)). Codex: "lightweight coding tasks", with no number ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). |

### Plus ($20/month)

|  |  |
| --- | --- |
| Price | $20/month ([Codex pricing](https://learn.chatgpt.com/docs/pricing)) |
| Unit | Chat: per-model message caps. The last published caps were for GPT-5.5: 160 messages every 3 hours, and 3,000 Thinking messages a week. No published cap for the current GPT-6 Sol was found ([GPT-5.5 in ChatGPT](https://help.openai.com/en/articles/11909943-gpt-5-5-in-chatgpt) (search excerpt)). Work and Codex: estimated "local messages per five hours" that vary by model, from 5–45 on GPT-6 Astra to 350–3,000 on GPT-6 Luna. Weekly limits may also apply, and usage depends on "model, task size, reasoning, tool use, and caching" ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). |
| Shown | Chat: a pop-up when the weekly Thinking limit is hit, after which the model can't be picked ([GPT-5.5 in ChatGPT](https://help.openai.com/en/articles/11909943-gpt-5-5-in-chatgpt) (search excerpt)). Codex: a usage dashboard, and `/status` in the CLI ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). |
| At limit | Chat: hitting a Thinking limit "may continue with another available model", which is a fallback ([GPT-6 in ChatGPT](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt) (search excerpt)). Codex: a turn in progress can finish. After that, the user buys credits, uses their own API key, or waits ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). The user can also buy an instant reset of the 5-hour and weekly Work and Codex windows. The price is shown only at checkout ([paid resets](https://help.openai.com/en/articles/20001507-paid-weekly-work-and-codex-rate-limit-resets) (search excerpt)). |
| Expensive features | Deep research: a fixed monthly allowance that "resets every 30 days from the date of your first use". Current counts aren't published ([deep research](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt) (search excerpt)). Images: draw included limits "about 3–5x faster" than similar turns, then credits ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). Voice: 3 hours over a rolling 24 hours ([ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice) (search excerpt)). Video: the Sora app was discontinued on April 26, 2026 ([credits](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro-sora) (search excerpt)). |

### Pro ($100, $200 or $500/month)

|  |  |
| --- | --- |
| Price | Pro 100, Pro 200 and Pro 500. New Pro 200 subscriptions get "a lower usage allowance than previously offered" at the same price ([Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers) (search excerpt)). |
| Unit | Chat: GPT-6 Pro has weekly caps, 200 a week on Pro 200 and 50 a week on Pro 100 ([GPT-6 in ChatGPT](https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt) (search excerpt), from a single article). Work and Codex: no 5-hour limit, but weekly limits may apply. Only relative sizes are given ("Pro 200 includes more usage than Pro 100") ([Codex pricing](https://learn.chatgpt.com/docs/pricing), [Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers) (search excerpt)). Fast mode uses 2.5x the allowance and Ultrafast 8x ([Codex pricing](https://learn.chatgpt.com/docs/pricing)). |
| Shown / at limit | As on Plus: a dashboard, credits, or a paid instant reset. |
| Expensive features | Voice: 15 hours on Pro 100, unlimited on Pro 200 ([ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice) (search excerpt)). Ultrafast is on Pro 500 only ([Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers) (search excerpt)). |

Credits on personal plans are valid for 12 months and pay for Codex, Work and Office add-ins after the included usage runs out ([credits](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro-sora) (search excerpt)). OpenAI Support "does not reset ChatGPT or Codex usage limits" ([Codex with your plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) (search excerpt)).

## Claude (Anthropic): claude.ai, the apps and Claude Code

There is one pool for everything. "Usage across claude.ai, Claude Code, and Claude Desktop counts toward the same limit" ([usage and length limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)). Anthropic publishes no message counts or absolute sizes, only multiples of the Free tier and of Pro. Usage depends on "message length, file attachment size, current conversation length, tool usage, model choice", effort level and artifacts. Cached project content "counts less against your limits when reused" ([best practices](https://support.claude.com/en/articles/9797557), updated 2026-09-22).

### Free ($0)

|  |  |
| --- | --- |
| Price | $0. Sonnet and Haiku only ([pricing](https://claude.com/pricing)). |
| Unit | "A session-based usage limit that will reset every five hours". The number of messages "will vary based on demand" ([Get started](https://support.claude.com/en/articles/8114491-get-started-with-claude)). |
| Shown | The Settings > Usage bars are documented for paid plans only ([best practices](https://support.claude.com/en/articles/9797557)). |
| At limit | Wait for the reset or upgrade ([pricing](https://claude.com/pricing)). |
| Expensive features | Voice mode is on all plans and counts against normal limits ([voice mode](https://support.claude.com/en/articles/11101966-use-voice-mode) (search excerpt)). Research is paid-only. |

### Pro ($20/month, or $17/month billed yearly)

|  |  |
| --- | --- |
| Price | $20/month, or $200/year ([pricing](https://claude.com/pricing), [What is Pro](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan)) |
| Unit | A 5-hour session limit with "at least 5x" Free's usage per session, plus "a weekly usage limit that applies across all models" ([pricing](https://claude.com/pricing), [What is Pro](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan)). Anthropic "may impose" other caps "at our discretion" ([pricing](https://claude.com/pricing)). |
| Shown | Settings > Usage shows progress bars for the current session (with time remaining) and the week (with the reset time) ([best practices](https://support.claude.com/en/articles/9797557)). Warnings read "Approaching session limit" and "You've used X% of your weekly limit" ([error messages](https://support.claude.com/en/articles/12466728-troubleshoot-claude-error-messages)). In Claude Code, `/status` shows the same ([Claude Code with Pro or Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). |
| At limit | A hard stop: "5-hour limit reached - resets [time]" or "You've reached your weekly limit. It resets [day] at [time]." With usage credits on, the message is "continuing with usage credits" ([error messages](https://support.claude.com/en/articles/12466728-troubleshoot-claude-error-messages)). Claude Code may finish the current step ("Usage limit reached · wrapping up"), once a week on Pro ([Claude Code with Pro or Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). |
| Pay as you go | Usage credits at standard API rates, with a spending limit and optional auto-reload. They are enabled on the web ([usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans) (search excerpt)). Bundles of $50, $250 and $1,000 come at 10–30% off, up to $2,000 a month ([bundles](https://support.claude.com/en/articles/14246112-buy-usage-bundles) (search excerpt)). |
| Expensive features | Research is "subject to the same limits" but "can use up your limits faster" ([Research](https://support.claude.com/en/articles/11088861-use-research-on-claude) (search excerpt)). Fable models aren't in Pro's included usage at all and run on usage credits from the first message ([Fable on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan), updated 2026-09-02). Claude Code shares the pool. |

### Max 5x ($100/month) and Max 20x ($200/month)

|  |  |
| --- | --- |
| Price | "From $100/mo", billed monthly. 5x or 20x Pro's usage per session, plus $100 or $200 a month in API credits that can't be spent in Claude or Claude Code ([pricing](https://claude.com/pricing), [Claude Code with Pro or Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). |
| Unit | A 5-hour session limit, a weekly limit across all models, and a separate weekly limit for Fable. Fable can use "up to 50% of your weekly usage limits", and uses them "faster than other models" ([Fable on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)). |
| Shown / at limit | As on Pro. The Claude Code wrap-up can apply at every 5-hour limit ([Claude Code with Pro or Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). |
| Expensive features | When Fable reaches its 50% cap, the user switches model or pays with usage credits ([Fable on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)). |

No separate image or video quota was found. Claude's plan pages don't list image or video generation as metered features.

## Grok (xAI)

xAI is mid-migration. **SuperGrok** plans (Lite, SuperGrok, Plus, Heavy) still run for existing subscribers. Since **2026-10-12**, new customers get **The X Subscription**, which bundles Grok, Cursor and X Premium ([announcement](https://x.ai/news/x-subscription)). Both use the same model: "one shared weekly usage pool" across Chat, Imagine (images and video), Voice and Build (coding), which replaced per-product daily limits from June 2026 ([Grok FAQ](https://docs.x.ai/grok/faq)).

### Free ($0)

|  |  |
| --- | --- |
| Price | $0: "daily access to Grok" plus a starter Cursor allowance ([announcement](https://x.ai/news/x-subscription)). |
| Unit | Free limits on Chat and Voice are separate from the weekly pool and "reset on their own schedule". The numbers aren't published ([Grok FAQ](https://docs.x.ai/grok/faq)). |
| Shown / at limit | Not documented for Free. |

### Paid: The X Subscription (new customers) and SuperGrok (legacy)

| Plan | Price | Included usage |
| --- | --- | --- |
| Plus | $8/month ($80/year) | Base. No Grok Bot ([pricing](https://docs.x.ai/x-subscription/pricing)). |
| Premium | $30/month ($300/year) | 4x Base. Replaces SuperGrok, Cursor Pro and X Premium+ ([announcement](https://x.ai/news/x-subscription)). |
| Super | $100/month ($1,000/year) | 15x Base |
| Ultra | $200/month ($2,000/year) | 50x Base. Matches SuperGrok Heavy's tier ([Grok Bot FAQ](https://docs.x.ai/grok-bot/faq)). |
| SuperGrok (legacy) | $30/month ([x.ai/pricing](https://x.ai/pricing) (search excerpt)) | Lite, Plus and Heavy prices couldn't be confirmed from a primary page. |

|  |  |
| --- | --- |
| Unit | Compute-weighted usage from one weekly pool. "Generating a high-quality video or running a long coding task uses far more" than a chat message ([Grok FAQ](https://docs.x.ai/grok/faq)). Only multipliers are published, no absolute pool sizes ([pricing](https://docs.x.ai/x-subscription/pricing)). |
| Shown | Settings > Usage shows a progress bar, the percentage used, a breakdown by product (API, Build, Chat, Imagine, Voice), the weekly reset date and time, and the credit balance ([Grok FAQ](https://docs.x.ai/grok/faq)). |
| At limit | "Paid features pause until your weekly limit resets", and free Chat and Voice remain. The user can buy Extra Usage Credits ($5 minimum, web only, expiring after 1 year, priced at "standard rates" so each action costs more than plan usage), upgrade, or turn on Auto Top Up with a monthly cap ([Grok FAQ](https://docs.x.ai/grok/faq)). Spend alerts "don't stop usage". Only the monthly limit is a hard stop ([spending caps](https://docs.x.ai/x-subscription/spending-caps)). |
| Expensive features | All draw from the same pool at different rates. 720p video falls back to 480p after the tier's 720p cap ([Grok FAQ](https://docs.x.ai/grok/faq)). Grok Bot (the agent) is metered "by how much effort each task takes, not a flat count per message", across agent steps and tokens, and draws from the same pool on The X Subscription ([Grok Bot FAQ](https://docs.x.ai/grok-bot/faq)). |

## Muse (Meta)

**Which product:** "Muse" here is **Meta's Muse app**, a personal AI agent launched in the US on 2026-09-08 on iOS, Android and muse.ai ([Meta](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)), and in Singapore on 2026-10-27 ([Meta](https://about.fb.com/news/2026/10/muse-is-now-available-in-singapore-the-worlds-first-personal-ai-agent-built-for-everyone/)). It's the only consumer app called just "Muse". Its model is Muse Spark. Meta also uses the Muse name for:

- **Muse Spark**, the model, which also powers the free Meta AI app ([Meta](https://about.fb.com/news/2026/04/introducing-muse-spark-meta-superintelligence-labs/));
- **Muse Image** and **Muse Video**, image and video models;
- **Muse Code**, a developer coding agent with its own $5–$50 plans (secondary: [The New Stack](https://thenewstack.io/muse-code-sdk-pricing/)).

The Meta AI app's extra image and video allowance is sold through **Meta One**: Core at $7.99 and Premium at $19.99, with no numbers published ([Meta](https://about.fb.com/news/2026/09/introducing-meta-one-subscription-service-more-features-ai/)). Search excerpts of Meta's help center describe Meta One's free AI limit as daily.

| Plan | Price | Weekly allowance |
| --- | --- | --- |
| Free | $0 | Unpublished. "Muse is available for free with a usage limit" ([Get started](https://www.meta.com/help/superintelligence/1331373868832401/)). 100M tokens a week is secondary only ([SmartScope](https://smartscope.blog/en/blog/meta-muse-japan-launch-free-plan-limitations-invite-2026/)). Press says a payment card is needed to start (secondary: [TechCrunch](https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/)). |
| Power | $20/month | 500M "Muse tokens" a week ([About Muse subscriptions](https://www.meta.com/help/subscriptions/1021145227643680/)) |
| Maximum | $100/month | 3B Muse tokens a week (same page). 18+ only, in limited testing. |

|  |  |
| --- | --- |
| Unit | "Muse tokens", which aren't defined. Use "varies by feature, request complexity, input and output size, model tier, context length, and tools", and Meta doesn't guarantee a fixed amount of output per token ([buy tokens](https://www.meta.com/help/subscriptions/28153473374286914/)). |
| Shown | Usage is shown in Settings. The dollar figure is "only a pricing reference" ([buy tokens](https://www.meta.com/help/subscriptions/28153473374286914/)). Press describes an in-app meter showing the percentage left (secondary: [TechCrunch](https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/)). |
| At limit | Upgrade, buy a one-time token pack, or "wait until your free limit refreshes" ([About Muse subscriptions](https://www.meta.com/help/subscriptions/1021145227643680/), [Muse subscriptions](https://www.meta.com/help/subscriptions/1625680452306909/)). Press says Muse warns the user before free usage runs out (secondary: TechCrunch). The reset day isn't published. |
| Pay as you go | Token packs are open to anyone, subscribed or not. Purchased tokens never expire, while an unused weekly allowance doesn't roll over. Pack prices appear only in the purchase flow ([buy tokens](https://www.meta.com/help/subscriptions/28153473374286914/)). |
| Expensive features | No separate quotas are published. Everything, including background tasks, draws from the same tokens at rates that vary by feature and model tier ([buy tokens](https://www.meta.com/help/subscriptions/28153473374286914/)). |

## What this means for hopon's Maker

- **Per-person limit: keep counting builds.** A build costs $0.01–0.06, so the spread is about 6x. That's narrower than the spread the big apps hide behind "usage", where Grok and OpenAI meter a video or a long coding task at many times a chat message. Builds are also a unit the person understands. Tokens are what everyone avoids showing, and Meta is the only app that names them, as an undefined "Muse token". If builds start to vary a lot in cost, for example music builds or long fixes, move to a weighted allowance shown as a percentage, as Claude, Grok and Muse do. Even then, show builds or a percentage, never tokens.
- **Global cap: count dollars.** No app publishes a global cap. But every one meters its paid overflow in money at API rates, and xAI makes a monthly dollar cap the only hard stop ([spending caps](https://docs.x.ai/x-subscription/spending-caps)). A global cap protects the bill, so measure the bill: model spend plus container time per UTC day. When it trips, stop new builds for everyone with a "busy, try again at [time]" message.
- **Display:** All the apps show the remaining share and the exact reset time, and warn before the limit. For the Maker that means "3 of 10 builds left today · resets at 9:00 AM" in the person's local time, rather than "00:00 UTC", with a warning at the last one or two builds.
- **At the limit:** A hard stop that shows the reset time is the norm. Upgrading or buying more is offered beside it, but waiting is always an option. hopon has no paid tier, so "come back at [time]" is enough. Claude Code and Codex both let work already running finish ([Claude Code with Pro or Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan), [Codex pricing](https://learn.chatgpt.com/docs/pricing)), so a build that has started should finish even if the limit is reached during it. Only ChatGPT chat falls back to a smaller model. That suits chat, but the Maker's builds depend on its playtest loop, and that may not hold up on a smaller model.
- **Window:** The apps use rolling 5-hour or weekly windows tied to each account. A fixed UTC day is simpler and fine at 10 builds a day. A rolling window only matters if people hit the limit in bursts and complain about the midnight cliff.
