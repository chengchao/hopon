// Play (#119, #148): the Draft's current Revision full height over the chat, with Back to chat, Restart and Publish.
// Its preview URL is minted on open, on every turn_done and after the WebView's content process dies. A Revision that
// lands while the Creator plays waits behind the "New version · Reload" pill.
import { useAuth } from "@clerk/expo";
import type { DraftSummary } from "@hopon/schemas";
import { ChevronLeft, RotateCcw } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { feedGameHeight } from "@/components/feed";
import { GameView } from "@/components/game-view";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { draftTitle } from "@/lib/draft-list";
import { newRevision } from "@/lib/maker-chat";
import { COLORS } from "@/lib/theme";

export const Play = ({
  draft,
  turns,
  onClose,
  canPublish,
  onPublish,
}: {
  draft: DraftSummary;
  // How many turns have ended since the chat opened: each one may have landed a Revision.
  turns: number;
  onClose: () => void;
  // As in the chat's header: not while a turn runs.
  canPublish: boolean;
  onPublish: () => void;
}) => {
  const insets = useSafeAreaInsets();
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
  // On open and on every turn_done; Clerk's getToken changes on every render, so this tracks the turn by hand.
  const minted = useRef(-1);
  useEffect(() => {
    if (minted.current === turns) {
      return;
    }
    minted.current = turns;
    mint(false);
  });

  const reload = () => {
    setPlaying(fresh);
    setLoads((n) => n + 1);
  };
  const height = feedGameHeight();
  const title = draftTitle(draft);

  return (
    <Animated.View
      entering={SlideInDown}
      exiting={SlideOutDown}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: COLORS.night,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <View className="flex-row items-center gap-1 px-2 pb-2 pt-3">
        <Button size="sm" variant="ghost" onPress={onClose}>
          <ChevronLeft color={COLORS.paper} size={20} />
          <Text>Back to chat</Text>
        </Button>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          className="flex-1 text-center font-strong text-base"
        >
          {title}
        </Text>
        <Button size="sm" variant="ghost" onPress={() => mint(true)}>
          <RotateCcw color={COLORS.paper} size={18} />
          <Text>Restart</Text>
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={!canPublish}
          onPress={onPublish}
        >
          <Text>Publish</Text>
        </Button>
      </View>
      <View className="flex-1 justify-center px-3">
        {/* Feed size when Discover has measured it, so the game plays as the feed will show it. */}
        <View
          className="overflow-hidden rounded-2xl bg-card"
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
                {error || "Loading…"}
              </Text>
            </View>
          )}
        </View>
        {fresh && newRevision(playing, fresh) && (
          <View className="absolute inset-x-0 top-3 items-center">
            <Button size="sm" className="rounded-full" onPress={reload}>
              <Text>New version · Reload</Text>
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
    </Animated.View>
  );
};
