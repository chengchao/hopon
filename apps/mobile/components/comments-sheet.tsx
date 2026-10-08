import { useAuth, useUser } from "@clerk/expo";
import { characters, COMMENT_MAX, newComment } from "@hopon/schemas";
import type { Comment, CommentPage, GameSummary } from "@hopon/schemas";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { confirmBlock, ReportSheet, targetOf } from "@/components/report-sheet";
import type { ReportTarget } from "@/components/report-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Covers the ticket and the lower part of the game; the game stays visible above so you keep your place.
export const CommentsSheet = ({
  game,
  onClose,
  onCount,
  onBlocked,
}: {
  game: GameSummary | null;
  onClose: () => void;
  /** A comment was posted (+1) or deleted (-1), so the feed's count can follow. */
  onCount: (id: number, delta: number) => void;
  /** The viewer blocked @handle, so the feed can hide their games too. */
  onBlocked: (handle: string) => void;
}) => {
  const insets = useSafeAreaInsets();
  const { isSignedIn, getToken } = useAuth();
  const { user, isLoaded } = useUser();
  const [list, setList] = useState<Comment[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(!!game);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [reportFor, setReportFor] = useState<ReportTarget | null>(null);
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });
  // The open game, so a response that arrives after the sheet moved on doesn't land in another game's list.
  const open = useRef<number | null>(null);
  // Where to go once the sheet has closed; see `leave`.
  const after = useRef<"/sign-in" | "/handle" | null>(null);
  const id = game?.id;

  // Callers set `loading` first: the reset below for a newly opened game, onEndReached for the next page.
  const load = useCallback(async (gameId: number, before?: number) => {
    try {
      const data = await api<CommentPage>(
        `/api/games/${gameId}/comments${before ? `?before=${before}` : ""}`,
        { token: await token.current() }
      );
      if (open.current === gameId) {
        setList((old) => (before ? [...old, ...data.comments] : data.comments));
        setNext(data.next);
      }
    } catch (loadError) {
      if (open.current === gameId) {
        setError((loadError as Error).message);
      }
    }
    if (open.current === gameId) {
      setLoading(false);
    }
  }, []);

  // A different game starts from an empty sheet; reset during render so the old list never paints.
  const [shown, setShown] = useState(id);
  if (shown !== id) {
    setShown(id);
    setList([]);
    setNext(null);
    setText("");
    setError("");
    setPosting(false);
    setReportFor(null);
    setLoading(!!id);
  }

  useEffect(() => {
    open.current = id ?? null;
    if (id) {
      load(id);
    }
  }, [id, load]);

  // Signed out, or signed in without a handle: the input leads there first, as Create does.
  const handleGate = isLoaded && !user?.username ? "/handle" : null;
  const gate = isSignedIn ? handleGate : "/sign-in";
  const length = characters(text.trim());
  const sendable = newComment.safeParse({ body: text }).success && !posting;
  const emptyText = error
    ? ""
    : `No comments on ${game?.title} yet. Be the first.`;

  // iOS can't present a screen while this Modal is still sliding away, so it waits for onDismiss there.
  const leave = (to: "/sign-in" | "/handle") => {
    onClose();
    if (Platform.OS === "ios") {
      after.current = to;
    } else {
      router.push(to);
    }
  };

  const post = async () => {
    const body = text.trim();
    if (!game || !sendable) {
      return;
    }
    const gameId = game.id;
    setPosting(true);
    setError("");
    try {
      // skipCache: the handle is a token claim, and may have been picked moments ago.
      const comment = await api<Comment>(`/api/games/${gameId}/comments`, {
        body: { body },
        token: await getToken({ skipCache: true }),
      });
      onCount(gameId, 1);
      if (open.current === gameId) {
        setList((old) => [comment, ...old]);
        setText("");
      }
    } catch (postError) {
      if (open.current === gameId) {
        setError((postError as Error).message);
      }
    }
    if (open.current === gameId) {
      setPosting(false);
    }
  };

  const remove = (comment: Comment) => {
    if (!game || !comment.canDelete) {
      return;
    }
    const gameId = game.id;
    Alert.alert("Delete comment?", comment.body, [
      { style: "cancel", text: "Cancel" },
      {
        onPress: async () => {
          try {
            await api(`/api/comments/${comment.id}`, {
              method: "DELETE",
              token: await getToken(),
            });
            onCount(gameId, -1);
            if (open.current === gameId) {
              setList((old) => old.filter((c) => c.id !== comment.id));
            }
          } catch (deleteError) {
            if (open.current === gameId) {
              setError((deleteError as Error).message);
            }
          }
        },
        style: "destructive",
        text: "Delete",
      },
    ]);
  };

  const report = (comment: Comment) =>
    isSignedIn ? setReportFor(targetOf("comment", comment)) : leave("/sign-in");

  // Their comments leave the list at once, and the feed hides their games. Counts stay global, so they don't change.
  const hide = (handle: string) => {
    setList((old) => old.filter((c) => c.author !== handle));
    onBlocked(handle);
  };
  const block = (comment: Comment) => {
    if (!isSignedIn) {
      return leave("/sign-in");
    }
    confirmBlock({
      getToken,
      onBlocked: () => hide(comment.author),
      onReport: setReportFor,
      target: targetOf("comment", comment),
    });
  };

  // What a comment offers, for both its long-press menu and VoiceOver: Delete when allowed, Report and Block unless it's yours.
  const actionsFor = (comment: Comment) => [
    ...(comment.canDelete
      ? [
          {
            label: "Delete comment",
            name: "delete",
            onPress: () => remove(comment),
          },
        ]
      : []),
    ...(comment.mine
      ? []
      : [
          {
            label: "Report comment",
            name: "report",
            onPress: () => report(comment),
          },
          {
            label: `Block @${comment.author}`,
            name: "block",
            onPress: () => block(comment),
          },
        ]),
  ];

  // Long-press on someone else's comment opens a menu. On your own it stays a plain delete.
  const options = (comment: Comment) => {
    if (comment.mine) {
      return remove(comment);
    }
    const actions = actionsFor(comment);
    if (Platform.OS === "ios") {
      return ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: actions.length,
          // Delete, when offered, and Block.
          destructiveButtonIndex: comment.canDelete
            ? [0, actions.length - 1]
            : actions.length - 1,
          options: [...actions.map((a) => a.label), "Cancel"],
        },
        (index) => actions[index]?.onPress()
      );
    }
    Alert.alert(`@${comment.author}`, comment.body, [
      { style: "cancel", text: "Cancel" },
      ...actions.map(({ label, onPress }) => ({ onPress, text: label })),
    ]);
  };

  return (
    <Modal
      visible={!!game}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={() => {
        if (after.current) {
          router.push(after.current);
        }
        after.current = null;
      }}
    >
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0"
          accessibilityLabel="Close comments"
          onPress={onClose}
        />
        <View
          className="h-[62%] rounded-t-3xl bg-card px-5 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <View className="mb-2 h-1 w-10 self-center rounded-full bg-border" />
          <View className="flex-row items-center justify-between">
            <Text
              accessibilityRole="header"
              className="font-display text-[32px] leading-[36px]"
            >
              Comments
            </Text>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onPress={onClose}
            >
              <Text>Close</Text>
            </Button>
          </View>
          <FlatList
            className="flex-1"
            contentContainerClassName="gap-3 py-3"
            data={list}
            keyExtractor={(comment) => String(comment.id)}
            onEndReached={() => {
              if (!id || !next || loading) {
                return;
              }
              setLoading(true);
              setError("");
              load(id, next);
            }}
            renderItem={({ item }) => (
              <Pressable
                className="gap-0.5"
                onLongPress={() => options(item)}
                accessibilityLabel={`@${item.author}: ${item.body}`}
                accessibilityHint={
                  item.mine ? "Long press to delete" : "Long press for options"
                }
                accessibilityActions={actionsFor(item).map(
                  ({ label, name }) => ({ label, name })
                )}
                onAccessibilityAction={(e) =>
                  actionsFor(item)
                    .find((a) => a.name === e.nativeEvent.actionName)
                    ?.onPress()
                }
              >
                <Text className="font-strong text-sm text-muted-foreground">
                  @{item.author}
                </Text>
                <Text className="text-base leading-[22px]">{item.body}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text className="py-6 text-center text-muted-foreground">
                {loading ? "Loading comments…" : emptyText}
              </Text>
            }
          />
          {!!error && (
            <Text className="pb-2 text-center text-sm text-destructive">
              {error}
            </Text>
          )}
          {length > COMMENT_MAX && (
            <Text className="pb-2 text-center text-sm text-destructive">{`Too long: ${length}/${COMMENT_MAX} characters`}</Text>
          )}
          {gate ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => leave(gate)}
              className="h-12 justify-center rounded-full bg-background px-4"
            >
              <Text className="text-muted-foreground">
                {isSignedIn
                  ? "Pick your name to comment"
                  : "Sign in to comment"}
              </Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center gap-2">
              <Input
                value={text}
                onChangeText={setText}
                placeholder="Add a comment"
                accessibilityLabel="Comment"
                multiline
                className="max-h-28 min-h-12 flex-1 rounded-3xl border-0 bg-background px-4 py-3"
              />
              <Button
                className={cn(
                  "h-12 rounded-full px-5",
                  !sendable && "bg-background opacity-100"
                )}
                disabled={!sendable}
                onPress={() => post()}
              >
                <Text className={cn(!sendable && "text-muted-foreground")}>
                  {posting ? "Posting…" : "Post"}
                </Text>
              </Button>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
      {/* Inside this Modal: iOS can't present a second Modal from a sibling while this one is up. */}
      <ReportSheet
        target={reportFor}
        onClose={() => setReportFor(null)}
        onReported={(commentId) => {
          // Gone with no placeholder; the feed's count stays global, so it doesn't change.
          setList((old) => old.filter((c) => c.id !== commentId));
          setReportFor((current) =>
            current?.id === commentId ? null : current
          );
        }}
        onBlocked={(handle) => {
          if (handle) {
            hide(handle);
          }
          setReportFor(null);
        }}
      />
    </Modal>
  );
};
