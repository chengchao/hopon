import { useAuth, useUser } from "@clerk/expo";
import type { BlockedAccounts } from "@hopon/schemas";
import { router, useFocusEffect } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { contactUs, openRules } from "@/lib/rules";
import { COLORS } from "@/lib/theme";

// A count on Me. With `onPress` it is also the way to what it counts, and shows a chevron.
const Stat = ({
  value,
  label,
  hint,
  onPress,
}: {
  value: number | string;
  label: string;
  hint?: string;
  onPress?: () => void;
}) => (
  <Pressable
    accessibilityRole={onPress ? "button" : undefined}
    accessibilityLabel={`${label}, ${value}`}
    accessibilityHint={hint}
    disabled={!onPress}
    onPress={onPress}
    className="flex-1 rounded-2xl bg-card px-4 py-3 active:opacity-80"
  >
    <Text className="font-display text-[36px] leading-[40px]">{value}</Text>
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      {onPress && <ChevronRight color={COLORS.mist} size={18} />}
    </View>
  </Pressable>
);

const Me = () => {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { user } = useUser();
  const [error, setError] = useState("");
  const [liked, setLiked] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<number | null>(null);

  // Clerk's getToken isn't referentially stable, so the focus effect reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });

  // Refetched whenever Me comes into view, so likes, saves and blocks made elsewhere show up.
  useFocusEffect(
    useCallback(() => {
      if (!isSignedIn) {
        return;
      }
      const fetchInto = async <T,>(path: string, set: (data: T) => void) => {
        try {
          set(await api<T>(path, { token: await token.current() }));
        } catch {
          // Keep the last count; a count isn't worth an error banner.
        }
      };
      const fetchCount = (path: string, set: (count: number) => void) =>
        fetchInto<{ count: number }>(path, ({ count }) => set(count));
      fetchCount("/api/likes/count", setLiked);
      fetchCount("/api/saves/count", setSaved);
      fetchInto<BlockedAccounts>("/api/blocks", ({ blocks }) =>
        setBlocked(blocks.length)
      );
    }, [isSignedIn])
  );

  const deleteAccount = () => {
    Alert.alert(t.me.deleteTitle, t.me.deleteBody, [
      { style: "cancel", text: t.common.cancel },
      {
        onPress: async () => {
          try {
            // The Drafts go first: if that fails, the account stays and the error shows (#144).
            await api("/api/drafts", {
              method: "DELETE",
              token: await getToken(),
            });
            await user?.delete();
          } catch (deleteError) {
            setError((deleteError as Error).message);
          }
        },
        style: "destructive",
        text: t.common.delete,
      },
    ]);
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
        {t.me.title}
      </Text>
      {isLoaded &&
        (isSignedIn ? (
          <>
            <View className="gap-1">
              {user?.username ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t.me.nameHint}
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
                  <Text>{t.handle.title}</Text>
                </Button>
              )}
              <Text className="text-sm text-muted-foreground">
                {user?.primaryEmailAddress?.emailAddress}
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Stat value={liked ?? "–"} label={t.me.liked} />
              <Stat
                value={saved ?? "–"}
                label={t.me.saved}
                hint={t.me.savedHint}
                onPress={() => router.push("/saved")}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t.me.blockedHint}
              onPress={() => router.push("/blocked")}
              className="h-14 flex-row items-center justify-between rounded-2xl bg-card px-4 active:opacity-80"
            >
              <Text className="text-base">{t.blocked.title}</Text>
              <Text className="text-muted-foreground">{blocked ?? "–"}</Text>
            </Pressable>
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
                <Text>{t.me.signOut}</Text>
              </Button>
              <Button
                variant="ghost"
                className="rounded-full"
                onPress={deleteAccount}
              >
                <Text className="text-destructive">{t.me.deleteAccount}</Text>
              </Button>
            </View>
          </>
        ) : (
          <View className="gap-4">
            <Text className="text-base leading-[22px] text-muted-foreground">
              {t.me.signedOut}
            </Text>
            <Button
              className="h-12 self-start rounded-full px-6"
              onPress={() => router.push("/sign-in?next=me")}
            >
              <Text>{t.common.signIn}</Text>
            </Button>
          </View>
        ))}
      <View className="flex-row gap-4">
        <Button variant="link" className="px-0" onPress={() => contactUs()}>
          <Text className="text-muted-foreground">{t.me.contact}</Text>
        </Button>
        <Button
          variant="link"
          className="px-0"
          accessibilityHint={t.me.rulesHint}
          onPress={() => openRules()}
        >
          <Text className="text-muted-foreground">{t.me.rules}</Text>
        </Button>
      </View>
    </ScrollView>
  );
};

export default Me;
