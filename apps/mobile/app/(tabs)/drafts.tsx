import { useAuth } from "@clerk/expo";
import { MAX_DRAFTS } from "@hopon/schemas";
import { router, useIsFocused } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DraftCard } from "@/components/draft-card";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { draftCard, isFull } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { COLORS } from "@/lib/theme";
import { useDrafts } from "@/lib/use-drafts";
import { useNow } from "@/lib/use-now";

// A card shows no time. Its label for a screen reader says one, which only needs to keep up.
const LABEL_MS = 30_000;

// The Creator's Drafts, newest first, as a grid of their games' covers: each one tap from its page.
const Drafts = () => {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn } = useAuth();
  const focused = useIsFocused();
  const { drafts, error, refresh, remove } = useDrafts();
  const [pulling, setPulling] = useState(false);
  const now = useNow(focused ? LABEL_MS : undefined);

  const pull = async () => {
    setPulling(true);
    await refresh();
    setPulling(false);
  };

  const header = (
    <View className="gap-2 px-5 pb-2.5 pt-4">
      <Text
        accessibilityRole="header"
        className="font-display text-[44px] leading-[48px]"
      >
        {t.drafts.title}
      </Text>
      {drafts && isFull(drafts) && (
        <Text className="text-sm text-muted-foreground">
          {t.drafts.fullHint(MAX_DRAFTS)}
        </Text>
      )}
    </View>
  );
  if (!isLoaded) {
    return <View className="flex-1 bg-background" />;
  }
  if (!isSignedIn) {
    return (
      <View
        className="flex-1 gap-4 bg-background"
        style={{ paddingTop: insets.top }}
      >
        {header}
        <Text className="px-5 text-base leading-[22px] text-muted-foreground">
          {t.drafts.signedOut}
        </Text>
        <Button
          className="mx-5 h-12 self-start rounded-full px-6"
          onPress={() => router.push("/sign-in")}
        >
          <Text>{t.common.signIn}</Text>
        </Button>
      </View>
    );
  }

  const empty = drafts ? (
    <View className="items-start gap-4 px-5 pt-0.5">
      <Text className="text-base leading-[22px] text-muted-foreground">
        {t.drafts.empty}
      </Text>
      <Button
        className="h-12 rounded-full px-6"
        onPress={() => router.push("/create")}
      >
        <Text>{t.tabs.makeGame}</Text>
      </Button>
    </View>
  ) : (
    <Text className="px-5 pt-0.5 text-muted-foreground">
      {t.common.loading}
    </Text>
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <FlatList
        data={drafts}
        keyExtractor={(draft) => draft.id}
        numColumns={2}
        columnWrapperClassName="px-1.5"
        contentContainerClassName="pb-6"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={pull}
            tintColor={COLORS.paper}
          />
        }
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <DraftCard
            card={draftCard(item, now)}
            onOpen={() =>
              router.push({ params: { id: item.id }, pathname: "/draft/[id]" })
            }
            onDelete={() => remove(item.id)}
          />
        )}
        // With an error and nothing listed, the footer says why.
        ListEmptyComponent={error ? null : empty}
        ListFooterComponent={
          error ? (
            <View className="items-start gap-3 px-5 pt-2">
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
              <Button
                variant="outline"
                className="rounded-full"
                onPress={() => refresh()}
              >
                <Text>{t.common.tryAgain}</Text>
              </Button>
            </View>
          ) : null
        }
      />
    </View>
  );
};

export default Drafts;
