// Static pages: /terms is the Rules the app links to, /support the App Store Support URL.
// Kept out of index.ts: workerd treats every named export of the Worker entry as an entrypoint.

// Placeholder until the mailbox exists; the app has its own copy in apps/mobile/lib/rules.ts.
const CONTACT_EMAIL = "support@hopon.example";
const contact = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { margin: 0 auto; max-width: 40rem; padding: 1.5rem 1rem 3rem; font: 17px/1.5 system-ui, sans-serif; color: #1d1d2b; background: #fff; }
h1 { line-height: 1.1; }
h2 { margin-top: 2rem; }
a { color: #4b3fd1; }
@media (prefers-color-scheme: dark) { body { color: #ececf6; background: #14142b; } a { color: #aeb0e0; } }
</style>
</head>
<body>
${body}
</body>
</html>`;

// Final wording is approved in a separate ticket. Changing what people agree to? Bump RULES_VERSION in the app too.
export const TERMS = page(
  "Terms of Use",
  `<h1>Terms of Use</h1>
<p>These are hopon's Rules. You agree to them before you do anything signed in, and again whenever they change.</p>

<h2>Zero tolerance</h2>
<p>hopon has zero tolerance for objectionable content and abusive people. Every game, comment and name you post must follow these Rules.</p>

<h2>What's not allowed</h2>
<ul>
<li><strong>Anything not suitable for ages 13+</strong>: sexual content, graphic violence, gore, or drugs.</li>
<li><strong>Hate or harassment</strong>: attacking, threatening, bullying or demeaning anyone, including for their race, ethnicity, religion, gender, sexuality, disability or age.</li>
<li><strong>Spam or scams</strong>: misleading, repetitive or commercial content, or anything that tricks people.</li>
<li><strong>Anything else harmful</strong>: illegal content, impersonation, sharing someone's private information, or content you don't have the rights to.</li>
</ul>

<h2>What happens</h2>
<ul>
<li>Screening checks the sentence a game is made from, a game's title and description, comments and names, and refuses text that breaks the Rules before anyone else sees it.</li>
<li>We review every report within 24 hours.</li>
<li>Games and comments that break the Rules are deleted.</li>
<li>People who post them can be banned: they can no longer sign in, and all their games and comments are deleted.</li>
</ul>

<h2>Report and Block</h2>
<p>Report any game or comment that breaks the Rules: it disappears for you at once, and we review it. Block anyone you don't want to see: neither of you sees the other's games or comments, and they can't comment on your games. You can unblock them at any time.</p>

<h2>Contact</h2>
<p>Questions or concerns: ${contact}.</p>`
);

export const SUPPORT = page(
  "hopon Support",
  `<h1>hopon Support</h1>
<p>Need help, or want to tell us about a game, a comment or a person? Email ${contact}.</p>
<p>Everyone on hopon agrees to its <a href="/terms">Rules (Terms of Use)</a>.</p>`
);
