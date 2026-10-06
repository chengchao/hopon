import { useAuth } from "@clerk/expo";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, PanResponder, View } from "react-native";

import { CommentsSheet } from "@/components/CommentsSheet";
import { GameView } from "@/components/GameView";
import { Byline, Ticket } from "@/components/Ticket";
import { TicketActions } from "@/components/TicketActions";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api, gameUrl } from "@/lib/api";
import type { Game } from "@/lib/api";
import { snapTarget } from "@/lib/feed-motion";

// The vertical, one-game-at-a-time feed over a paged endpoint (`?before=` cursor). `start` is the first page's cursor.
export function Feed({
  path,
  start,
  empty,
}: {
  path: string;
  start?: number;
  empty: string;
}) {
  const [games, setGames] = useState<Game[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Game | null>(null);
  const { isSignedIn, getToken } = useAuth();
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });
  // State, not a ref, so the pan handlers built during render never read a ref.
  const [list, setList] = useState<FlatList<Game> | null>(null);
  const busy = useRef(false);

  const scrollTo = useCallback(
    (offset: number, animated: boolean) =>
      list?.scrollToOffset({ animated, offset }),
    [list]
  );
  // `more` appends the page after `before`; otherwise the page replaces the feed.
  const load = useCallback(
    async (before: number | undefined, more: boolean) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      setLoading(true);
      setError("");
      try {
        const data = await api<{ games: Game[]; next: number | null }>(
          `${path}${before ? `?before=${before}` : ""}`,
          {
            token: await token.current(),
          }
        );
        setGames((old) => (more ? [...old, ...data.games] : data.games));
        setNext(data.next);
      } catch (error) {
        setError((error as Error).message);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [path]
  );

  useEffect(() => {
    void load(start, false);
  }, [load, start]);
  useEffect(() => {
    if (next && active >= games.length - 2 && !error) {
      void load(next, true);
    }
  }, [active, next, games.length, load, error]);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => sub.remove();
  }, []);

  const patch = (id: number, fields: Partial<Game>) =>
    setGames((old) => old.map((g) => (g.id === id ? { ...g, ...fields } : g)));
  // Optimistic: flip the heart now, then settle on the server's count, or flip back if the request fails.
  async function like(game: Game) {
    if (!isSignedIn) {
      return router.push("/sign-in");
    }
    const liked = !game.liked;
    patch(game.id, { liked, likes: (game.likes ?? 0) + (liked ? 1 : -1) });
    try {
      patch(
        game.id,
        await api<Pick<Game, "liked" | "likes">>(`/api/games/${game.id}/like`, {
          method: liked ? "PUT" : "DELETE",
          token: await getToken(),
        })
      );
    } catch {
      patch(game.id, { liked: game.liked, likes: game.likes });
    }
  }
  // Same for the save. An unsaved game stays in the feed (even the Saved one) until you leave it.
  async function save(game: Game) {
    if (!isSignedIn) {
      return router.push("/sign-in");
    }
    const saved = !game.saved;
    patch(game.id, { saved });
    try {
      patch(
        game.id,
        await api<Pick<Game, "saved">>(`/api/games/${game.id}/save`, {
          method: saved ? "PUT" : "DELETE",
          token: await getToken(),
        })
      );
    } catch {
      patch(game.id, { saved: game.saved });
    }
  }

  const go = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(games.length - 1, index));
      scrollTo(target * height, !reduceMotion);
      setActive(target);
    },
    [games.length, height, reduceMotion, scrollTo]
  );

  // Only the name/description area pages the feed; the game keeps every touch. A drag moves at most one game.
  // `active` only changes when a drag settles, so `origin` holds for the whole gesture.
  const pan = useMemo(() => {
    const origin = active * height;
    const position = (dy: number) =>
      Math.max(origin - height, Math.min(origin + height, origin - dy));
    const settle = (dy: number) =>
      go(
        Math.round(
          snapTarget(origin, position(dy), height, games.length) / height
        )
      );
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => scrollTo(position(g.dy), false),
      onPanResponderRelease: (_, g) => settle(g.dy),
      onPanResponderTerminate: (_, g) => settle(g.dy),
      onPanResponderTerminationRequest: () => false,
      onStartShouldSetPanResponder: () => true,
    });
  }, [active, height, games.length, go, scrollTo]);

  return (
    <>
      <View
        className="flex-1"
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      >
        {height > 0 && (
          <FlatList
            ref={setList}
            data={games}
            keyExtractor={(game) => String(game.id)}
            scrollEnabled={false}
            getItemLayout={(_, index) => ({
              index,
              length: height,
              offset: height * index,
            })}
            initialNumToRender={3}
            windowSize={3}
            extraData={active}
            renderItem={({ item, index }) => (
              <View style={{ height }} className="px-3 pb-3 pt-2">
                <View className="flex-1 overflow-hidden rounded-t-2xl bg-card">
                  {Math.abs(index - active) <= 1 && (
                    <GameView uri={gameUrl(item.id)} title={item.title} />
                  )}
                </View>
                <Ticket
                  {...pan.panHandlers}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={`${item.title}. ${item.description}`}
                  accessibilityHint="Swipe up or down here to change games"
                  // The ticket is one VoiceOver element, so its buttons are offered as custom actions too.
                  accessibilityActions={[
                    { name: "increment" },
                    { name: "decrement" },
                    { label: item.liked ? "Unlike" : "Like", name: "like" },
                    { label: "Comments", name: "comments" },
                    {
                      label: item.saved ? "Remove from saved" : "Save",
                      name: "save",
                    },
                  ]}
                  onAccessibilityAction={(e) => {
                    const action = e.nativeEvent.actionName;
                    if (action === "increment" || action === "decrement") {
                      go(active + (action === "increment" ? 1 : -1));
                    } else if (action === "like") {
                      void like(item);
                    } else if (action === "save") {
                      void save(item);
                    } else if (action === "comments") {
                      setCommentsFor(item);
                    }
                  }}
                  compact
                  byline={<Byline author={item.author} />}
                  title={item.title}
                  description={item.description}
                  actions={
                    <TicketActions
                      game={item}
                      onLike={() => void like(item)}
                      onComments={() => setCommentsFor(item)}
                      onSave={() => void save(item)}
                    />
                  }
                />
              </View>
            )}
          />
        )}
        {!games.length && (
          <View className="absolute inset-0 items-center justify-center gap-4 px-8">
            <Text
              className={
                error
                  ? "text-center text-destructive"
                  : "text-center text-muted-foreground"
              }
            >
              {error || (loading ? "Loading games…" : empty)}
            </Text>
            {!!error && (
              <Button
                variant="outline"
                className="rounded-full"
                onPress={() => void load(start, false)}
              >
                <Text>Try again</Text>
              </Button>
            )}
          </View>
        )}
        {!!games.length && !!error && (
          <View className="absolute bottom-4 left-4 right-4 flex-row items-center gap-3 rounded-2xl bg-card p-3">
            <Text className="flex-1 text-destructive">{error}</Text>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onPress={() =>
                void (next ? load(next, true) : load(start, false))
              }
            >
              <Text>Try again</Text>
            </Button>
          </View>
        )}
      </View>
      <CommentsSheet
        game={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCount={(id, delta) =>
          setGames((old) =>
            old.map((g) =>
              g.id === id ? { ...g, comments: (g.comments ?? 0) + delta } : g
            )
          )
        }
      />
    </>
  );
}
