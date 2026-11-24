import { useAuth, useUser } from "@clerk/expo";
import { GAME_DESCRIPTION_MAX } from "@hopon/schemas";
import type { Caption, DraftSummary } from "@hopon/schemas";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { api, HANDLE_REJECTED, handleRejected } from "@/lib/api";
import { dropCaption, keepCaption, keptCaption } from "@/lib/draft-caption";
import { draftTitle } from "@/lib/drafts";
import { t } from "@/lib/i18n";

// Publish's confirm sheet (#119, #150): the Maker's title, which the Creator changes by asking the Maker, and the
// Caption, which is the Creator's: they type one, ask for one to be written, or leave it empty. Nothing is written
// unless they ask, since it costs them hopon tokens. It can't be changed after Publish. Publish runs the handle first,
// then Screening on the server, then Discover. A refusal keeps the Draft and says why here.
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
  const [busy, setBusy] = useState<"idle" | "suggesting" | "publishing">(
    "idle"
  );
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  // The Draft the sheet is open for. Each opening starts from the Caption kept for it, or empty.
  const shown = open && draft ? draft : null;
  const opening = shown && shown.id;
  const [startedFor, setStartedFor] = useState<string | null>(null);
  if (opening !== startedFor) {
    setStartedFor(opening);
    setCaption((shown && keptCaption(shown.id)) ?? "");
    setBusy("idle");
    setError("");
  }
  // Counts requests for a Caption and closings, so an answer that arrives after the sheet closed is dropped.
  const asked = useRef(0);
  const publishing = busy === "publishing";

  const close = () => {
    asked.current += 1;
    onClose();
  };
  // The sheet is a Modal, so it closes before another screen opens: it would stay on top of it.
  const leave = (path: "/handle" | typeof HANDLE_REJECTED) => {
    close();
    router.push(path);
  };

  const write = async () => {
    if (!shown || busy !== "idle") {
      return;
    }
    asked.current += 1;
    const request = asked.current;
    setBusy("suggesting");
    setError("");
    try {
      const written = await api<Caption>(`/api/drafts/${shown.id}/caption`, {
        body: caption ? { current: caption } : {},
        token: await getToken(),
      });
      if (asked.current === request) {
        setCaption(written.caption);
        keepCaption(shown.id, written.caption);
      }
    } catch (writeError) {
      if (asked.current === request) {
        setError((writeError as Error).message);
      }
    }
    if (asked.current === request) {
      setBusy("idle");
    }
  };

  const edit = (text: string) => {
    if (!shown) {
      return;
    }
    const next = text.replaceAll("\n", " ");
    setCaption(next);
    keepCaption(shown.id, next);
  };

  const publish = async () => {
    if (!draft || busy !== "idle") {
      return;
    }
    // Published games show their maker, so the Creator picks a handle first; this chat is still here afterwards.
    if (!user?.username) {
      return leave("/handle");
    }
    setBusy("publishing");
    setError("");
    try {
      const game = await api<{ id: number }>(
        `/api/drafts/${draft.id}/publish`,
        { body: { caption }, token: await getToken({ skipCache: true }) }
      );
      dropCaption(draft.id);
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
    setBusy("idle");
  };

  const writeLabel = caption ? t.publish.another : t.publish.writeForMe;

  return (
    <Modal
      visible={open && !!draft}
      transparent
      animationType="slide"
      onRequestClose={publishing ? undefined : close}
    >
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/40"
          accessibilityLabel={t.common.cancel}
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
            {t.publish.title(draftTitle(draft))}
          </Text>
          <View className="gap-1">
            <View className="flex-row items-center justify-between">
              <Text className="font-strong text-sm">{t.publish.caption}</Text>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={busy !== "idle"}
                onPress={write}
              >
                <Text>
                  {busy === "suggesting" ? t.publish.writing : writeLabel}
                </Text>
              </Button>
            </View>
            {/* It wraps, so a long Caption shows whole, but stays one line of text: Return ends the edit. */}
            <Input
              value={caption}
              onChangeText={edit}
              editable={busy === "idle"}
              maxLength={GAME_DESCRIPTION_MAX}
              placeholder={
                busy === "suggesting"
                  ? t.publish.writing
                  : t.publish.captionPlaceholder
              }
              accessibilityLabel={t.publish.caption}
              multiline
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              className="h-auto max-h-28 min-h-12 rounded-3xl border-0 bg-background px-4 py-3"
            />
          </View>
          <Text className="text-base leading-[22px] text-muted-foreground">
            {t.publish.body}
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
            disabled={busy !== "idle"}
            onPress={() => publish()}
          >
            <Text>{publishing ? t.publish.publishing : t.common.publish}</Text>
          </Button>
          <Button variant="ghost" disabled={publishing} onPress={close}>
            <Text>{t.common.cancel}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};
