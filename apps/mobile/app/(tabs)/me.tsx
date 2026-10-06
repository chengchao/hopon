import { useAuth, useUser } from "@clerk/expo";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";

const Stat = ({ value, label }: { value: number | string; label: string }) => (
  <View className="flex-1 rounded-2xl bg-card px-4 py-3">
    <Text className="font-display text-[36px] leading-[40px]">{value}</Text>
    <Text className="text-sm text-muted-foreground">{label}</Text>
  </View>
);

const Me = () => {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { user } = useUser();
  const [error, setError] = useState("");
  const [liked, setLiked] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  // Clerk's getToken isn't referentially stable, so the focus effect reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });

  // Refetched whenever Me comes into view, so likes and saves made on Discover show up.
  useFocusEffect(
    useCallback(() => {
      if (!isSignedIn) {
        return;
      }
      const fetchCount = async (path: string, set: (count: number) => void) => {
        try {
          const { count } = await api<{ count: number }>(path, {
            token: await token.current(),
          });
          set(count);
        } catch {
          // Keep the last count; the stat isn't worth an error banner.
        }
      };
      fetchCount("/api/likes/count", setLiked);
      fetchCount("/api/saves/count", setSaved);
    }, [isSignedIn])
  );

  const deleteAccount = () => {
    Alert.alert(
      "Delete your account?",
      "You will be signed out and your account removed. Published games stay public.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: async () => {
            try {
              await user?.delete();
            } catch (deleteError) {
              setError((deleteError as Error).message);
            }
          },
          style: "destructive",
          text: "Delete",
        },
      ]
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5"
      contentContainerStyle={{ paddingBottom: 24, paddingTop: insets.top + 16 }}
    >
      <Text
        accessibilityRole="header"
        className="font-display text-[44px] leading-[48px]"
      >
        Me
      </Text>
      {isLoaded &&
        (isSignedIn ? (
          <>
            <View className="gap-1">
              {user?.username ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Change your name"
                  onPress={() => router.push("/handle")}
                >
                  <Text className="font-strong text-2xl text-primary">
                    @{user.username}
                  </Text>
                </Pressable>
              ) : (
                <Button
                  className="h-11 self-start rounded-full px-5"
                  onPress={() => router.push("/handle")}
                >
                  <Text>Pick your name</Text>
                </Button>
              )}
              <Text className="text-sm text-muted-foreground">
                {user?.primaryEmailAddress?.emailAddress}
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Stat value={liked ?? "–"} label="Liked" />
              <Stat value={saved ?? "–"} label="Saved" />
            </View>
            {!!error && (
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
            )}
            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="rounded-full bg-transparent"
                onPress={() => signOut()}
              >
                <Text>Sign out</Text>
              </Button>
              <Button
                variant="ghost"
                className="rounded-full"
                onPress={deleteAccount}
              >
                <Text className="text-destructive">Delete account</Text>
              </Button>
            </View>
          </>
        ) : (
          <View className="gap-4">
            <Text className="text-base leading-[22px] text-muted-foreground">
              Sign in to make games and keep the ones you like.
            </Text>
            <Button
              className="h-12 self-start rounded-full px-6"
              onPress={() => router.push("/sign-in?next=me")}
            >
              <Text>Sign in</Text>
            </Button>
          </View>
        ))}
    </ScrollView>
  );
};

export default Me;
