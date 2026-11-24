// Play (#119, #148): the Draft's current Revision full height over the chat, with Back to chat, Restart and Publish.
import type { DraftSummary } from "@hopon/schemas";
import { ChevronLeft, RotateCcw } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DraftGame } from "@/components/draft-game";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { draftTitle } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { COLORS } from "@/lib/theme";

export const Play = ({
  draft,
  turns,
  onClose,
  canPublish,
  onPublish,
}: {
  draft: DraftSummary;
  // How many turns have ended since the chat opened: each one may have landed a Revision.
  turns: number;
  onClose: () => void;
  // As in the chat's header: not while a turn runs.
  canPublish: boolean;
  onPublish: () => void;
}) => {
  const insets = useSafeAreaInsets();
  const [restarts, setRestarts] = useState(0);

  return (
    <Animated.View
      entering={SlideInDown}
      exiting={SlideOutDown}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: COLORS.night,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <View className="flex-row items-center gap-1 px-2 pb-2 pt-3">
        <Button size="sm" variant="ghost" onPress={onClose}>
          <ChevronLeft color={COLORS.paper} size={20} />
          <Text>{t.drafts.back}</Text>
        </Button>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          className="flex-1 text-center font-strong text-base"
        >
          {draftTitle(draft)}
        </Text>
        <Button
          size="sm"
          variant="ghost"
          onPress={() => setRestarts((n) => n + 1)}
        >
          <RotateCcw color={COLORS.paper} size={18} />
          <Text>{t.play.restart}</Text>
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={!canPublish}
          onPress={onPublish}
        >
          <Text>{t.common.publish}</Text>
        </Button>
      </View>
      <DraftGame draft={draft} turns={turns} restarts={restarts} />
    </Animated.View>
  );
};
