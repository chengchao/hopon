import { useAuth, useUser } from "@clerk/expo";
import { newMessage, PROMPT_MAX } from "@hopon/schemas";
import type { DraftSummary } from "@hopon/schemas";
import { Redirect, router } from "expo-router";
import {
  ArrowUp,
  ChevronDown,
  List,
  Play as PlayIcon,
  Square,
} from "lucide-react-native";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import type { TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiSheet } from "@/components/ai-sheet";
import { DraftList } from "@/components/draft-list";
import { Play } from "@/components/play";
import { PublishSheet } from "@/components/publish-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { draftTitle } from "@/lib/draft-list";
import { chatView, makerChat, NEW_CHAT, publishable } from "@/lib/maker-chat";
import type { Frame, Row } from "@/lib/maker-chat";
import { useMakerSocket } from "@/lib/maker-socket";
import type { Link } from "@/lib/maker-socket";
import { agreedToAi } from "@/lib/rules";
import { COLORS } from "@/lib/theme";
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

// The counter shows only this close to PROMPT_MAX.
const COUNTER_FROM = PROMPT_MAX - 200;

// A build's game card (#148): the latest opens Play, older ones are a plain line, since their Revisions are gone.
const Card = ({ row, onPlay }: { row: Row; onPlay: () => void }) =>
  row.play ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPlay}
      className="flex-row items-center gap-3 self-start rounded-2xl bg-primary px-4 py-3 active:opacity-80"
    >
      <PlayIcon color={COLORS.ink} fill={COLORS.ink} size={16} />
      <Text className="font-strong text-base text-primary-foreground">
        {row.text}
      </Text>
    </Pressable>
  ) : (
    <Text className="self-start text-sm text-muted-foreground">{row.text}</Text>
  );

