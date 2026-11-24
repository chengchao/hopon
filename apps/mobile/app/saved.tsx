import { useAuth } from "@clerk/expo";
import type { GamePage, SavedGame } from "@hopon/schemas";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Byline, Ticket } from "@/components/ticket";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

const Saved = () => {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [games, setGames] = useState<SavedGame[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });
  // Bumped by each refresh, so a page that lands after a newer refresh (or a sign-out) is dropped.
  const generation = useRef(0);
  const busy = useRef(false);

  // No `before` refreshes from the newest save; a `before` appends the next page.
  const load = useCallback(async (before?: number) => {
    if (before && busy.current) {
      return;
    }
    if (!before) {
      generation.current += 1;
    }
    const { current } = generation;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const data = await api<GamePage<SavedGame>>(
        `/api/saves${before ? `?before=${before}` : ""}`,
        {
          token: await token.current(),
        }
      );
      if (current === generation.current) {
        setGames((old) => (before ? [...old, ...data.games] : data.games));
        setNext(data.next);
      }
    } catch (loadError) {
      if (current === generation.current) {
        setError((loadError as Error).message);
      }
    }
    if (current === generation.current) {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  // Refetched whenever Saved comes into view, so saves made or removed elsewhere show up.
  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) {
        load();
      } else {
        generation.current += 1;
        setGames([]);
        setNext(null);
      }
    }, [isSignedIn, load])
  );

  if (!isLoaded) {
    return <View className="flex-1 bg-background" />;
  }
  // Saved opens from Me, which shows it only signed in; a sign-out while it is open leaves it.
  if (!isSignedIn) {
    return <Redirect href="/me" />;
  }
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingBottom: insets.bottom }}
    >
      <FlatList
        data={games}
        keyExtractor={(game) => String(game.id)}
        contentContainerClassName="gap-4 px-3 pb-6 pt-3"
        onEndReached={() => {
          if (next && !error) {
            load(next);
          }
        }}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.caption}`}
            accessibilityHint={t.saved.openHint}
            onPress={() => router.push(`/saved-feed?from=${item.saveId}`)}
            className="active:opacity-80"
          >
            <Ticket
              byline={<Byline author={item.author} />}
              title={item.title}
              caption={item.caption}
            />
          </Pressable>
        )}
        ListEmptyComponent={
          loading || error ? null : (
            <Text className="px-2 pt-2 text-base leading-[22px] text-muted-foreground">
              {t.saved.empty}
            </Text>
          )
        }
        ListFooterComponent={
          error ? (
            <View className="items-start gap-3 px-2 pt-2">
              <Text className="text-destructive">{error}</Text>
              <Button
                variant="outline"
                className="rounded-full"
                onPress={() =>
                  load(games.length ? (next ?? undefined) : undefined)
                }
              >
                <Text>{t.common.tryAgain}</Text>
              </Button>
            </View>
          ) : null
        }
      />
    </View>
  );
};

export default Saved;
