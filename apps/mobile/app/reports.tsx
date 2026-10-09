import { useAuth } from "@clerk/expo";
import { REPORT_REASONS } from "@hopon/schemas";
import type { ReportQueue, ReportTarget } from "@hopon/schemas";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameView } from "@/components/game-view";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api, gameUrl } from "@/lib/api";

const key = (target: ReportTarget) => `${target.kind}:${target.id}`;

// SQLite's CURRENT_TIMESTAMP is UTC without a zone.
const when = (timestamp: string) =>
  new Date(`${timestamp.replace(" ", "T")}Z`).toLocaleString();

// The Operator's queue: one card per reported game or comment, oldest open report first, each with Delete, Ban and Dismiss.
// The API is the gate; Me only links here for the Operator.
const Reports = () => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [targets, setTargets] = useState<ReportTarget[] | null>(null);
  const [error, setError] = useState("");
  // One action at a time: every card's buttons wait while one is in flight.
  const [acting, setActing] = useState(false);
  const [playing, setPlaying] = useState<ReportTarget | null>(null);
  // Clerk's getToken isn't referentially stable, so `load` reads it through a ref instead of its deps.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  });

  // Bumped by each load, so a queue that lands after a newer load (focus, or after an action) is dropped.
  const generation = useRef(0);

  const load = useCallback(async () => {
    generation.current += 1;
    const { current } = generation;
    setError("");
    try {
      const queue = await api<ReportQueue>("/api/reports", {
        token: await token.current(),
      });
      if (current === generation.current) {
        setTargets(queue.targets);
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

  // Reloads afterwards: deleting a game also closes the reports on its comments, and a Ban those on all their content.
  const act = async (
    target: ReportTarget,
    action: "ban" | "delete" | "dismiss"
  ) => {
    const path = `/api/${target.kind}s/${target.id}`;
    setActing(true);
    setError("");
    try {
      await api(action === "delete" ? path : `${path}/${action}`, {
        method: action === "delete" ? "DELETE" : "POST",
        token: await getToken(),
      });
      await load();
    } catch (actError) {
      setError((actError as Error).message);
    }
    setActing(false);
  };

  const confirmDelete = (target: ReportTarget) =>
    Alert.alert(
      target.kind === "game" ? "Delete game?" : "Delete comment?",
      target.kind === "game"
        ? "It's gone for everyone, with its likes, comments and saves."
        : "It's gone for everyone.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => act(target, "delete"),
          style: "destructive",
          text: "Delete",
        },
      ]
    );

  const confirmBan = (target: ReportTarget) =>
    Alert.alert(
      `Ban @${target.handle ?? "this person"}?`,
      "They can't sign in again, and all their published games and comments are deleted for everyone.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => act(target, "ban"),
          style: "destructive",
          text: "Ban",
        },
      ]
    );

  const card = ({ item }: { item: ReportTarget }) => (
    <View className="gap-2 rounded-2xl bg-card p-4">
      <Text className="text-sm text-muted-foreground">
        {item.kind === "game" ? "Game" : `Comment on game ${item.gameId}`} · @
        {item.handle ?? "?"} · {when(item.reportedAt)}
      </Text>
      {!!item.title && (
        <Text className="font-strong text-lg">{item.title}</Text>
      )}
      <Text className="text-base">{item.description ?? item.body}</Text>
      {!item.live && (
        <Text className="font-strong text-destructive">Content deleted</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {item.reasons.map(({ reason, count }) => (
          <Text
            key={reason}
            className="rounded-full bg-background px-3 py-1 text-sm"
          >
            {REPORT_REASONS.find((r) => r.reason === reason)?.label} × {count}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2 pt-1">
        {item.live && item.kind === "game" && (
          <Button
            variant="outline"
            className="rounded-full bg-transparent"
            onPress={() => setPlaying(item)}
          >
            <Text>Play</Text>
          </Button>
        )}
        {item.live && (
          <Button
            variant="destructive"
            className="rounded-full"
            disabled={acting}
            onPress={() => confirmDelete(item)}
          >
            <Text>Delete</Text>
          </Button>
        )}
        <Button
          variant="destructive"
          className="rounded-full"
          disabled={acting}
          onPress={() => confirmBan(item)}
        >
          <Text>Ban</Text>
        </Button>
        <Button
          variant="ghost"
          className="rounded-full"
          disabled={acting}
          onPress={() => act(item, "dismiss")}
        >
          <Text>Dismiss</Text>
        </Button>
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={targets ?? []}
        keyExtractor={key}
        renderItem={card}
        contentContainerClassName="gap-4 px-3 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          error ? (
            <View className="items-start gap-3 px-2">
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
              <Button variant="outline" className="rounded-full" onPress={load}>
                <Text>Try again</Text>
              </Button>
            </View>
          ) : null
        }
        ListEmptyComponent={
          targets && !error ? (
            <Text className="px-2 text-base text-muted-foreground">
              No open reports.
            </Text>
          ) : null
        }
      />
      <Modal
        visible={!!playing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPlaying(null)}
      >
        <View className="flex-1 bg-background">
          <View className="flex-row items-center justify-between gap-3 px-5 py-3">
            <Text className="flex-1 font-strong text-lg" numberOfLines={1}>
              {playing?.title}
            </Text>
            <Button
              variant="ghost"
              className="rounded-full"
              onPress={() => setPlaying(null)}
            >
              <Text>Done</Text>
            </Button>
          </View>
          {playing && (
            <GameView
              uri={gameUrl(playing.gameId)}
              title={playing.title ?? ""}
            />
          )}
        </View>
      </Modal>
    </View>
  );
};

export default Reports;
