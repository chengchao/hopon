// A Draft's card in the Drafts tab's grid: the game's cover, portrait like the game, with no words. A spinner says the
// Maker is working, and a Draft with no game is a blank. Tapping it opens the Draft's page; a long press asks to
// Delete it.
import { CircleDashed } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import type { DraftCardView } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { COLORS } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Fades in once it has loaded, so a build's first cover doesn't pop onto the blank.
const Cover = ({ uri }: { uri: string }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <Animated.Image
      accessibilityIgnoresInvertColors
      source={{ uri }}
      resizeMode="cover"
      onLoad={() => setLoaded(true)}
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: loaded ? 1 : 0,
          transitionDuration: 200,
          transitionProperty: "opacity",
        },
      ]}
    />
  );
};

export const DraftCard = ({
  card,
  onOpen,
  onDelete,
}: {
  card: DraftCardView;
  onOpen: () => void;
  // Resolves false when the Delete failed.
  onDelete: () => Promise<boolean>;
}) => {
  const [deleting, setDeleting] = useState(false);
  const working = card.status === "making" || card.status === "updating";

  const confirm = () =>
    Alert.alert(t.drafts.deleteTitle(card.title), t.drafts.deleteBody, [
      { style: "cancel", text: t.common.cancel },
      {
        onPress: async () => {
          setDeleting(true);
          // A deleted card unmounts.
          if (!(await onDelete())) {
            setDeleting(false);
          }
        },
        style: "destructive",
        text: t.common.delete,
      },
    ]);

  return (
    // Half the row each, so the last card of an odd count keeps its size.
    <View className="w-1/2 p-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={card.label}
        accessibilityHint={t.drafts.openHint}
        accessibilityActions={[{ label: t.common.delete, name: "delete" }]}
        onAccessibilityAction={confirm}
        disabled={deleting}
        onPress={onOpen}
        onLongPress={confirm}
        // 9:16, the playtest's 360×640, so the cover fills the card uncropped.
        className={cn(
          "aspect-[9/16] items-center justify-center gap-3 overflow-hidden rounded-3xl bg-card p-3 active:opacity-80",
          card.status === "unmade" && "border border-dashed border-border",
          deleting && "opacity-50"
        )}
      >
        {card.cover ? <Cover uri={card.cover} /> : null}
        {card.cover && working ? (
          <View style={StyleSheet.absoluteFill} className="bg-black/50" />
        ) : null}
        {working && <ActivityIndicator color={COLORS.paper} />}
        {card.status === "unmade" && (
          <CircleDashed color={COLORS.mist} size={28} />
        )}
        {card.caption ? (
          <Text
            numberOfLines={3}
            className="text-center font-display text-2xl leading-8"
          >
            {card.caption}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
};
