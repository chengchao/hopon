import { useAuth } from "@clerk/expo";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Feed } from "@/components/Feed";

export default function Discover() {
  const insets = useSafeAreaInsets();
  const { published } = useLocalSearchParams<{ published?: string }>();
  const { isSignedIn } = useAuth();
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* A fresh feed, back at the top, after Create publishes a game or you sign in or out. */}
      <Feed
        key={`${published}:${isSignedIn}`}
        path="/api/games"
        empty="No games yet. Make the first one."
      />
    </View>
  );
}
