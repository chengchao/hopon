import { GameView } from '@/components/GameView';
import { CommentsSheet } from '@/components/CommentsSheet';
import { Byline, Ticket } from '@/components/Ticket';
import { TicketActions } from '@/components/TicketActions';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { api, gameUrl, type Game } from '@/lib/api';
import { toggleSave, usePrototype } from '@/lib/prototype';
import { snapTarget } from '@/lib/feed-motion';
import { useAuth } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, PanResponder, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Discover() {
  const insets = useSafeAreaInsets();
  const { published } = useLocalSearchParams<{ published?: string }>();
  const [games, setGames] = useState<Game[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [next, setNext] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Game | null>(null);
  const { saved } = usePrototype();
  const { isSignedIn, getToken } = useAuth();
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });
  const list = useRef<FlatList<Game>>(null);
  const busy = useRef(false);
  const origin = useRef(0);

  const scrollTo = useCallback(
    (offset: number, animated: boolean) => list.current?.scrollToOffset({ offset, animated }),
    [],
  );
  const load = useCallback(async (before?: number) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const data = await api<{ games: Game[]; next: number | null }>(`/api/games${before ? `?before=${before}` : ''}`, {
        token: await token.current(),
      });
      setGames((old) => (before ? [...old, ...data.games] : data.games));
      setNext(data.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  // First load, and a fresh feed (scrolled to the top) after Create publishes a game or you sign in or out.
  useEffect(() => {
    setActive(0);
    scrollTo(0, false);
    void load();
  }, [load, published, isSignedIn, scrollTo]);
  useEffect(() => {
    if (next && active >= games.length - 2 && !error) void load(next);
  }, [active, next, games.length, load, error]);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Optimistic: flip the heart now, then settle on the server's count, or flip back if the request fails.
  async function like(game: Game) {
    if (!isSignedIn) return router.push('/sign-in');
    const patch = (next: Pick<Game, 'liked' | 'likes'>) =>
      setGames((old) => old.map((g) => (g.id === game.id ? { ...g, ...next } : g)));
    const liked = !game.liked;
    patch({ liked, likes: (game.likes ?? 0) + (liked ? 1 : -1) });
    try {
      patch(
        await api<Pick<Game, 'liked' | 'likes'>>(`/api/games/${game.id}/like`, {
          token: await getToken(),
          method: liked ? 'PUT' : 'DELETE',
        }),
      );
    } catch {
      patch({ liked: game.liked, likes: game.likes });
    }
  }

  const go = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(games.length - 1, index));
      scrollTo(target * height, !reduceMotion);
      setActive(target);
    },
    [games.length, height, reduceMotion, scrollTo],
  );

  // Only the name/description area pages the feed; the game keeps every touch. A drag moves at most one game.
  const pan = useMemo(() => {
    const position = (dy: number) =>
      Math.max(origin.current - height, Math.min(origin.current + height, origin.current - dy));
    const settle = (dy: number) =>
      go(Math.round(snapTarget(origin.current, position(dy), height, games.length) / height));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        origin.current = active * height;
      },
      onPanResponderMove: (_, g) => scrollTo(position(g.dy), false),
      onPanResponderRelease: (_, g) => settle(g.dy),
      onPanResponderTerminate: (_, g) => settle(g.dy),
    });
  }, [active, height, games.length, go, scrollTo]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-1" onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        {height > 0 && (
          <FlatList
            ref={list}
            data={games}
            keyExtractor={(game) => String(game.id)}
            scrollEnabled={false}
            getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
            initialNumToRender={3}
            windowSize={3}
            extraData={active}
            renderItem={({ item, index }) => (
              <View style={{ height }} className="px-3 pb-3 pt-2">
                <View className="flex-1 overflow-hidden rounded-t-2xl bg-card">
                  {Math.abs(index - active) <= 1 && <GameView uri={gameUrl(item.id)} title={item.title} />}
                </View>
                <Ticket
                  {...pan.panHandlers}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={`${item.title}. ${item.description}`}
                  accessibilityHint="Swipe up or down here to change games"
                  // The ticket is one VoiceOver element, so its buttons are offered as custom actions too.
                  accessibilityActions={[
                    { name: 'increment' },
                    { name: 'decrement' },
                    { name: 'like', label: item.liked ? 'Unlike' : 'Like' },
                    { name: 'comments', label: 'Comments' },
                    { name: 'save', label: saved.some((g) => g.id === item.id) ? 'Remove from saved' : 'Save' },
                  ]}
                  onAccessibilityAction={(e) => {
                    const action = e.nativeEvent.actionName;
                    if (action === 'increment' || action === 'decrement')
                      go(active + (action === 'increment' ? 1 : -1));
                    else if (action === 'like') void like(item);
                    else if (action === 'save') toggleSave(item);
                    else if (action === 'comments') setCommentsFor(item);
                  }}
                  compact
                  byline={<Byline author={item.author} />}
                  title={item.title}
                  description={item.description}
                  actions={
                    <TicketActions game={item} onLike={() => void like(item)} onComments={() => setCommentsFor(item)} />
                  }
                />
              </View>
            )}
          />
        )}
        {!games.length && (
          <View className="absolute inset-0 items-center justify-center gap-4 px-8">
            <Text className={error ? 'text-center text-destructive' : 'text-center text-muted-foreground'}>
              {error || (loading ? 'Loading games…' : 'No games yet. Make the first one.')}
            </Text>
            {!!error && (
              <Button variant="outline" className="rounded-full" onPress={() => void load()}>
                <Text>Try again</Text>
              </Button>
            )}
          </View>
        )}
        {!!games.length && !!error && (
          <View className="absolute bottom-4 left-4 right-4 flex-row items-center gap-3 rounded-2xl bg-card p-3">
            <Text className="flex-1 text-destructive">{error}</Text>
            <Button size="sm" variant="outline" className="rounded-full" onPress={() => void load(next ?? undefined)}>
              <Text>Try again</Text>
            </Button>
          </View>
        )}
      </View>
      <CommentsSheet
        game={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCount={(id, delta) =>
          setGames((old) => old.map((g) => (g.id === id ? { ...g, comments: (g.comments ?? 0) + delta } : g)))
        }
      />
    </View>
  );
}
