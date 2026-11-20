import { useUser } from "@clerk/expo";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { AI_VERSION, openMakerPrivacy } from "@/lib/rules";

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
      setError((agreeError as Error).message || t.common.couldNotSave);
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
          accessibilityLabel={t.common.notNow}
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
            {t.ai.title}
          </Text>
          <Text className="text-base leading-[22px]">{t.ai.intro}</Text>
          <View className="gap-1 pl-1">
            {t.ai.sent.map((line) => (
              <Text key={line} className="text-base leading-[22px]">
                {`•  ${line}`}
              </Text>
            ))}
          </View>
          <Text className="text-base leading-[22px] text-muted-foreground">
            {t.ai.notSent}
          </Text>
          <Button
            variant="link"
            className="self-start px-0"
            accessibilityHint={t.ai.privacyHint}
            onPress={() => openMakerPrivacy()}
          >
            <Text>{t.ai.whoProcesses}</Text>
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
            <Text>{saving ? t.common.saving : t.ai.agree}</Text>
          </Button>
          <Button variant="ghost" disabled={saving} onPress={onClose}>
            <Text>{t.common.notNow}</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
};
