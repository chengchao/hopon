import { useAuth } from "@clerk/expo";
import type { BlockedAccount, BlockedAccounts } from "@hopon/schemas";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";

// Everyone the viewer has Blocked, by the handle they had then, each with Unblock. Opened from Me.
const Blocked = () => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [blocks, setBlocks] = useState<BlockedAccount[] | null>(null);
  const [error, setError] = useState("");
  const [unblocking, setUnblocking] = useState<number | null>(null);
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });

  // Bumped by each load and each Unblock, so a list that lands after either is dropped.
  const generation = useRef(0);

  const load = useCallback(async () => {
    generation.current += 1;
    const { current } = generation;
    setError("");
    try {
      const list = await api<BlockedAccounts>("/api/blocks", {
        token: await token.current(),
      });
      if (current === generation.current) {
        setBlocks(list.blocks);
      }
    } catch (loadError) {
      if (current === generation.current) {
        setError((loadError as Error).message);
      }
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const unblock = async (block: BlockedAccount) => {
    setUnblocking(block.id);
    setError("");
    try {
      await api(`/api/blocks/${block.id}`, {
        method: "DELETE",
        token: await token.current(),
      });
      generation.current += 1;
      setBlocks((current) => current?.filter((b) => b.id !== block.id) ?? null);
    } catch (unblockError) {
      setError((unblockError as Error).message);
    }
    setUnblocking(null);
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between gap-3 px-5 pb-2 pt-5">
        <Text
          accessibilityRole="header"
          className="font-display text-[36px] leading-[40px]"
        >
          Blocked accounts
        </Text>
        <Button
          variant="ghost"
          className="rounded-full"
          onPress={() => router.back()}
        >
          <Text>Done</Text>
        </Button>
      </View>
      <FlatList
        data={blocks ?? []}
        keyExtractor={(block) => String(block.id)}
        contentContainerClassName="gap-3 px-5 pt-2"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          error ? (
            <View className="items-start gap-3 pb-2">
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
              {!blocks && (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onPress={load}
                >
                  <Text>Try again</Text>
                </Button>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          blocks ? (
            <Text className="text-base text-muted-foreground">
              You haven&apos;t blocked anyone.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const handle = `@${item.handle ?? "?"}`;
          return (
            <View className="h-14 flex-row items-center justify-between rounded-2xl bg-card pl-4 pr-2">
              <Text className="flex-1 text-base" numberOfLines={1}>
                {handle}
              </Text>
              <Button
                variant="outline"
                className="rounded-full bg-transparent"
                accessibilityLabel={`Unblock ${handle}`}
                disabled={unblocking !== null}
                onPress={() => unblock(item)}
              >
                <Text>Unblock</Text>
              </Button>
            </View>
          );
        }}
      />
    </View>
  );
};

export default Blocked;
