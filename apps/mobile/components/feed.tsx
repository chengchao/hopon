import { useAuth } from "@clerk/expo";
import type { FeedGame, GamePage } from "@hopon/schemas";
import { router, useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  FlatList,
  PanResponder,
  Platform,
  View,
} from "react-native";

import { CommentsSheet } from "@/components/comments-sheet";
import { GameActions } from "@/components/game-actions";
import { GameView } from "@/components/game-view";
import { confirmBlock, ReportSheet, targetOf } from "@/components/report-sheet";
import type { ReportTarget } from "@/components/report-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api, gameUrl } from "@/lib/api";
import { snapTarget } from "@/lib/feed-motion";
import { t } from "@/lib/i18n";

// How tall the `measure` feed (Discover) last laid out its game box, so Make previews a draft at that height.
let measuredGameHeight: number | undefined;
export const feedGameHeight = () => measuredGameHeight;

// The vertical, one-game-at-a-time feed over a paged endpoint (`?before=` cursor). `start` is the first page's cursor.
export const Feed = ({
  path,
  start,
  empty,
  measure = false,
}: {
  path: string;
  start?: number;
  empty: string;
  measure?: boolean;
}) => {
  const [games, setGames] = useState<FeedGame[]>([]);
  const focused = useIsFocused();
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [commentsFor, setCommentsFor] = useState<FeedGame | null>(null);
  const [reportFor, setReportFor] = useState<ReportTarget | null>(null);
  const [muted, setMuted] = useState(false);
  const { isSignedIn, getToken } = useAuth();
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });
  // State, not a ref, so the pan handlers built during render never read a ref.
  const [list, setList] = useState<FlatList<FeedGame> | null>(null);
  const busy = useRef(false);
  // The feed as of the last render, for the report reply, which can land after another page was appended.
  const latest = useRef(games);
  useEffect(() => {
    latest.current = games;
  });

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
        const data = await api<GamePage>(
          `${path}${before ? `?before=${before}` : ""}`,
          {
            token: await token.current(),
          }
        );
        setGames((old) => (more ? [...old, ...data.games] : data.games));
        setNext(data.next);
      } catch (loadError) {
        setError((loadError as Error).message);
      }
      busy.current = false;
      setLoading(false);
    },
    [path]
  );

  useEffect(() => {
    load(start, false);
  }, [load, start]);
  useEffect(() => {
    if (next && active >= games.length - 2 && !error) {
      load(next, true);
    }
  }, [active, next, games.length, load, error]);
  useEffect(() => {
    const readReduceMotion = async () => {
      setReduceMotion(await AccessibilityInfo.isReduceMotionEnabled());
    };
    readReduceMotion();
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => sub.remove();
  }, []);

  const go = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(games.length - 1, index));
      scrollTo(target * height, !reduceMotion);
      setActive(target);
    },
    [games.length, height, reduceMotion, scrollTo]
  );

  const patch = (id: number, fields: Partial<FeedGame>) =>
    setGames((old) => old.map((g) => (g.id === id ? { ...g, ...fields } : g)));
  // Optimistic: flip the heart now, then settle on the server's count, or flip back if the request fails.
  const like = async (game: FeedGame) => {
    if (!isSignedIn) {
      return router.push("/sign-in");
    }
    const liked = !game.liked;
    patch(game.id, { liked, likes: game.likes + (liked ? 1 : -1) });
    try {
      patch(
        game.id,
        await api<Pick<FeedGame, "liked" | "likes">>(
          `/api/games/${game.id}/like`,
          {
            method: liked ? "PUT" : "DELETE",
            token: await getToken(),
          }
        )
      );
    } catch {
      patch(game.id, { liked: game.liked, likes: game.likes });
    }
  };
  // Same for the save. An unsaved game stays in the feed (even the Saved one) until you leave it.
  const save = async (game: FeedGame) => {
    if (!isSignedIn) {
      return router.push("/sign-in");
    }
    const saved = !game.saved;
    patch(game.id, { saved });
    try {
      patch(
        game.id,
        await api<Pick<FeedGame, "saved">>(`/api/games/${game.id}/save`, {
          method: saved ? "PUT" : "DELETE",
          token: await getToken(),
        })
      );
    } catch {
      patch(game.id, { saved: game.saved });
    }
  };

  // Takes games out at once. The game after the one on screen takes its place; if none is left after it, the one before.
  const drop = (gone: (game: FeedGame) => boolean) => {
    const rest = latest.current.filter((g) => !gone(g));
    const above = latest.current.slice(0, active).filter((g) => !gone(g));
    setGames(rest);
    go(Math.min(above.length, rest.length - 1));
  };
  // ponytail: matched by the handle on each game, so games published under an older handle stay until the feed reloads.
  const hide = (handle: string | null) =>
    drop((g) => !g.mine && handle !== null && g.author === handle);

  const report = (game: FeedGame) =>
    isSignedIn ? setReportFor(targetOf("game", game)) : router.push("/sign-in");
  const block = (game: FeedGame) => {
    if (!isSignedIn) {
      return router.push("/sign-in");
    }
    confirmBlock({
      getToken,
      onBlocked: hide,
      onReport: setReportFor,
      target: targetOf("game", game),
    });
  };
  // The "…" button's menu.
  const more = (game: FeedGame) => {
    if (!isSignedIn) {
      return router.push("/sign-in");
    }
    const blockLabel = t.common.blockHandle(game.author);
    if (Platform.OS === "ios") {
      return ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: 2,
          destructiveButtonIndex: 1,
          options: [t.feed.reportGame, blockLabel, t.common.cancel],
        },
        (index) => {
          if (index === 0) {
            report(game);
          } else if (index === 1) {
            block(game);
          }
        }
      );
    }
    Alert.alert(game.title, undefined, [
      { style: "cancel", text: t.common.cancel },
      { onPress: () => report(game), text: t.feed.reportGame },
      { onPress: () => block(game), style: "destructive", text: blockLabel },
    ]);
  };

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
            extraData={`${active} ${muted}`}
            renderItem={({ item, index }) => (
              <View style={{ height }} className="px-1.5 pb-1 pt-2">
                <View
                  className="flex-1 overflow-hidden rounded-3xl bg-card"
                  onLayout={(e) => {
                    if (measure) {
                      measuredGameHeight = e.nativeEvent.layout.height;
                    }
                  }}
                >
                  {Math.abs(index - active) <= 1 && (
                    // Keyed by row: a WKWebView moved up a row (when a reported game leaves) paints blank, so it reloads.
                    <GameView
                      key={index}
                      active={index === active && focused}
                      muted={muted}
                      uri={gameUrl(item.id)}
                      title={item.title}
                    />
                  )}
                </View>
                <View
                  {...pan.panHandlers}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={`${item.title}. ${item.description}`}
                  accessibilityHint={t.feed.swipeHint}
                  // The info area is one VoiceOver element, so its buttons are offered as custom actions too.
                  accessibilityActions={[
                    { name: "increment" },
                    { name: "decrement" },
                    {
                      label: item.liked ? t.feed.unlike : t.feed.like,
                      name: "like",
                    },
                    { label: t.feed.comments, name: "comments" },
                    {
                      label: item.saved ? t.feed.removeSaved : t.feed.save,
                      name: "save",
                    },
                    {
                      label: muted ? t.feed.unmute : t.feed.mute,
                      name: "mute",
                    },
                    ...(item.mine
                      ? []
                      : [
                          { label: t.feed.reportGame, name: "report" },
                          {
                            label: t.common.blockHandle(item.author),
                            name: "block",
                          },
                        ]),
                  ]}
                  onAccessibilityAction={(e) => {
                    const action = e.nativeEvent.actionName;
                    if (action === "increment" || action === "decrement") {
                      go(active + (action === "increment" ? 1 : -1));
                    } else if (action === "like") {
                      like(item);
                    } else if (action === "save") {
                      save(item);
                    } else if (action === "mute") {
                      setMuted((on) => !on);
                    } else if (action === "comments") {
                      setCommentsFor(item);
                    } else if (action === "report") {
                      report(item);
                    } else if (action === "block") {
                      block(item);
                    }
                  }}
                  className="gap-1 px-2.5 pt-3"
                >
                  <View className="flex-row items-center gap-3">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-primary">
                      <Text className="font-strong text-base text-primary-foreground">
                        {(item.author ?? "?").slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text
                        numberOfLines={1}
                        className="font-display text-[26px] leading-7 text-primary"
                      >
                        {item.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        className="text-sm leading-[18px] text-muted-foreground"
                      >
                        {item.author ? `@${item.author}` : t.ticket.anonymous}
                        {" · "}
                        {item.description}
                      </Text>
                    </View>
                  </View>
                  <GameActions
                    game={item}
                    onLike={() => like(item)}
                    onComments={() => setCommentsFor(item)}
                    onSave={() => save(item)}
                    muted={muted}
                    onMute={() => setMuted((on) => !on)}
                    onMore={item.mine ? undefined : () => more(item)}
                  />
                </View>
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
              {error || (loading ? t.feed.loading : empty)}
            </Text>
            {!!error && (
              <Button
                variant="outline"
                className="rounded-full"
                onPress={() => load(start, false)}
              >
                <Text>{t.common.tryAgain}</Text>
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
              onPress={() => (next ? load(next, true) : load(start, false))}
            >
              <Text>{t.common.tryAgain}</Text>
            </Button>
          </View>
        )}
      </View>
      <ReportSheet
        target={reportFor}
        onClose={() => setReportFor(null)}
        onReported={(id) => {
          drop((g) => g.id === id);
          setReportFor((open) => (open?.id === id ? null : open));
        }}
        onBlocked={(handle) => {
          hide(handle);
          setReportFor((open) => (open?.handle === handle ? null : open));
        }}
      />
      <CommentsSheet
        game={commentsFor}
        onClose={() => setCommentsFor(null)}
        onBlocked={hide}
        onCount={(id, delta) =>
          setGames((old) =>
            old.map((g) =>
              g.id === id ? { ...g, comments: g.comments + delta } : g
            )
          )
        }
      />
    </>
  );
};
