import type { FeedGame } from "@hopon/schemas";
import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { COLORS } from "@/lib/theme";

const Pill = ({
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
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={selected === undefined ? undefined : { selected }}
    hitSlop={{ bottom: 6, top: 6 }}
    onPress={onPress}
    className="h-8 min-w-8 flex-row items-center justify-center gap-1 rounded-full border-[1.5px] border-primary-foreground/70 px-2 active:bg-primary-foreground/10"
  >
    {children}
    {count !== undefined && (
      <Text className="font-strong text-[13px] leading-4 text-primary-foreground">
        {count}
      </Text>
    )}
  </Pressable>
);

// Like, comment, save and "more" sit on the ticket, never over the game, so they can't steal the game's touches.
export const TicketActions = ({
  game,
  onLike,
  onComments,
  onSave,
  onMore,
}: {
  game: FeedGame;
  onLike: () => void;
  onComments: () => void;
  onSave: () => void;
  /** Opens the menu with Report game; left out on the viewer's own games. */
  onMore?: () => void;
}) => {
  const isLiked = game.liked;
  const isSaved = game.saved;
  const commentCount = game.comments;
  return (
    <View className="flex-row items-center gap-1.5">
      <Pill
        label={isLiked ? "Unlike" : "Like"}
        selected={isLiked}
        onPress={onLike}
        count={game.likes}
      >
        <Heart
          size={18}
          strokeWidth={2.25}
          color={isLiked ? COLORS.bulb : COLORS.ink}
          fill={isLiked ? COLORS.bulb : "none"}
        />
      </Pill>
      <Pill
        label={`Comments, ${commentCount}`}
        onPress={onComments}
        count={commentCount}
      >
        <MessageCircle size={18} strokeWidth={2.25} color={COLORS.ink} />
      </Pill>
      <Pill
        label={isSaved ? "Remove from saved" : "Save"}
        selected={isSaved}
        onPress={onSave}
      >
        <Bookmark
          size={18}
          strokeWidth={2.25}
          color={COLORS.ink}
          fill={isSaved ? COLORS.ink : "none"}
        />
      </Pill>
      {onMore && (
        <Pill label="More" onPress={onMore}>
          <MoreHorizontal size={18} strokeWidth={2.25} color={COLORS.ink} />
        </Pill>
      )}
    </View>
  );
};
