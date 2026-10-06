import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Feed } from "@/components/Feed";

// Your saved games from the one you tapped (`from`, its save id) onward to older saves; the stack header goes back.
export default function SavedFeed() {
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from: string }>();
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingBottom: insets.bottom }}
    >
      <Feed
        path="/api/saves"
        start={Number(from) + 1}
        empty="This game is no longer in your saved games."
      />
    </View>
  );
}
