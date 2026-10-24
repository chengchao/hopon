import { useAuth, useUser } from "@clerk/expo";
import type { DraftSummary } from "@hopon/schemas";
import { router } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api, HANDLE_REJECTED, handleRejected } from "@/lib/api";
import { draftTitle } from "@/lib/draft-list";

// Publish's confirm sheet (#119, #150): the Maker's title and description, which the Creator changes by asking the
// Maker. Publish runs today's flow: the handle first, then Screening on the server, then Discover. A refusal keeps the
// Draft and says why here.
export const PublishSheet = ({
  draft,
  open,
  onClose,
}: {
  draft: DraftSummary | null | undefined;
  open: boolean;
  onClose: () => void;
}) => {
  const { getToken } = useAuth();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setError("");
    onClose();
  };
  // The sheet is a Modal, so it closes before another screen opens: it would stay on top of it.
  const leave = (path: "/handle" | typeof HANDLE_REJECTED) => {
    close();
    router.push(path);
  };

  const publish = async () => {
    if (!draft || publishing) {
      return;
    }
    // Published games show their maker, so the Creator picks a handle first; this chat is still here afterwards.
    if (!user?.username) {
      return leave("/handle");
    }
    setPublishing(true);
    setError("");
    try {
      const game = await api<{ id: number }>(
        `/api/drafts/${draft.id}/publish`,
        { method: "POST", token: await getToken({ skipCache: true }) }
      );
      router.dismissTo({
        params: { published: String(game.id) },
        pathname: "/",
      });
    } catch (publishError) {
      if (handleRejected(publishError)) {
        leave(HANDLE_REJECTED);
      } else {
        setError((publishError as Error).message);
      }
    }
    setPublishing(false);
  };

  return (
    <Modal
      visible={open && !!draft}
      transparent
      animationType="slide"
      onRequestClose={publishing ? undefined : close}
    >
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/40"
          accessibilityLabel="Cancel"
          disabled={publishing}
          onPress={close}
        />
        <View
          className="gap-3 rounded-t-3xl bg-card px-5 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-border" />
          <Text
            accessibilityRole="header"
            className="font-display text-[32px] leading-[36px]"
          >
            {`Publish '${draftTitle(draft)}'?`}
          </Text>
          {!!draft?.description && (
            <Text className="text-base leading-[22px]">
              {draft.description}
            </Text>
          )}
          <Text className="text-base leading-[22px] text-muted-foreground">
            The chat ends and the game goes to the feed. To change the title,
            ask the Maker.
          </Text>
          {!!error && (
            <Text
              accessibilityRole="alert"
              className="text-center text-sm text-destructive"
            >
              {error}
            </Text>
          )}
          <Button
            className="h-12 rounded-full"
            disabled={publishing}
            onPress={() => publish()}
          >
            <Text>{publishing ? "Publishing…" : "Publish"}</Text>
          </Button>
          <Button variant="ghost" disabled={publishing} onPress={close}>
            <Text>Cancel</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
};
