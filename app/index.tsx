import { GameView } from '@/components/GameView';
import { Ticket } from '@/components/Ticket';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { api, gameUrl, type Game } from '@/lib/api';
import { snapTarget } from '@/lib/feed-motion';
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
      const data = await api<{ games: Game[]; next: number | null }>(`/api/games${before ? `?before=${before}` : ''}`);
      setGames((old) => (before ? [...old, ...data.games] : data.games));
      setNext(data.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  // First load, and a fresh feed (scrolled to the top) after Create publishes a game.
  useEffect(() => {
    setActive(0);
    scrollTo(0, false);
    void load();
  }, [load, published, scrollTo]);
  useEffect(() => {
    if (next && active >= games.length - 2 && !error) void load(next);
  }, [active, next, games.length, load, error]);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

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
      <View className="flex-row items-center justify-between px-5 pb-3 pt-1">
        <Text accessibilityRole="header" className="font-display text-[40px] leading-[44px] text-foreground">
          hopon
        </Text>
        <Button size="sm" className="rounded-full px-4" onPress={() => router.push('/create')}>
          <Text>Make a game</Text>
        </Button>
      </View>
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
              <View style={{ height, paddingBottom: Math.max(insets.bottom, 12) }} className="px-3">
                <View className="flex-1 overflow-hidden rounded-t-2xl bg-card">
                  {Math.abs(index - active) <= 1 && <GameView uri={gameUrl(item.id)} title={item.title} />}
                </View>
                <Ticket
                  {...pan.panHandlers}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={`${item.title}. ${item.description}`}
                  accessibilityHint="Swipe up or down here to change games"
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={(e) => go(active + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
                  label={`No. ${String(item.id).padStart(4, '0')}`}
                  title={item.title}
                  description={item.description}
                >
                  <Text className="pt-2 font-strong text-sm text-primary-foreground/60">
                    {index === games.length - 1 && !next
                      ? "That's every game. Swipe down to go back."
                      : 'Swipe up on this ticket for the next game'}
                  </Text>
                </Ticket>
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
    </View>
  );
}
