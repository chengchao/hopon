import type { FeedGame } from "@hopon/schemas";
import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { COLORS } from "@/lib/theme";

const ICON = { color: COLORS.paper, size: 22, strokeWidth: 2.25 };

const Action = ({
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
    hitSlop={10}
    onPress={onPress}
    className="h-10 flex-row items-center gap-1.5 active:opacity-60"
  >
    {children}
    {count !== undefined && (
      <Text className="font-strong text-[15px] leading-5 text-foreground">
        {count}
      </Text>
    )}
  </Pressable>
);

// Like, comment, save, mute and "more" sit under the game, never over it, so they can't steal the game's touches.
export const GameActions = ({
  game,
  onLike,
  onComments,
  onSave,
  muted,
  onMute,
  onMore,
}: {
  game: FeedGame;
  onLike: () => void;
  onComments: () => void;
  onSave: () => void;
  /** The feed's one mute, for every game in it. */
  muted: boolean;
  onMute: () => void;
  /** Opens the menu with Report game and Block; left out on the viewer's own games. */
  onMore?: () => void;
}) => {
  const isLiked = game.liked;
  const isSaved = game.saved;
  const commentCount = game.comments;
  return (
    <View className="flex-row items-center gap-5">
      <Action
        label={isLiked ? t.feed.unlike : t.feed.like}
        selected={isLiked}
        onPress={onLike}
        count={game.likes}
      >
        <Heart
          {...ICON}
          color={isLiked ? COLORS.bulb : COLORS.paper}
          fill={isLiked ? COLORS.bulb : "none"}
        />
      </Action>
      <Action
        label={t.feed.commentsCount(commentCount)}
        onPress={onComments}
        count={commentCount}
      >
        <MessageCircle {...ICON} />
      </Action>
      <Action
        label={isSaved ? t.feed.removeSaved : t.feed.save}
        selected={isSaved}
        onPress={onSave}
      >
        <Bookmark
          {...ICON}
          color={isSaved ? COLORS.ticket : COLORS.paper}
          fill={isSaved ? COLORS.ticket : "none"}
        />
      </Action>
      <View className="flex-1" />
      <Action label={muted ? t.feed.unmute : t.feed.mute} onPress={onMute}>
        {muted ? <VolumeX {...ICON} /> : <Volume2 {...ICON} />}
      </Action>
      {onMore && (
        <Action label={t.feed.more} onPress={onMore}>
          <MoreHorizontal {...ICON} />
        </Action>
      )}
    </View>
  );
};
