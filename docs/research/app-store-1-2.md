# What App Store Guideline 1.2 requires of hopon

Research for [#41](https://github.com/chengchao/hopon/issues/41) (map [#40](https://github.com/chengchao/hopon/issues/40)). Researched 2026-10-06.

**Question:** What does App Review Guideline 1.2 (user-generated content) require, as reviewers apply it today, for an app where signed-in people publish AI-made HTML games to a feed and leave plain-text comments? Specifically: filtering, report response time, ejecting users, terms/EULA, contact info, and Block behavior.

**Short answer:** The written guideline asks for four things: a pre-posting filter, Report with a "timely" response, the ability to block abusive users, and published contact info. It also makes the developer responsible for removing violating content. App Review's standard 1.2 rejection message, unchanged from 2017 to 2025, adds two more: users must agree to terms with a no-tolerance clause, and reports must be acted on **within 24 hours** by removing the content and **ejecting the user**. Those two are not in the guideline, but reviewers send them as requirements, so plan to meet them. Two newer written rules also apply to hopon. Because user-made casual games count as "creator content", there is an age-restriction rule (1.2.1(a), Nov 2025). Because hopon has a social feed with comments, the age rating questionnaire forces a minimum 13+ rating (Sept 2026).

## Evidence levels used below

- **Written:** the text of the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), App Store Connect Help, or an Apple Developer news post. Binding.
- **Template:** the standard rejection text App Review sends for 1.2. It shows up verbatim in developer-forum posts across years. It is Apple's own wording, but it isn't published policy. Strong in practice.
- **Folklore:** claims made in blogs or single forum anecdotes with no Apple source behind them. Weak.

## 1. The written guideline

Guideline 1.2 says that to prevent abuse, apps with user-generated content or social networking services must include:

> - A method for filtering objectionable material from being posted to the app
> - A mechanism to report offensive content and timely responses to concerns
> - The ability to block abusive users from the service
> - Published contact information so users can easily reach you

It also states: "It is your responsibility to remove content that violates this guideline, your terms of service, or your community standards." If Apple finds such content, it will ask the developer to remove it and to provide a plan for better compliance. Egregious or repeated cases are grounds for removing the app. ([guidelines §1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content))

What the written text does **not** say:

- No response time. It says only "timely".
- No definition of "filtering". The only constraint is that it acts _before_ posting ("from being posted").
- No EULA, no required acceptance step, and no required no-tolerance wording. It does mention "your terms of service, or your community standards", which assumes they exist.
- No statement of what Block must do. "Block abusive users from the service" can also be read as operator-side removal, which the rejection template spells out separately as "ejecting".

### 1.2.1 Creator Content applies to hopon's games

