// A Draft's current Revision, playing at the feed's size (#119, #148), for Play over the chat and for the Draft's
// page. Its preview URL is minted on mount, on every turn_done, at each Restart and after the WebView's content
// process dies. A Revision that lands while the Creator plays waits behind the "New version · Reload" pill.
import { useAuth } from "@clerk/expo";
import type { DraftSummary } from "@hopon/schemas";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { feedGameHeight } from "@/components/feed";
import { GameView } from "@/components/game-view";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { draftTitle } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { newRevision } from "@/lib/maker-chat";

export const DraftGame = ({
  draft,
  turns,
  restarts,
}: {
  draft: DraftSummary;
  // How many turns have ended since the screen opened: each one may have landed a Revision.
  turns: number;
  // How many times the Creator has tapped the screen's Restart.
  restarts: number;
}) => {
  const { getToken } = useAuth();
  // The URL the WebView plays, and the newest one minted.
  const [playing, setPlaying] = useState<string>();
  const [fresh, setFresh] = useState<string>();
  // Bumped to reload the WebView, even on the same URL.
  const [loads, setLoads] = useState(0);
  const [error, setError] = useState("");

  // `restart` plays the new link at once (Restart, Reload, a crash): the Revision it was playing may be gone. Otherwise
  // it plays only if nothing is playing yet.
  const mint = async (restart: boolean) => {
    try {
      const { url } = await api<{ url: string }>(
        `/api/drafts/${draft.id}/preview`,
        { token: await getToken() }
      );
      setError("");
      setFresh(url);
      if (restart) {
        setPlaying(url);
        setLoads((n) => n + 1);
      } else {
        setPlaying((current) => current ?? url);
      }
    } catch (mintError) {
      setError((mintError as Error).message);
    }
  };
  // On mount, on every turn_done and at each Restart; Clerk's getToken changes on every render, so this tracks them
  // by hand.
  const minted = useRef({ restarts, turns: -1 });
  useEffect(() => {
    const last = minted.current;
    if (last.turns === turns && last.restarts === restarts) {
      return;
    }
    minted.current = { restarts, turns };
    mint(last.restarts !== restarts);
  });

  const reload = () => {
    setPlaying(fresh);
    setLoads((n) => n + 1);
  };
  const height = feedGameHeight();
  const title = draftTitle(draft);

  return (
    <View className="flex-1 justify-center px-1.5">
      {/* Feed size when Discover has measured it, so the game plays as the feed will show it. */}
      <View
        className="overflow-hidden rounded-3xl bg-card"
        style={height ? { height, maxHeight: "100%" } : { flex: 1 }}
      >
        {playing ? (
          <GameView
            key={loads}
            uri={playing}
            title={title}
            onCrash={() => mint(true)}
          />
        ) : (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-muted-foreground">
              {error || t.common.loading}
            </Text>
          </View>
        )}
      </View>
      {fresh && newRevision(playing, fresh) && (
        <View className="absolute inset-x-0 top-3 items-center">
          <Button size="sm" className="rounded-full" onPress={reload}>
            <Text>{t.play.newVersion}</Text>
          </Button>
        </View>
      )}
      {!!playing && !!error && (
        <Text
          accessibilityRole="alert"
          className="pt-2 text-center text-sm text-destructive"
        >
          {error}
        </Text>
      )}
    </View>
  );
};