const Bubble = ({
  row,
  onRetry,
  onPlay,
}: {
  row: Row;
  onRetry: (text: string) => void;
  onPlay: () => void;
}) => {
  if (row.who === "card") {
    return <Card row={row} onPlay={onPlay} />;
  }
  if (row.who === "status") {
    return (
      <View className="flex-row items-center gap-2 self-start">
        <ActivityIndicator size="small" color={COLORS.paper} />
        <Text className="text-sm text-muted-foreground">{row.text}</Text>
      </View>
    );
  }
  if (row.who === "app") {
    return (
      <View className="items-center gap-2 py-1">
        <Text
          accessibilityRole="alert"
          className="text-center text-sm text-muted-foreground"
        >
          {row.text}
        </Text>
        {row.retry !== undefined && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full bg-transparent"
            onPress={() => onRetry(row.retry ?? "")}
          >
            <Text>Try again</Text>
          </Button>
        )}
      </View>
    );
  }
  if (row.who === "maker") {
    return (
      <View className="max-w-[85%] gap-1 self-start">
        <Text className="font-strong text-xs text-muted-foreground">Maker</Text>
        <View className="rounded-2xl rounded-tl-sm bg-card px-4 py-3">
          <Text className="text-base leading-[22px]">{row.text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View
      className={cn("max-w-[85%] gap-1 self-end", row.queued && "opacity-50")}
    >
      <View className="rounded-2xl rounded-tr-sm bg-primary px-4 py-3">
        <Text className="text-base leading-[22px] text-primary-foreground">
          {row.text}
        </Text>
      </View>
      {row.queued && (
        <Text className="self-end text-xs text-muted-foreground">Queued</Text>
      )}
    </View>
  );
};

const Header = ({
  draft,
  onDrafts,
  canPlay,
  onPlay,
  canPublish,
  onPublish,
}: {
  draft: DraftSummary | null | undefined;
  // Unset while the chat can't switch yet.
  onDrafts?: () => void;
  // Once there is a game.
  canPlay: boolean;
  onPlay: () => void;
  // Once there is a Revision and no turn is running.
  canPublish: boolean;
  onPublish: () => void;
}) => (
  <View className="flex-row items-center gap-1 px-2 pb-2 pt-3">
    <Button
      size="icon"
      variant="ghost"
      accessibilityLabel="Close"
      onPress={() => router.back()}
    >
      <ChevronDown color={COLORS.paper} size={24} />
    </Button>
    <Button
      size="icon"
      variant="ghost"
      accessibilityLabel="Drafts"
      disabled={!onDrafts}
      onPress={onDrafts}
    >
      <List color={COLORS.paper} size={22} />
    </Button>
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      className="flex-1 text-center font-strong text-base"
    >
      {draftTitle(draft)}
    </Text>
    <Button size="sm" variant="ghost" disabled={!canPlay} onPress={onPlay}>
      <Text>Play</Text>
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
);

// The Draft, once it has a Revision to play: the Talker titled it, or this chat shows its card.
const withGame = (draft: DraftSummary | null | undefined, rows: Row[]) =>
  draft && (draft.title !== null || rows.some((row) => row.play))
    ? draft
    : undefined;

// A thin bar under the header while the socket is down; the composer keeps working, since messages are POSTs.
const LinkBar = ({ link, onRetry }: { link: Link; onRetry: () => void }) => {
  if (link !== "reconnecting" && link !== "unreachable") {
    return null;
  }
  return (
    <View className="flex-row items-center justify-center gap-3 bg-card px-4 py-1">
      <Text accessibilityRole="alert" className="text-xs text-muted-foreground">
        {link === "reconnecting" ? "Reconnecting…" : "Can't reach the Maker"}
      </Text>
      {link === "unreachable" && (
        <Button size="sm" variant="ghost" className="h-7" onPress={onRetry}>
          <Text className="text-xs">Retry</Text>
        </Button>
      )}
    </View>
  );
};

const Create = () => {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  // A message held back until the Creator answers the AI sheet.
  const [asking, setAsking] = useState<string>();
  // undefined until the Draft list answers; null for a new chat, whose Draft is born on its first message.
  const [draft, setDraft] = useState<DraftSummary | null>();
  const [chat, dispatch] = useReducer(makerChat, NEW_CHAT);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [listing, setListing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Turns ended since this chat opened; Play mints a fresh preview URL on each.
  const [turns, setTurns] = useState(0);
  // The build's timer ticks once a second while it runs.
  const [now, setNow] = useState(Date.now);
  const keys = useRef(0);
  const opened = useRef(false);
  // The open Draft's id (null for a new chat), set with it, so a response after an await can check it's still open.
  const openId = useRef<string | null>(null);
  const select = (next: DraftSummary | null) => {
    openId.current = next?.id ?? null;
    setDraft(next);
  };
  const scroll = useRef<ScrollView>(null);
  const composer = useRef<TextInput>(null);
  const view = useMemo(() => chatView(chat, now), [chat, now]);
  const building = chat.build !== undefined;
  useEffect(() => {
    if (!building) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [building]);

  const fetchDrafts = async () => {
    const list = await api<{ drafts: DraftSummary[] }>("/api/drafts", {
      token: await getToken(),
    });
    return list.drafts;
  };

  // + opens the most recent Draft (#119). Once per screen: Clerk's getToken changes on every render.
  useEffect(() => {
    if (!isSignedIn || opened.current) {
      return;
    }
    opened.current = true;
    const open = async () => {
      try {
        const drafts = await fetchDrafts();
        select(drafts[0] ?? null);
      } catch (openError) {
        select(null);
        setError((openError as Error).message);
      }
    };
    open();
  });

  const onFrame = async (frame: Frame) => {
    dispatch({ at: Date.now(), frame, type: "frame" });
    if (frame.type === "turn_done") {
      setTurns((n) => n + 1);
    }
    // The Talker names the game at the end of a turn that builds it.
    if (frame.type === "turn_done" && draft) {
      const drafts = await fetchDrafts().catch(() => []);
      const listed = drafts.find((d) => d.id === draft.id);
      // Unless the Creator has opened another Draft meanwhile.
      if (listed && openId.current === listed.id) {
        setDraft(listed);
      }
    }
  };
  const { link, retry } = useMakerSocket({
    draft: draft?.id,
    getToken,
    onFrame,
    running: view.running,
  });

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

  const post = async (message: string) => {
    const key = `${keys.current}`;
    keys.current += 1;
    dispatch({ key, text: message, type: "send" });
    setText("");
    // Typed text with an autocorrect suggestion pending survives the state change alone.
    composer.current?.clear();
    setError("");
    const at = draft?.id ?? null;
    try {
      const token = await getToken();
      if (draft) {
        const { id } = await api<{ id: string }>(
          `/api/drafts/${draft.id}/messages`,
          { body: { text: message }, token }
        );
        dispatch({ key, op: id, type: "sent" });
      } else {
        const created = await api<{ id: string; message: string }>(
          "/api/drafts",
          { body: { text: message }, token }
        );
        // The new chat may have been left for another Draft meanwhile; the Draft list has this one.
        if (openId.current === at) {
          select({
            description: null,
            id: created.id,
            title: null,
            updatedAt: "",
          });
        }
        dispatch({ key, op: created.message, type: "sent" });
      }
    } catch (sendError) {
      // A refused message isn't kept: it goes back to the composer, unless the Creator has typed since.
      dispatch({ key, type: "unsent" });
      // Not into another Draft's composer, if the Creator has switched meanwhile.
      if (openId.current === at) {
        setText((typed) => typed || message);
        setError((sendError as Error).message);
      }
    }
  };

  // Another Draft, or a new chat (null), from the Draft list; its socket brings its chat.
  const openDraft = (next: DraftSummary | null) => {
    if (next?.id === draft?.id) {
      return;
    }
    dispatch({ type: "reset" });
    setPlaying(false);
    select(next);
    setText("");
    setError("");
  };

  // Every Send, Try again included, asks first until the current AI_VERSION is agreed. Not now leaves the text where it
  // was (the composer, or the Try again row), so nothing leaves the phone.
  const send = (message: string) => {
    if (agreedToAi(user)) {
      post(message);
    } else {
      setAsking(message);
    }
  };
  const agreed = (message: string) => {
    setAsking(undefined);
    post(message);
  };

  const stop = async () => {
    if (!draft) {
      return;
    }
    setError("");
    try {
      await api(`/api/drafts/${draft.id}/stop`, {
        method: "POST",
        token: await getToken(),
      });
    } catch (stopError) {
      if (openId.current === draft.id) {
        setError((stopError as Error).message);
      }
    }
  };

  const message = text.trim();
  // Nothing sends until the Draft list has answered, and a new chat's second message waits for its Draft.
  const ready = draft !== undefined && !(draft === null && chat.pending.length);
  const canSend = ready && newMessage.safeParse({ text: message }).success;
  const showStop = view.running && !message;
  // A new chat with nothing in it yet: the welcome and the example ideas.
  const blank = draft === null && view.rows.length === 0;
  const game = withGame(draft, view.rows);
  const play = () => {
    Keyboard.dismiss();
    setPlaying(true);
  };
  const canPublish = publishable(draft, view);
  const publish = () => {
    Keyboard.dismiss();
    setConfirming(true);
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-background">
      <Header
        draft={draft}
        // Not before the list has answered, nor while a new chat's Draft is being born.
        onDrafts={
          ready
            ? () => {
                Keyboard.dismiss();
                setListing(true);
              }
            : undefined
        }
        canPlay={game !== undefined}
        onPlay={play}
        canPublish={canPublish}
        onPublish={publish}
      />
      {draft && <LinkBar link={link} onRetry={retry} />}

      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerClassName="gap-3 px-4 py-4"
        keyboardShouldPersistTaps="handled"
        // Every redraw, a snapshot's included, lands at the bottom (#119), and so does the view when the
        // Reconnecting bar comes or goes.
        onContentSizeChange={() =>
          scroll.current?.scrollToEnd({ animated: false })
        }
        onLayout={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        {blank && (
          <View className="gap-3 pt-4">
            <Text className="font-display text-[52px] leading-[52px]">
              What should we play?
            </Text>
            <Text className="text-base leading-[22px] text-muted-foreground">
              Describe the game, how it looks, and one twist.
            </Text>
            <Text className="pt-2 text-sm text-muted-foreground">
              Or start from an idea
            </Text>
            <View className="-mt-1 flex-row flex-wrap gap-2">
              {examples.map((example) => (
                <Button
                  key={example.label}
                  size="sm"
                  variant="outline"
                  className="rounded-full bg-transparent"
                  onPress={() => setText(example.prompt)}
                >
                  <Text>{example.label}</Text>
                </Button>
              ))}
            </View>
          </View>
        )}
        {view.rows.map((row) => (
          <Bubble key={row.key} row={row} onRetry={send} onPlay={play} />
        ))}
      </ScrollView>

      <View
        className="gap-1 px-4 pt-2"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <View className="flex-row items-end gap-2">
          <Textarea
            ref={composer}
            value={text}
            onChangeText={setText}
            maxLength={PROMPT_MAX}
            numberOfLines={5}
            accessibilityLabel="Message to the Maker"
            placeholder={blank ? "A cat on the moon…" : "Ask for a change"}
            className="min-h-11 flex-1 rounded-3xl border-0 bg-card px-4 py-3 text-base leading-5"
          />
          {showStop ? (
            <Button
              size="icon"
              className="h-11 w-11 rounded-full"
              accessibilityLabel="Stop"
              onPress={() => stop()}
            >
              <Square color={COLORS.ink} fill={COLORS.ink} size={14} />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-11 w-11 rounded-full"
              accessibilityLabel="Send"
              disabled={!canSend}
              onPress={() => send(message)}
            >
              <ArrowUp color={COLORS.ink} size={20} strokeWidth={3} />
            </Button>
          )}
        </View>
        {text.length > COUNTER_FROM && (
          <Text className="self-end text-xs text-muted-foreground">
            {text.length} / {PROMPT_MAX}
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {error}
          </Text>
        )}
      </View>
      {playing && game && (
        <Play
          draft={game}
          turns={turns}
          onClose={() => setPlaying(false)}
          canPublish={canPublish}
          onPublish={publish}
        />
      )}
      {listing && (
        <DraftList
          openId={draft?.id}
          onOpen={openDraft}
          onClose={() => setListing(false)}
        />
      )}
      <PublishSheet
        draft={draft}
        open={confirming}
        onClose={() => setConfirming(false)}
      />
      <AiSheet
        message={asking}
        onAgreed={agreed}
        onClose={() => setAsking(undefined)}
      />
    </KeyboardAvoidingView>
  );
};

export default Create;
