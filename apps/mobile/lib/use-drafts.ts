// The signed-in Creator's Drafts for one screen, the Drafts tab or a Draft's page: listed each time the screen comes
// into view, and every few seconds while it is in view and the Maker is working on one, which is how a card turns
// from making to ready with nobody touching it.
import { useAuth } from "@clerk/expo";
import type { DraftSummary } from "@hopon/schemas";
import { useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { api } from "@/lib/api";
import { isWorking } from "@/lib/drafts";

const POLL_MS = 5000;

export const useDrafts = () => {
  const { isSignedIn, getToken } = useAuth();
  const focused = useIsFocused();
  // Newest first; undefined until the first answer, and while signed out.
  const [drafts, setDrafts] = useState<DraftSummary[]>();
  // Why the last refresh or Delete failed; the next one that works clears it.
  const [error, setError] = useState("");
  // Clerk's getToken isn't referentially stable, so the callbacks read it through a ref instead of their deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });
  // Bumped by each refresh, so a list that lands after a newer refresh, a Delete or a sign-out is dropped.
  const generation = useRef(0);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    generation.current += 1;
    const { current } = generation;
    refreshing.current = true;
    try {
      const list = await api<{ drafts: DraftSummary[] }>("/api/drafts", {
        token: await token.current(),
      });
      if (current === generation.current) {
        setDrafts(list.drafts);
        setError("");
      }
    } catch (refreshError) {
      if (current === generation.current) {
        setError((refreshError as Error).message);
      }
    }
    if (current === generation.current) {
      refreshing.current = false;
    }
  }, []);

  // Deletes the Draft; false when it couldn't.
  const remove = useCallback(async (id: string) => {
    try {
      await api(`/api/drafts/${id}`, {
        method: "DELETE",
        token: await token.current(),
      });
    } catch (deleteError) {
      setError((deleteError as Error).message);
      return false;
    }
    generation.current += 1;
    refreshing.current = false;
    setDrafts((list) => list?.filter((draft) => draft.id !== id));
    setError("");
    return true;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) {
        refresh();
      } else {
        generation.current += 1;
        setDrafts(undefined);
        setError("");
      }
    }, [isSignedIn, refresh])
  );

  const working = drafts?.some(isWorking) ?? false;
  useEffect(() => {
    if (!(focused && isSignedIn)) {
      return;
    }
    // Back from the background, a turn may have ended or its clock run on.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });
    const poll =
      working &&
      setInterval(() => {
        // A slow list isn't asked for again before it answers, or none would ever land.
        if (AppState.currentState === "active" && !refreshing.current) {
          refresh();
        }
      }, POLL_MS);
    return () => {
      appState.remove();
      if (poll) {
        clearInterval(poll);
      }
    };
  }, [focused, isSignedIn, working, refresh]);

  return { drafts, error, refresh, remove };
};
