import { useUser } from "@clerk/expo";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { AI_VERSION, openMakerPrivacy } from "@/lib/rules";

// #125's copy. Provider-neutral: /privacy#maker names the companies.
const SENT = [
  "your messages to the Maker",
  "the game it makes from them: its code and pictures of it being played",
];

// The Maker's AI disclosure, on a Send by a Creator who hasn't agreed to the current AI_VERSION. Agree stores it and
// hands the message back to be sent; Not now closes, and nothing leaves the phone.
export const AiSheet = ({
  message,
  onAgreed,
  onClose,
}: {
  /** The message waiting to be sent; the sheet shows while it's set. */
  message?: string;
  onAgreed: (message: string) => void;
  onClose: () => void;
}) => {
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const agree = async () => {
    if (!user || message === undefined || saving) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      // `update` replaces unsafeMetadata whole, so keep the Rules and whatever else is in it.
      await user.update({
        unsafeMetadata: { ...user.unsafeMetadata, aiAgreed: AI_VERSION },
      });
      onAgreed(message);
    } catch (agreeError) {
      setError(
        (agreeError as Error).message || "Could not save. Please try again."
      );
    }
    setSaving(false);
  };

  return (
    <Modal
      visible={message !== undefined}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/40"
          accessibilityLabel="Not now"
          onPress={onClose}
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
            Before the Maker starts
          </Text>
          <Text className="text-base leading-[22px]">
            The Maker runs on an AI service from another company. To make your
            game, it sends that company:
          </Text>
          <View className="gap-1 pl-1">
            {SENT.map((line) => (
              <Text key={line} className="text-base leading-[22px]">
                {`•  ${line}`}
              </Text>
            ))}
          </View>
          <Text className="text-base leading-[22px] text-muted-foreground">
            Not your email or your account. Don&apos;t put personal information
            in your messages. The company doesn&apos;t use any of it to train
            its AI.
          </Text>
          <Button
            variant="link"
            className="self-start px-0"
            accessibilityHint="Opens the privacy policy"
            onPress={() => openMakerPrivacy()}
          >
            <Text>Who processes it</Text>
          </Button>
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
            disabled={!user || saving}
            onPress={() => agree()}
          >
            <Text>{saving ? "Saving…" : "Agree and send"}</Text>
          </Button>
          <Button variant="ghost" disabled={saving} onPress={onClose}>
            <Text>Not now</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
};
