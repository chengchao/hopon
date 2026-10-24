// Worker-served pages: /terms is the Rules the app links to, /support the App Store Support URL, /privacy the
// stores' privacy policy URL, /operator the Operator's queue. Kept out of index.ts: workerd treats every named export
// of the Worker entry as an entrypoint.
import { REPORT_REASONS } from "@hopon/schemas";
import type { ReportTarget } from "@hopon/schemas";
import { html } from "hono/html";

// The app has its own copy in apps/mobile/lib/rules.ts.
const CONTACT_EMAIL = "support@gethopon.app";
const contact = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

const csp = (formAction: string) =>
  `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action ${formAction}; frame-ancestors 'none'`;
export const PAGE_CSP = csp("'none'");
// The Operator's forms post back to the Worker. Still no script, so the people's text it shows can't run.
export const OPERATOR_CSP = csp("'self'");

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
section { margin: 1.5rem 0; padding: 1rem; border-radius: 1rem; background: #f3f3f8; }
form { display: inline; }
button, .action { display: inline-block; margin: 0.25rem 0.5rem 0 0; padding: 0.4rem 1rem; border: 0; border-radius: 99rem; font: inherit; color: #fff; background: #c4314b; text-decoration: none; }
.quiet { color: inherit; background: transparent; box-shadow: inset 0 0 0 1px currentColor; }
.meta { margin: 0; font-size: 0.9rem; opacity: 0.7; }
.gone { font-weight: bold; color: #c4314b; }
@media (prefers-color-scheme: dark) { body { color: #ececf6; background: #14142b; } a { color: #aeb0e0; } section { background: #22223d; } }
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
<li>Screening checks every message to the Maker, a game's title and description, comments and names, and refuses text that breaks the Rules before anyone else sees it.</li>
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

// Must match the App Store privacy answers and the Play data safety form: change them together.
export const PRIVACY = page(
  "Privacy Policy",
  `<h1>Privacy Policy</h1>
<p>This is what hopon collects, why, and what you can do about it.</p>

<h2>What we collect</h2>
<ul>
<li><strong>Your email address</strong>, to sign you in with a one-time code. <a href="https://clerk.com/legal/privacy">Clerk</a> handles sign-in and stores it for us.</li>
<li><strong>Your account ID and @handle</strong>, to show who made a game or comment.</li>
<li><strong>What you post</strong>: the games you make and publish, your comments, and the reports you send.</li>
<li><strong>Your chats with the Maker</strong>: your messages and the games it makes from them, while they are Drafts.</li>
<li><strong>What you do in the app</strong>: the games you save and like, and the people you block. Only you see your saves and blocks.</li>
</ul>
<p>No ads, no tracking across other apps or websites, and we never sell your data.</p>

<h2 id="maker">The Maker</h2>
<p>When you make a game, your messages to the Maker and the game it makes from them (its code and pictures of it being played) go to these companies. Your email and account don't.</p>
<ul>
<li><strong>Anthropic</strong>: its Claude models are the Maker's AI. Anthropic doesn't train on what it receives and deletes it within 30 days, unless it is flagged for breaking Anthropic's usage policy.</li>
<li><strong>Cloudflare</strong> hosts hopon, carries messages to the AI and runs Screening on every message. Cloudflare doesn't train on them.</li>
<li><strong>E2B</strong> runs and plays the game's code in the US while the Maker builds it. The copy is deleted after a day without changes.</li>
</ul>
<p>We keep a Draft's chat and game until you Delete the Draft or publish it. Publishing keeps the game and deletes the chat. Text that Screening refuses is never kept.</p>

<h2>Who sees it</h2>
<p>Published games and comments, with your @handle, are public, and so is how many people like a game, but not who. Drafts, saves, blocks and your email are not public. We review what's reported to us.</p>

<h2 id="delete-account">Deleting your account</h2>
<p>Delete your account from the Me tab. That deletes your sign-in and email, and all your Drafts with their chats. Games you published and comments you posted stay up under your @handle; email ${contact} to have them deleted too.</p>

<h2>Contact</h2>
<p>Questions about your data: ${contact}.</p>`
);

// The Operator's queue: same order and fields as the app's, with each target at its own anchor for the webhook's link.
// `html` escapes every interpolated value, so a snapshot's markup shows as text.
const anchor = (target: Pick<ReportTarget, "id" | "kind">) =>
  `${target.kind}-${target.id}`;
// The action routes: /operator/games/:id/… or /operator/comments/:id/….
const actionPath = (
  target: Pick<ReportTarget, "id" | "kind">,
  action: "ban" | "delete" | "dismiss"
) => `/operator/${target.kind}s/${target.id}/${action}`;

const card = (target: ReportTarget) => html`<section id="${anchor(target)}">
<p class="meta">${target.kind === "game" ? "Game" : `Comment on game ${target.gameId}`} · @${target.handle ?? "?"} · ${target.reportedAt} UTC</p>
${target.title ? html`<h2>${target.title}</h2>` : ""}
<p>${target.description ?? target.body}</p>
${target.live ? "" : html`<p class="gone">Content deleted</p>`}
<p>${target.reasons.map(
  ({ count, reason }) =>
    html`${REPORT_REASONS.find((r) => r.reason === reason)?.label} × ${count}<br />`
)}</p>
<p>${
  target.live && target.kind === "game"
    ? html`<a class="action quiet" href="/games/${target.id}/index.html"
        >Play</a
      >`
    : ""
}${
  target.live
    ? html`<a class="action" href="${actionPath(target, "delete")}">Delete</a>`
    : ""
}<a class="action" href="${actionPath(target, "ban")}">Ban</a><form method="post" action="${actionPath(target, "dismiss")}"><button class="quiet">Dismiss</button></form></p>
</section>`;

export const operatorQueue = async (targets: ReportTarget[]) =>
  page(
    "Reports",
    String(
      await html`<h1>Reports</h1>
        <p>${targets.length} open</p>
        ${targets.length ? targets.map(card) : html`<p>No open reports.</p>`}`
    )
  );

const DELETED = {
  comment: "It's gone for everyone.",
  game: "It's gone for everyone, with its likes, comments and saves.",
};

// Delete and Ban ask first, in the app's alert wording. Cancel goes back to the target on the queue.
export const operatorConfirm = async (
  target: Pick<ReportTarget, "handle" | "id" | "kind">,
  action: "ban" | "delete"
) => {
  const [title, text] =
    action === "ban"
      ? [
          `Ban @${target.handle ?? "this person"}?`,
          "They can't sign in again, and all their published games and comments are deleted for everyone.",
        ]
      : [`Delete ${target.kind}?`, DELETED[target.kind]];
  return page(
    action === "ban" ? "Ban" : "Delete",
    String(
      await html`<h1>${title}</h1>
        <p>${text}</p>
        <form method="post" action="${actionPath(target, action)}">
          <button>${action === "ban" ? "Ban" : "Delete"}</button>
        </form>
        <a class="action quiet" href="/operator#${anchor(target)}">Cancel</a>`
    )
  );
};
