// The Caption on the publish sheet, kept per Draft while the app runs, so closing and reopening the sheet shows what
// the Creator typed or had written, which cost them hopon tokens. It stays through chat and new Revisions: the Caption
// is the Creator's, and they change it when the game does.
const kept = new Map<string, string>();

// Undefined when none is kept. An empty Caption is kept: the Creator chose to say nothing.
export const keptCaption = (draftId: string) => kept.get(draftId);

export const keepCaption = (draftId: string, caption: string) => {
  kept.set(draftId, caption);
};

export const dropCaption = (draftId: string) => {
  kept.delete(draftId);
};
