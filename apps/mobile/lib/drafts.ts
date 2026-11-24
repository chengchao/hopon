// A Creator's Drafts (#119, #149) as the Drafts tab, a Draft's page and the chat read them: the part the tests drive.
// What a Draft is doing is one status, decided here from two facts, so a card and a page can't disagree on "making".
import { MAX_DRAFTS } from "@hopon/schemas";
import type { DraftSummary } from "@hopon/schemas";

import { t } from "./i18n.ts";
import { clock, publishable, shownDraft } from "./maker-chat.ts";
import type { ChatView } from "./maker-chat.ts";

// A Draft's name wherever it shows: the Maker's title, once it has named the game.
export const draftTitle = (draft: DraftSummary | null | undefined) =>
  draft?.title ?? t.drafts.newGame;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long ago a Draft changed ("2 h ago"), from its ISO `updatedAt`.
// ponytail: days never roll up into weeks or dates; add that if old Drafts read oddly.
export const ago = (iso: string, now = Date.now()) => {
  const since = now - Date.parse(iso);
  if (since < MINUTE) {
    return t.drafts.ago.now;
  }
  if (since < HOUR) {
    return t.drafts.ago.minutes(Math.floor(since / MINUTE));
  }
  if (since < DAY) {
    return t.drafts.ago.hours(Math.floor(since / HOUR));
  }
  return t.drafts.ago.days(Math.floor(since / DAY));
};

// `unmade`: no game and nobody making one, because the first turn failed, was stopped, or only talked.
export type DraftStatus = "making" | "unmade" | "ready" | "updating";
export interface DraftFacts {
  // The Draft has a Revision to play.
  hasGame: boolean;
  // The Maker is on a turn.
  working: boolean;
}

export const draftStatus = ({ hasGame, working }: DraftFacts): DraftStatus => {
  if (hasGame) {
    return working ? "updating" : "ready";
  }
  return working ? "making" : "unmade";
};

// The facts as the Draft list has them: the Maker titles a Draft at its first Revision, and marks its row while it
// works. A Worker from before the mark sends none, which reads as not working.
export const listedFacts = (draft: DraftSummary): DraftFacts => ({
  hasGame: draft.title !== null,
  working: !!draft.turnStartedAt,
});

// The facts as the Draft's chat has them, which is sooner: a build's card comes before the turn's end titles the row.
export const liveFacts = (draft: DraftSummary, view: ChatView): DraftFacts => ({
  hasGame: draft.title !== null || view.rows.some((row) => row.play),
  working: view.running,
});

export const isWorking = (draft: DraftSummary) => listedFacts(draft).working;

// The status with its time: the turn's clock while the Maker works, else how long ago the Draft changed.
const statusLine = (draft: DraftSummary, facts: DraftFacts, now: number) =>
  t.drafts.status[draftStatus(facts)](
    facts.working
      ? clock(now - Date.parse(draft.turnStartedAt ?? draft.updatedAt))
      : ago(draft.updatedAt, now)
  );

// Everything a Draft's card shows, as text.
export interface DraftCardView extends DraftFacts {
  id: string;
  status: DraftStatus;
  title: string;
  // The Maker's description, once there is a game.
  line?: string;
  // "Making · 3:12", "Ready to play · 2 h ago"
  badge: string;
  // What a screen reader says for the card.
  label: string;
}

export const draftCard = (draft: DraftSummary, now: number): DraftCardView => {
  const facts = listedFacts(draft);
  const title = draftTitle(draft);
  const line = draft.description ?? undefined;
  const badge = statusLine(draft, facts, now);
  return {
    ...facts,
    badge,
    id: draft.id,
    label: [title, badge.replace(" · ", ", "), line]
      .filter((part) => part !== undefined)
      .join(". "),
    line,
    status: draftStatus(facts),
    title,
  };
};

// Everything a Draft's page shows. `live` is the Draft's chat while its socket is open on a snapshot, and the page
// believes it over the list.
export interface DraftPageView extends DraftFacts {
  status: DraftStatus;
  // With the latest build's title and description, which the list may not have yet.
  draft: DraftSummary;
  // What the Maker is on while it works: the chat's activity live, else the card's badge.
  work?: string;
  // This turn's finished steps, live only.
  steps: { key: string; text: string }[];
  // The Creator's latest message, live only.
  asked?: string;
  canPublish: boolean;
}

export const draftPage = (
  listed: DraftSummary,
  live: ChatView | undefined,
  now: number
): DraftPageView => {
  const facts = live ? liveFacts(listed, live) : listedFacts(listed);
  const draft = shownDraft(listed, live?.game) ?? listed;
  const rows = live?.rows ?? [];
  // A queued message is a steer the Maker hasn't taken: the turn's steps follow the last one it has.
  const turn = rows.slice(
    rows.findLastIndex((row) => row.who === "creator" && !row.queued) + 1
  );
  return {
    ...facts,
    asked: rows.findLast((row) => row.who === "creator")?.text,
    canPublish: publishable(draft, { running: facts.working }),
    draft,
    status: draftStatus(facts),
    steps: facts.working
      ? turn
          .filter((row) => row.who === "step")
          .map(({ key, text }) => ({ key, text }))
      : [],
    work: facts.working
      ? (live?.work ?? statusLine(listed, facts, now))
      : undefined,
  };
};

export const isFull = (drafts: DraftSummary[]) => drafts.length >= MAX_DRAFTS;

// The Draft the chat opens: the one asked for by id, else the newest (+). One that is gone, published or Deleted
// since, opens a new chat (null), and so does an empty list.
export const draftToOpen = (
  drafts: DraftSummary[],
  asked?: string
): { draft: DraftSummary | null; gone: boolean } => {
  if (asked === undefined) {
    return { draft: drafts[0] ?? null, gone: false };
  }
  const draft = drafts.find((listed) => listed.id === asked) ?? null;
  return { draft, gone: draft === null };
};
