import { Text } from '@/components/ui/text';
import type { Game } from '@/lib/api';
import { COLORS } from '@/lib/theme';
import { Bookmark, Heart, MessageCircle } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

// Like, comment and save sit on the ticket, never over the game, so they can't steal the game's touches.
export function TicketActions({
  game,
  onLike,
  onComments,
  onSave,
}: {
  game: Game;
  onLike: () => void;
  onComments: () => void;
  onSave: () => void;
}) {
  const isLiked = !!game.liked;
  const isSaved = !!game.saved;
  const commentCount = game.comments ?? 0;
  return (
    <View className="flex-row items-center gap-1.5">
      <Pill label={isLiked ? 'Unlike' : 'Like'} selected={isLiked} onPress={onLike} count={game.likes ?? 0}>
        <Heart
          size={18}
          strokeWidth={2.25}
          color={isLiked ? COLORS.bulb : COLORS.ink}
          fill={isLiked ? COLORS.bulb : 'none'}
        />
      </Pill>
      <Pill label={`Comments, ${commentCount}`} onPress={onComments} count={commentCount}>
        <MessageCircle size={18} strokeWidth={2.25} color={COLORS.ink} />
      </Pill>
      <Pill label={isSaved ? 'Remove from saved' : 'Save'} selected={isSaved} onPress={onSave}>
        <Bookmark size={18} strokeWidth={2.25} color={COLORS.ink} fill={isSaved ? COLORS.ink : 'none'} />
      </Pill>
    </View>
  );
}

function Pill({
  label,
  selected,
  count,
  onPress,
  children,
}: {
  label: string;
  selected?: boolean;
  count?: number;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      className="h-8 min-w-8 flex-row items-center justify-center gap-1 rounded-full border-[1.5px] border-primary-foreground/70 px-2 active:bg-primary-foreground/10"
    >
      {children}
      {count !== undefined && (
        <Text className="font-strong text-[13px] leading-4 text-primary-foreground">{count}</Text>
      )}
    </Pressable>
  );
}
