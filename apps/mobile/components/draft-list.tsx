// The Draft list (#119, #149), pushed over the chat from its header's Drafts button: New game on top, then the
// Creator's Drafts, newest first. A row opens its chat; swiping it left asks to Delete it.
import { useAuth } from "@clerk/expo";
import { MAX_DRAFTS } from "@hopon/schemas";
import type { DraftSummary } from "@hopon/schemas";
import { ChevronLeft, Plus } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { SlideInRight, SlideOutRight } from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { ago } from "@/lib/draft-list";
import { COLORS } from "@/lib/theme";
import { cn } from "@/lib/utils";

// How far a row slides left to show Delete.
const DELETE_WIDTH = 96;

// A horizontal ScrollView that snaps open is the swipe: no gesture library needed.
const DraftRow = ({
  draft,
  width,
  onOpen,
  onDelete,
}: {
  draft: DraftSummary;
  width: number;
  onOpen: () => void;
  // Resolves false when the Delete failed.
  onDelete: () => Promise<boolean>;
}) => {
  const swipe = useRef<ScrollView>(null);
  // The drag's end and the snap's end can both ask.
  const asking = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const title = draft.title ?? "New game";

  const close = () => {
    asking.current = false;
    swipe.current?.scrollTo({ x: 0 });
  };
  const confirm = () => {
    if (asking.current) {
      return;
    }
    asking.current = true;
    Alert.alert(`Delete '${title}'?`, "Its chat goes too.", [
      { onPress: close, style: "cancel", text: "Cancel" },
      {
        onPress: async () => {
          setDeleting(true);
          // A deleted row unmounts; a failed one slides back.
          if (!(await onDelete())) {
            setDeleting(false);
            close();
          }
        },
        style: "destructive",
        text: "Delete",
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
        accessibilityLabel={`${title}, ${ago(draft.updatedAt)}`}
        accessibilityActions={[{ label: "Delete", name: "delete" }]}
        onAccessibilityAction={confirm}
        disabled={deleting}
        onPress={onOpen}
        style={{ width }}
        className={cn(
          "flex-row items-center gap-3 px-5 py-4 active:bg-card",
          deleting && "opacity-50"
        )}
      >
        <Text numberOfLines={1} className="flex-1 font-strong text-base">
          {title}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {ago(draft.updatedAt)}
        </Text>
      </Pressable>
      <Pressable
        accessible={false}
        disabled={deleting}
        onPress={confirm}
        style={{ width: DELETE_WIDTH }}
        className="items-center justify-center bg-destructive"
      >
        <Text className="font-strong text-sm">
          {deleting ? "Deleting…" : "Delete"}
        </Text>
      </Pressable>
    </ScrollView>
  );
};

export const DraftList = ({
  openId,
  onOpen,
  onClose,
}: {
  // The Draft whose chat is open, if it has one yet.
  openId: string | undefined;
  // Switches the chat underneath to a Draft, or to a new chat (null); the list stays.
  onOpen: (draft: DraftSummary | null) => void;
  onClose: () => void;
}) => {
  const { getToken } = useAuth();
  const [drafts, setDrafts] = useState<DraftSummary[]>();
  const [error, setError] = useState("");
  // Rows are as wide as the list, with Delete just past the edge; a sheet on iPad is narrower than the window.
  const [width, setWidth] = useState(0);
  const loaded = useRef(false);

  // Once per opening. Clerk's getToken changes on every render.
  useEffect(() => {
    if (loaded.current) {
      return;
    }
    loaded.current = true;
    const load = async () => {
      try {
        const list = await api<{ drafts: DraftSummary[] }>("/api/drafts", {
          token: await getToken(),
        });
        setDrafts(list.drafts);
      } catch (loadError) {
        setDrafts([]);
        setError((loadError as Error).message);
      }
    };
    load();
  });

  const remove = async (draft: DraftSummary) => {
    setError("");
    try {
      await api(`/api/drafts/${draft.id}`, {
        method: "DELETE",
        token: await getToken(),
      });
    } catch (deleteError) {
      setError((deleteError as Error).message);
      return false;
    }
    setDrafts((list) => list?.filter((d) => d.id !== draft.id));
    // The open Draft is gone: the chat underneath becomes the next most recent one, as + would open.
    if (draft.id === openId) {
      onOpen(drafts?.find((d) => d.id !== draft.id) ?? null);
    }
    return true;
  };

  const full = (drafts?.length ?? 0) >= MAX_DRAFTS;

  return (
    <Animated.View
      entering={SlideInRight}
      exiting={SlideOutRight}
      style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.night }]}
    >
      <View className="flex-row items-center gap-1 px-2 pb-2 pt-3">
        <Button
          size="icon"
          variant="ghost"
          accessibilityLabel="Back to chat"
          onPress={onClose}
        >
          <ChevronLeft color={COLORS.paper} size={24} />
        </Button>
        <Text
          accessibilityRole="header"
          className="flex-1 text-center font-strong text-base"
        >
          Drafts
        </Text>
        {/* Balances the back button, so the title sits in the middle. */}
        <View className="h-10 w-10" />
      </View>
      <ScrollView
        contentContainerClassName="pb-8"
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      >
        <View className="gap-2 px-5 pb-3 pt-2">
          <Button
            variant="outline"
            className="rounded-full bg-transparent"
            disabled={full}
            onPress={() => {
              onOpen(null);
              onClose();
            }}
          >
            <Plus color={COLORS.paper} size={18} />
            <Text>New game</Text>
          </Button>
          {full && (
            <Text className="text-center text-sm text-muted-foreground">
              Delete a Draft to start a new one
            </Text>
          )}
          {!!error && (
            <Text
              accessibilityRole="alert"
              className="text-center text-sm text-destructive"
            >
              {error}
            </Text>
          )}
        </View>
        {drafts === undefined && (
          <Text className="px-5 text-muted-foreground">Loading…</Text>
        )}
        {drafts?.map((draft) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            width={width}
            onOpen={() => {
              onOpen(draft);
              onClose();
            }}
            onDelete={() => remove(draft)}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
};
