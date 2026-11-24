import type { ReactNode } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";

// A saved game's ride ticket: one line each for the title and the Caption.
export const Ticket = ({
  title,
  caption,
  byline,
}: {
  title: string;
  caption: string;
  /** Who made it. */
  byline: ReactNode;
}) => (
  <View className="gap-0.5 rounded-2xl bg-primary px-4 pb-3 pt-3.5">
    <View className="min-h-8 justify-center">{byline}</View>
    <Text
      numberOfLines={1}
      className="font-display text-[32px] leading-[42px] text-primary-foreground"
    >
      {title}
    </Text>
    <Text
      numberOfLines={1}
      className="text-[15px] leading-5 text-primary-foreground/80"
    >
      {caption}
    </Text>
  </View>
);

// Who made the game: an initial in an ink circle, then the handle.
export const Byline = ({ author }: { author?: string | null }) => (
  <View className="flex-row items-center gap-2">
    <View className="h-7 w-7 items-center justify-center rounded-full bg-primary-foreground">
      <Text className="font-strong text-xs text-primary">
        {(author ?? "?").slice(0, 1).toUpperCase()}
      </Text>
    </View>
    <Text
      numberOfLines={1}
      className="flex-shrink font-strong text-sm text-primary-foreground"
    >
      {author ? `@${author}` : t.ticket.anonymous}
    </Text>
  </View>
);