1.2.1 covers apps where "non-developer creators … author, share" experiences, including "even casual games". It says these "are treated as user-generated content by App Review" and must follow 1.2. Since the [Nov 13, 2025 update](https://developer.apple.com/news/?id=ey6d8onl), it also says:

> **1.2.1(a)** Creator apps must provide a way for users to identify content that exceeds the app's age rating, and use an age restriction mechanism based on verified or declared age to limit access by underage users.

hopon's AI-made games fit this description. Apple has published nothing on what counts as compliance. The [age assurance Q&A](https://developer.apple.com/support/age-assurance/) does not mention 1.2.1(a). No forum rejection citing it was found.

### 4.7 Mini games repeats the same rules

4.7 covers "HTML5 and JavaScript mini apps and mini games" that are not built into the binary (clarified in Nov 2025). 4.7.1 repeats 1.2's filter, report, timely response and block requirements. 4.7.5 repeats 1.2.1(a)'s age restriction rule word for word. 4.7.4 (an index of software with universal links) is aimed at mini-app platforms. Whether a reviewer would apply it to user-generated games, rather than treating them as 1.2.1 creator content, is untested. **Treat it as a low risk, not a requirement.**

### 1.5 Developer Information: contact must be in the app

> Make sure your app and its Support URL include an easy way to contact you.

([guidelines §1.5](https://developer.apple.com/app-store/review/guidelines/#developer-information)) This is written policy, and it means **in the app**, not only on the store listing.

## 2. The reviewer template (strong, but not guideline text)

This text appears verbatim in rejections posted on Apple's own forums in [2017](https://developer.apple.com/forums/thread/78288), [2019](https://developer.apple.com/forums/thread/116703), [2021](https://developer.apple.com/forums/thread/688227) and [Nov 2025](https://developer.apple.com/forums/thread/807358):

> - Require that users agree to terms (EULA) and these terms must make it clear that there is no tolerance for objectionable content or abusive users
> - A method for filtering objectionable content
> - A mechanism for users to flag objectionable content
> - A mechanism for users to block abusive users
> - The developer must act on objectionable content reports within 24 hours by removing the content and ejecting the user who provided the offending content

The 2021 rejection sent only a subset of the bullets, so reviewers send the parts the app is missing.

| Claim | Source | Strength |
| --- | --- | --- |
| Users must **agree** to terms with a no-tolerance clause | Template only | Strong in practice. Reviewers demand it by name. |
| The agreement must be an affirmative "I agree", not a passive "by signing up you agree" line | One developer's reply in the [2019 thread](https://developer.apple.com/forums/thread/116703); the original poster's passive line was rejected | Weak to medium. A single anecdote, but cheap to satisfy. |
| Act on reports **within 24 hours** | Template only. The guideline says "timely" | Strong as a stated expectation. Reviewers can't measure it; they want to see a working process and to be told about it. |
| Developer must be able to **eject** (ban) the offending user | Template only | Strong in practice. |
| Block must hide content **instantly** and **notify the developer** | No Apple source found. It appears only in third-party blogs | Folklore. |
| Must rate the app 18+; must offer immediate post removal | One Nov 2025 forum anecdote ([807358](https://developer.apple.com/forums/thread/807358), second rejection) | Weak. One reviewer, one app, no stated reason. |
| An AI-output filter can stand in for a higher age rating (17+) | One forum anecdote ([742007](https://developer.apple.com/forums/thread/742007)) | Weak. It does show reviewers link unfiltered AI output to the age rating. |

## 3. Age rating rules that affect hopon's design (written, next to 1.2)

- The age rating questionnaire now asks about **Social Media**: "Redistribution, amplification, or interaction with user-generated content through a social feed … such as views, likes, comments, and shares." Answers have been mandatory since September 2026. ([news, Jul 9 2026](https://developer.apple.com/news/?id=tlur8uvi); [age rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions))
- If an app declares social media capabilities, it is placed in the Social Media Time Allowance category and "receive[s] a minimum age rating of 13+". Apps that disable those features for under-13s must use the Declared Age Range API. ([news, Jun 8 2026](https://developer.apple.com/news/?id=0d2gpmml)) hopon's feed with comments meets this definition, so **hopon will be rated at least 13+**.
- Separately, "User-Generated Content" is its own capability question and does not raise the rating on its own (same definitions page).
- The Declared Age Range API is required "in regions where legally required", even for 18+ apps ([age assurance Q&A](https://developer.apple.com/support/age-assurance/)). That is a legal and regional matter outside the 1.2 bar, flagged here so it isn't lost.

## 4. Applied to hopon

**What counts as a filter?** Apple doesn't define one. The written text requires only that it act before posting. For hopon, an automated check of the prompt, title, description and comment text at publish or comment time, rejecting objectionable input, is a defensible "method for filtering". The map has already ruled out screening the game HTML itself. Nothing written requires machine learning, a vendor service, or human pre-review. **Say in the App Review notes what the filter is.**

**Response time.** Commit to 24 hours. Put it in the terms ("we review reports within 24 hours") and in the App Review notes. For a solo operator, this means getting a notification when a report arrives (email or similar) plus a way to remove the content and ban the user quickly.

**Ejecting users.** Plan for an operator-side ban that stops a user from publishing and commenting and hides their existing content. hopon uses Clerk, whose dashboard and Backend API can ban a user and revoke their sessions. That may cover the "eject" step without custom tooling, but the content-hiding part would still be hopon's own.

**Terms/EULA.** Show short terms with an explicit no-tolerance clause and an affirmative "I agree" before a user can publish or comment, at first sign-in or at first post. Apple's standard EULA does not include a no-tolerance clause, so hopon needs its own terms text, or the standard EULA plus community rules.

**Contact info.** Put a working contact (mailto or support page) inside the app, for example on the Me tab, and also set the Support URL. Guideline 1.5 requires both.

**Block.** The written rule only requires that blocking exists. The obvious user expectation, and the reading reviewers will test, is that the blocked person's games and comments disappear from the blocker's view right away. "Notify the developer" on block has no Apple source. Block is not Report, so it doesn't need to reach the operator, though it is cheap to log.

**1.2.1(a) age restriction.** This is the one written requirement with no Apple guidance on how to meet it. The cheapest reading is to rate hopon honestly (13+ at minimum, because of the social media rule), keep content within that rating through the filter and reports, and let the App Store's rating-based parental controls act as the age restriction. A stricter reading would add a "mature" flag on reports or games plus a Declared Age Range check. This needs a decision on the map.

**Adjacent, outside the 1.2 bar:** account deletion (5.1.1(v)) already exists (`apps/mobile/app/(tabs)/me.tsx`). 5.1.2(i) (Nov 2025) requires disclosing that personal data goes to a third-party AI and getting explicit permission first, which matters because user prompts go to an AI provider. Both are worth their own ticket if not already covered.

## REQUIRED / RECOMMENDED / NOT REQUIRED for hopon

**REQUIRED** (written policy, or Apple's standard rejection template; expect rejection without these)

1. A pre-posting automated filter on prompt, title, description and comment text (written §1.2, §4.7.1).
2. Report on every game and every comment, available in the app (written §1.2).
3. Block another user, which hides their games and comments from the blocker (written §1.2; the hiding behavior is the natural reading, not written).
4. Operator can remove reported content and ban ("eject") the user (written: "your responsibility to remove"; ejecting comes from the template).
5. A 24-hour report-handling commitment backed by a real process: the operator is notified of reports and acts on them (written: "timely"; the 24 hours comes from the template).
6. Terms with a no-tolerance clause for objectionable content and abusive users, agreed affirmatively before publishing or commenting (template).
7. Contact info inside the app plus the Support URL (written §1.2 and §1.5).
8. An honest age rating, at least 13+ because of the social feed with comments (written, Sept 2026 questionnaire), and some answer to 1.2.1(a)'s age restriction for creator content (written, with no guidance on how).

**RECOMMENDED**

- Explain the filter, the report flow, the 24-hour commitment, blocking and banning in the App Review notes, with a demo account.
- Make the agreement an explicit "I agree" button, not a passive "by signing up" line.
- Hide reported content from the reporter right away.
- Use Clerk's built-in user ban for ejecting before building custom tooling.
- Choose a "mature content" report reason so 1.2.1(a)'s "identify content that exceeds the rating" has a concrete answer.

**NOT REQUIRED** (no written basis and no consistent reviewer demand)

- Screening the rendered game HTML, or ML or vendor moderation specifically. Any method that filters before posting will do.
- Notifying the developer when someone blocks (folklore).
- 24/7 staffing, guaranteed automated removal, appeals, or transparency reports.
- An 18+ rating (one anecdote only), or the Declared Age Range API for the 1.2 bar itself (it is needed only to keep social features for under-13s, or where the law requires it).
- An index of games with universal links (§4.7.4). It targets mini-app platforms, and its application to user-made games is untested.
