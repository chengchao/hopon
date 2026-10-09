import { useAuth, useUser } from "@clerk/expo";
import { newGame, PROMPT_MAX } from "@hopon/schemas";
import type { GameSummary } from "@hopon/schemas";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { feedGameHeight } from "@/components/feed";
import { GameView } from "@/components/game-view";
import { Ticket } from "@/components/ticket";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { api, gameUrl, HANDLE_REJECTED, handleRejected } from "@/lib/api";
import { cn } from "@/lib/utils";

const examples = [
  {
    label: "Moon cat",
    prompt:
      "A cat jumping on the moon. Tap to dodge meteors and collect stars.",
  },
  {
    label: "Fruit catcher",
    prompt:
      "A pixel-art fruit catcher. Move a basket to catch apples and avoid bombs.",
  },
  {
    label: "Ocean memory",
    prompt:
      "An ocean animal memory game. Flip cards and find every matching pair to win.",
  },
];

// Until Discover has laid out a game (it's empty, or Make opened first): the smallest viewport games are built for.
const MIN_GAME_HEIGHT = 540;

const Create = () => {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<GameSummary | null>(null);
  const [preview, setPreview] = useState<{ key: number; token?: string }>({
    key: 0,
  });
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [publishFailure, setPublishFailure] = useState("");
  const restored = useRef(false);
  const scroll = useRef<ScrollView>(null);
  // Set when a draft appears: the preview stays scrolled to the top of the sheet, through the layout shifts that follow, until the person scrolls.
  const reveal = useRef(false);

  // Clerk tokens live ~60s, so every request and every preview load gets a fresh one.
  const showDraft = useCallback(
    async (game: GameSummary | null) => {
      setDraft(game);
      if (game) {
        reveal.current = true;
        const token = (await getToken()) ?? undefined;
        setPreview((p) => ({ key: p.key + 1, token }));
      }
    },
    [getToken]
  );

  // The server keeps the newest unpublished draft, so it survives the app being killed mid-generation.
  // Once per screen: Clerk's getToken isn't referentially stable, so the deps change on every render.
  useEffect(() => {
    if (!isSignedIn || restored.current) {
      return;
    }
    restored.current = true;
    const restore = async () => {
      try {
        const latest = await api<{ draft: GameSummary | null }>(
          "/api/drafts/latest",
          {
            token: await getToken(),
          }
        );
        await showDraft(latest.draft);
      } catch (restoreError) {
        setError((restoreError as Error).message);
      }
    };
    restore();
  }, [isSignedIn, getToken, showDraft]);

  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">Loading…</Text>
      </View>
    );
  }
  if (!isSignedIn) {
    return <Redirect href="/sign-in?next=create" />;
  }

  const generate = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await showDraft(
        await api<GameSummary>("/api/games", {
          body: { prompt },
          token: await getToken(),
        })
      );
    } catch (generateError) {
      setError((generateError as Error).message);
    }
    setBusy(false);
  };

  const publish = async () => {
    if (!draft || publishing) {
      return;
    }
    // Published games show their maker, so ask for a handle first; this screen is still here afterwards.
    if (!user?.username) {
      return router.push("/handle");
    }
    setPublishing(true);
    setPublishFailure("");
    try {
      await api(`/api/games/${draft.id}/publish`, {
        method: "POST",
        token: await getToken({ skipCache: true }),
      });
      router.dismissTo({
        params: { published: String(draft.id) },
        pathname: "/",
      });
    } catch (publishError) {
      if (handleRejected(publishError)) {
        router.push(HANDLE_REJECTED);
      } else {
        setPublishFailure((publishError as Error).message);
      }
    }
    setPublishing(false);
  };

  const locked = busy || publishing;
  const canMake = !locked && newGame.safeParse({ prompt }).success;
  const makeLabel = draft ? "Make it again" : "Make the game";
  return (
    <ScrollView
      ref={scroll}
      onScrollBeginDrag={() => {
        reveal.current = false;
      }}
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5"
      contentContainerStyle={{
        paddingBottom: insets.bottom + 24,
        paddingTop: 20,
      }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View className="flex-row items-start justify-between gap-4">
        <Text
          accessibilityRole="header"
          className="flex-1 font-display text-[52px] leading-[52px]"
        >
          What should we play?
        </Text>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onPress={() => router.back()}
        >
          <Text>Close</Text>
        </Button>
      </View>
      <Text className="-mt-2 text-base leading-[22px] text-muted-foreground">
        Describe the game, how it looks, and one twist. We build it in about a
        minute.
      </Text>

      <View className="gap-3">
        <Textarea
          value={prompt}
          onChangeText={setPrompt}
          maxLength={PROMPT_MAX}
          editable={!locked}
          accessibilityLabel="Game idea"
          placeholder="A cat on the moon. Tap to dodge meteors and collect stars."
          className="min-h-28 rounded-2xl border-0 bg-card px-4 py-3 text-lg leading-6"
        />
        <Text className="text-sm text-muted-foreground">
          Or start from an idea
        </Text>
        <View className="-mt-1 flex-row flex-wrap gap-2">
          {examples.map((example) => (
            <Button
              key={example.label}
              size="sm"
              variant="outline"
              className="rounded-full bg-transparent"
              disabled={locked}
              onPress={() => setPrompt(example.prompt)}
            >
              <Text>{example.label}</Text>
            </Button>
          ))}
        </View>
        <View className="flex-row items-center justify-between pt-1">
          <Text className="text-sm text-muted-foreground">
            {prompt.length} / {PROMPT_MAX}
          </Text>
          <Button
            className={cn(
              "rounded-full px-6",
              !canMake && "bg-card opacity-100"
            )}
            disabled={!canMake}
            onPress={() => generate()}
          >
            <Text className={cn(!canMake && "text-muted-foreground")}>
              {busy ? "Making…" : makeLabel}
            </Text>
          </Button>
        </View>
      </View>

      {!!error && (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
      {busy && (
        <Text accessibilityRole="alert" className="text-muted-foreground">
          Making your game. This takes about a minute; your current draft stays
          until the new one is ready.
        </Text>
      )}

      {/* A draft spans the sheet less the feed row's px-3, so it's as wide as the feed shows it. */}
      <View
        className={cn(draft && "-mx-5 px-3")}
        onLayout={(e) => {
          if (reveal.current) {
            scroll.current?.scrollTo({ y: e.nativeEvent.layout.y });
          }
        }}
      >
        <View
          className={
            draft
              ? "overflow-hidden rounded-t-2xl bg-card"
              : "h-[260px] rounded-2xl bg-card"
          }
          style={
            draft ? { height: feedGameHeight() ?? MIN_GAME_HEIGHT } : undefined
          }
        >
          {draft ? (
            <GameView
              key={preview.key}
              uri={gameUrl(draft.id)}
              title={`Preview: ${draft.title}`}
              token={preview.token}
            />
          ) : (
            <View className="flex-1 items-center justify-center px-8">
              <Text className="text-center text-muted-foreground">
                Your game shows up here. Play it, then publish it to the feed.
              </Text>
            </View>
          )}
        </View>
        {draft && (
          <Ticket
            byline={
              <Text className="font-strong text-xs text-primary-foreground/60">
                Unpublished draft
              </Text>
            }
            title={draft.title}
            description={draft.description}
          >
            <View className="flex-row gap-2 pt-3">
              <Button
                variant="outline"
                className="rounded-full border-primary-foreground/30 bg-transparent dark:border-primary-foreground/30 dark:bg-transparent"
                disabled={busy}
                onPress={() => showDraft(draft)}
              >
                <Text className="text-primary-foreground">Restart</Text>
              </Button>
              <Button
                className="flex-1 rounded-full bg-primary-foreground"
                disabled={locked}
                onPress={() => publish()}
              >
                <Text className="text-primary">
                  {publishing ? "Publishing…" : "Publish to the feed"}
                </Text>
              </Button>
            </View>
            {/* Here, not with the form's errors: those sit above the fold while the preview fills the sheet. */}
            {!!publishFailure && (
              <Text
                accessibilityRole="alert"
                className="pt-2 text-primary-foreground"
              >
                {publishFailure}
              </Text>
            )}
          </Ticket>
        )}
      </View>
    </ScrollView>
  );
};

export default Create;
