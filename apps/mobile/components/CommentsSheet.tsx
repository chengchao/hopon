import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { api, type Comment, type Game } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth, useUser } from '@clerk/expo';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Covers the ticket and the lower part of the game; the game stays visible above so you keep your place.
export function CommentsSheet({
  game,
  onClose,
  onCount,
}: {
  game: Game | null;
  onClose: () => void;
  /** A comment was posted (+1) or deleted (-1), so the feed's count can follow. */
  onCount: (id: number, delta: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [list, setList] = useState<Comment[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });
  // The open game, so a page that arrives after the sheet moved on is dropped.
  const open = useRef<number | undefined>(undefined);
  const id = game?.id;

  const load = useCallback(async (gameId: number, before?: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ comments: Comment[]; next: number | null }>(
        `/api/games/${gameId}/comments${before ? `?before=${before}` : ''}`,
        { token: await token.current() },
      );
      if (open.current !== gameId) return;
      setList((old) => (before ? [...old, ...data.comments] : data.comments));
      setNext(data.next);
    } catch (e) {
      if (open.current === gameId) setError((e as Error).message);
    } finally {
      if (open.current === gameId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    open.current = id;
    setList([]);
    setNext(null);
    setText('');
    setError('');
    if (id) void load(id);
  }, [id, load]);

  // Signed out, or signed in without a handle: the input leads there first, as Create does.
  const gate = !isSignedIn ? '/sign-in' : !user?.username ? '/handle' : null;

  async function post() {
    const body = text.trim();
    if (!game || !body || posting) return;
    setPosting(true);
    setError('');
    try {
      // skipCache: the handle is a token claim, and may have been picked moments ago.
      const comment = await api<Comment>(`/api/games/${game.id}/comments`, {
        token: await getToken({ skipCache: true }),
        body: { body },
      });
      setList((old) => [comment, ...old]);
      setText('');
      onCount(game.id, 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  function remove(comment: Comment) {
    if (!game || !comment.canDelete) return;
    Alert.alert('Delete comment?', comment.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/api/comments/${comment.id}`, { token: await getToken(), method: 'DELETE' });
            setList((old) => old.filter((c) => c.id !== comment.id));
            onCount(game.id, -1);
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);
  }

  return (
    <Modal visible={!!game} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable className="absolute inset-0" accessibilityLabel="Close comments" onPress={onClose} />
        <View className="h-[62%] rounded-t-3xl bg-card px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <View className="mb-2 h-1 w-10 self-center rounded-full bg-border" />
          <View className="flex-row items-center justify-between">
            <Text accessibilityRole="header" className="font-display text-[32px] leading-[36px]">
              Comments
            </Text>
            <Button size="sm" variant="ghost" className="rounded-full" onPress={onClose}>
              <Text>Close</Text>
            </Button>
          </View>
          <FlatList
            className="flex-1"
            contentContainerClassName="gap-3 py-3"
            data={list}
            keyExtractor={(comment) => String(comment.id)}
            onEndReached={() => {
              if (id && next && !loading) void load(id, next);
            }}
            renderItem={({ item }) => (
              <Pressable
                className="gap-0.5"
                onLongPress={item.canDelete ? () => remove(item) : undefined}
                accessibilityLabel={`@${item.author}: ${item.body}`}
                accessibilityHint={item.canDelete ? 'Long press to delete' : undefined}
                accessibilityActions={item.canDelete ? [{ name: 'delete', label: 'Delete comment' }] : undefined}
                onAccessibilityAction={() => remove(item)}
              >
                <Text className="font-strong text-sm text-muted-foreground">@{item.author}</Text>
                <Text className="text-base leading-[22px]">{item.body}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text className="py-6 text-center text-muted-foreground">
                {loading ? 'Loading comments…' : error ? '' : `No comments on ${game?.title} yet. Be the first.`}
              </Text>
            }
          />
          {!!error && <Text className="pb-2 text-center text-sm text-destructive">{error}</Text>}
          {gate ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onClose();
                router.push(gate);
              }}
              className="h-12 justify-center rounded-full bg-background px-4"
            >
              <Text className="text-muted-foreground">
                {isSignedIn ? 'Pick your name to comment' : 'Sign in to comment'}
              </Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center gap-2">
              <Input
                value={text}
                onChangeText={setText}
                placeholder="Add a comment"
                accessibilityLabel="Comment"
                maxLength={300}
                multiline
                submitBehavior="blurAndSubmit"
                returnKeyType="send"
                onSubmitEditing={() => void post()}
                className="max-h-28 min-h-12 flex-1 rounded-3xl border-0 bg-background px-4 py-3"
              />
              <Button
                className={cn('h-12 rounded-full px-5', !text.trim() && 'bg-background opacity-100')}
                disabled={!text.trim() || posting}
                onPress={() => void post()}
              >
                <Text className={cn(!text.trim() && 'text-muted-foreground')}>{posting ? 'Posting…' : 'Post'}</Text>
              </Button>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
