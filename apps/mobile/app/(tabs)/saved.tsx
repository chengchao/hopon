import { useAuth } from "@clerk/expo";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Byline, Ticket } from "@/components/Ticket";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import type { Game } from "@/lib/api";

export default function Saved() {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
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
    const current = before ? generation.current : ++generation.current;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const data = await api<{ games: Game[]; next: number | null }>(
        `/api/saves${before ? `?before=${before}` : ""}`,
        {
          token: await token.current(),
        }
      );
      if (current !== generation.current) {
        return;
      }
      setGames((old) => (before ? [...old, ...data.games] : data.games));
      setNext(data.next);
    } catch (error) {
      if (current === generation.current) setError((error as Error).message);
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, []);

  // Refetched whenever Saved comes into view, so saves made or removed elsewhere show up.
  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) {
        void load();
      } else {
        generation.current++;
        setGames([]);
        setNext(null);
      }
    }, [isSignedIn, load])
  );

  const header = (
    <Text
      accessibilityRole="header"
      className="px-2 pb-1 pt-4 font-display text-[44px] leading-[48px]"
    >
      Saved
    </Text>
  );
  if (!isLoaded) {
    return <View className="flex-1 bg-background" />;
  }
  if (!isSignedIn) {
    return (
      <View
        className="flex-1 gap-4 bg-background px-3"
        style={{ paddingTop: insets.top }}
      >
        {header}
        <Text className="px-2 text-base leading-[22px] text-muted-foreground">
          Sign in to see your saved games
        </Text>
        <Button
          className="mx-2 h-12 self-start rounded-full px-6"
          onPress={() => router.push("/sign-in")}
        >
          <Text>Sign in</Text>
        </Button>
      </View>
    );
  }
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <FlatList
        data={games}
        keyExtractor={(game) => String(game.id)}
        contentContainerClassName="gap-4 px-3 pb-6"
        ListHeaderComponent={header}
        onEndReached={() => {
          if (next && !error) {
            void load(next);
          }
        }}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.description}`}
            accessibilityHint="Opens your saved games from here"
            onPress={() => router.push(`/saved-feed?from=${item.saveId}`)}
            className="active:opacity-80"
          >
            <Ticket
              className="rounded-2xl"
              torn={false}
              compact
              byline={<Byline author={item.author} />}
              title={item.title}
              description={item.description}
            />
          </Pressable>
        )}
        ListEmptyComponent={
          loading || error ? null : (
            <Text className="px-2 pt-2 text-base leading-[22px] text-muted-foreground">
              Tap the bookmark on a game's ticket to keep it here.
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
                  void load(games.length ? (next ?? undefined) : undefined)
                }
              >
                <Text>Try again</Text>
              </Button>
            </View>
          ) : null
        }
      />
    </View>
  );
}
