import type { ReactNode } from "react";
import { View } from "react-native";
import type { ViewProps } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// The ride ticket under each game. `compact` is the feed stub: one line each, so the game keeps the screen.
export function Ticket({
  title,
  description,
  byline,
  actions,
  children,
  compact = false,
  torn = true,
  className,
  ...props
}: ViewProps & {
  title: string;
  description: string;
  /** Top-left: who made it, or a status like "Unpublished draft". */
  byline?: ReactNode;
  /** Top-right: like, comment and save. */
  actions?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  /** Show the perforated edge; only meaningful when a game sits directly above. */
  torn?: boolean;
}) {
  return (
    <View
      {...props}
      className={cn(
        "rounded-b-2xl bg-primary",
        compact ? "gap-0.5 px-4 pb-3 pt-3.5" : "gap-1 px-5 pb-4 pt-5",
        className
      )}
    >
      {torn && <Perforation />}
      {(byline || actions) && (
        <View className="min-h-8 flex-row items-center gap-2">
          <View className="flex-1">{byline}</View>
          {actions}
        </View>
      )}
      <Text
        numberOfLines={compact ? 1 : 2}
        className={cn(
          "font-display text-primary-foreground",
          compact ? "text-[32px] leading-[36px]" : "text-[44px] leading-[44px]"
        )}
      >
        {title}
      </Text>
      <Text
        numberOfLines={compact ? 1 : 3}
        className={cn(
          "text-primary-foreground/80",
          compact ? "text-[15px] leading-5" : "text-base leading-[22px]"
        )}
      >
        {description}
      </Text>
      {children}
    </View>
  );
}

// Who made the game: an initial in an ink circle, then the handle.
export function Byline({ author }: { author?: string | null }) {
  return (
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
        {author ? `@${author}` : "A hopon player"}
      </Text>
    </View>
  );
}

// The torn edge between game and ticket: notches cut in the night colour, then a row of perforation dashes.
function Perforation() {
  return (
    <>
      <View className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-background" />
      <View className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full bg-background" />
      <View className="absolute left-5 right-5 top-0 flex-row justify-between">
        {Array.from({ length: 22 }, (_, i) => (
          <View
            key={i}
            className="h-[3px] w-1.5 rounded-full bg-primary-foreground/20"
          />
        ))}
      </View>
    </>
  );
}
