import { useAuth, useUser } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { openRules, RULES_VERSION } from "@/lib/rules";

const SUMMARY = [
  "Zero tolerance for objectionable games, comments or names, and for abusive people.",
  "Nothing unsuitable for ages 13+, hateful or harassing, spam or scams.",
  "Report or Block anything or anyone that breaks the Rules. We review reports within 24 hours, delete what breaks them and ban whoever posted it.",
];

// Right after sign-in (`next`: on to the handle step), or on open when the stored version isn't the current one.
const Rules = () => {
  const { next } = useLocalSearchParams<{ next?: "create" | "handle" }>();
  const { signOut } = useAuth();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const agreed = user?.unsafeMetadata.rulesAgreed === RULES_VERSION;

  const done = useCallback(() => {
    if (!next) {
      router.back();
      return;
    }
    router.replace(
      next === "create" ? "/handle?next=create&auto=1" : "/handle?auto=1"
    );
  }, [next]);
  // Moves on once the current version is stored: after I agree, or at once if this account already agreed.
  useEffect(() => {
    if (agreed) {
      done();
    }
  }, [agreed, done]);

  const agree = async () => {
    if (!user || saving) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      // `update` replaces unsafeMetadata whole, so keep whatever else is in it.
      await user.update({
        unsafeMetadata: { ...user.unsafeMetadata, rulesAgreed: RULES_VERSION },
      });
    } catch (agreeError) {
      setError(
        (agreeError as Error).message || "Could not save. Please try again."
      );
      setSaving(false);
    }
  };

  const decline = async () => {
    await signOut();
    router.back();
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-6"
      contentContainerStyle={{
        paddingBottom: insets.bottom + 24,
        paddingTop: 80,
      }}
    >
      <View className="gap-2">
        <Text
          accessibilityRole="header"
          className="font-display text-[52px] leading-[52px]"
        >
          The Rules
        </Text>
        <Text className="text-base leading-[22px] text-muted-foreground">
          Everyone on hopon agrees to them before doing anything signed in.
        </Text>
      </View>
      <View className="gap-3 rounded-2xl bg-card p-4">
        {SUMMARY.map((line) => (
          <Text key={line} className="text-base leading-[22px]">
            {line}
          </Text>
        ))}
      </View>
      <Button
        variant="link"
        className="self-start px-0"
        accessibilityHint="Opens the full Terms of Use"
        onPress={() => openRules()}
      >
        <Text>Read the Terms of Use</Text>
      </Button>
      {!!error && (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
      <Button
        className="h-12 rounded-full"
        disabled={!user || saving}
        onPress={() => agree()}
      >
        <Text>{saving ? "Saving…" : "I agree"}</Text>
      </Button>
      <Button
        variant="ghost"
        accessibilityHint="Signs you out"
        onPress={() => decline()}
      >
        <Text>I don&apos;t agree</Text>
      </Button>
    </ScrollView>
  );
};

export default Rules;
