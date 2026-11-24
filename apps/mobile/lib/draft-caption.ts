// The Caption on the publish sheet, kept per Draft while the app runs, so closing and reopening the sheet shows what
// the Creator typed or had written, which cost them hopon tokens. A new Revision changes the Draft's `updatedAt`, and
// the Caption for the old game no longer counts.
import type { DraftSummary } from "@hopon/schemas";

type Revision = Pick<DraftSummary, "id" | "updatedAt">;

const kept = new Map<string, { caption: string; updatedAt: string }>();

// Undefined when none is kept for this Revision. An empty Caption is kept: the Creator chose to say nothing.
export const keptCaption = (draft: Revision) => {
  const entry = kept.get(draft.id);
  return entry?.updatedAt === draft.updatedAt ? entry.caption : undefined;
};

export const keepCaption = (draft: Revision, caption: string) => {
  kept.set(draft.id, { caption, updatedAt: draft.updatedAt });
};

export const dropCaption = (draftId: string) => {
  kept.delete(draftId);
};
