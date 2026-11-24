// A Draft's card on the Drafts tab: its status, title and description. A Draft with a game is a yellow ticket, as its
// Game will be in Saved; one without is a dark blank. Tapping it opens the Draft's page; swiping it left asks to
// Delete it.
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Ticket } from "@/components/ticket";
import { Text } from "@/components/ui/text";
import type { DraftCardView } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { COLORS } from "@/lib/theme";
import { cn } from "@/lib/utils";

// How far a card slides left to show Delete.
const DELETE_WIDTH = 96;

const Badge = ({ card }: { card: DraftCardView }) => (
  <View className="flex-row items-center gap-2">
    {card.working && (
      <ActivityIndicator
        size="small"
        color={card.hasGame ? COLORS.ink : COLORS.paper}
      />
    )}
    <Text
      numberOfLines={1}
      // The turn's clock ticks without the text shifting.
      style={{ fontVariant: ["tabular-nums"] }}
      className={cn(
        "flex-shrink font-strong text-sm",
        card.hasGame ? "text-primary-foreground" : "text-muted-foreground"
      )}
    >
      {card.badge}
    </Text>
  </View>
);

// A horizontal ScrollView that snaps open is the swipe: no gesture library needed.
export const DraftCard = ({
  card,
  width,
  onOpen,
  onDelete,
}: {
  card: DraftCardView;
  // The list's, so Delete sits just past its edge.
  width: number;
  onOpen: () => void;
  // Resolves false when the Delete failed.
  onDelete: () => Promise<boolean>;
}) => {
  const swipe = useRef<ScrollView>(null);
  // The drag's end and the snap's end can both ask.
  const asking = useRef(false);
  const [deleting, setDeleting] = useState(false);

  const close = () => {
    asking.current = false;
    swipe.current?.scrollTo({ x: 0 });
  };
  const confirm = () => {
    if (asking.current) {
      return;
    }
    asking.current = true;
    Alert.alert(t.drafts.deleteTitle(card.title), t.drafts.deleteBody, [
      { onPress: close, style: "cancel", text: t.common.cancel },
      {
        onPress: async () => {
          setDeleting(true);
          // A deleted card unmounts; a failed one slides back.
          if (!(await onDelete())) {
            setDeleting(false);
            close();
          }
        },
        style: "destructive",
        text: t.common.delete,
      },
    ]);
  };
  const swiped = (x: number) => {
    if (x >= DELETE_WIDTH - 1) {
      confirm();
    }
  };

  return (
    <ScrollView
      ref={swipe}
      horizontal
      bounces={false}
      decelerationRate="fast"
      showsHorizontalScrollIndicator={false}
      snapToOffsets={[0, DELETE_WIDTH]}
      scrollEnabled={!deleting}
      onScrollEndDrag={({ nativeEvent }) => swiped(nativeEvent.contentOffset.x)}
      onMomentumScrollEnd={({ nativeEvent }) =>
        swiped(nativeEvent.contentOffset.x)
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={card.label}
        accessibilityHint={t.drafts.openHint}
        accessibilityActions={[{ label: t.common.delete, name: "delete" }]}
        onAccessibilityAction={confirm}
        disabled={deleting}
        onPress={onOpen}
        style={{ width }}
        className={cn("px-3 active:opacity-80", deleting && "opacity-50")}
      >
        {/* Keyed by its look, so the blank fades into the ticket when the first game lands. */}
        <Animated.View key={card.hasGame ? "game" : "blank"} entering={FadeIn}>
          {card.hasGame ? (
            <Ticket
              byline={<Badge card={card} />}
              title={card.title}
              description={card.line ?? ""}
            />
          ) : (
            <View className="gap-0.5 rounded-2xl border border-dashed border-border bg-card px-4 pb-3 pt-3.5">
              <View className="min-h-8 justify-center">
                <Badge card={card} />
              </View>
              <Text
                numberOfLines={1}
                className="font-display text-[32px] leading-[42px]"
              >
                {card.title}
              </Text>
            </View>
          )}
        </Animated.View>
      </Pressable>
      <Pressable
        accessible={false}
        disabled={deleting}
        onPress={confirm}
        style={{ width: DELETE_WIDTH }}
        className="items-center justify-center rounded-l-2xl bg-destructive"
      >
        <Text className="font-strong text-sm">
          {deleting ? t.drafts.deleting : t.common.delete}
        </Text>
      </Pressable>
    </ScrollView>
  );
};
