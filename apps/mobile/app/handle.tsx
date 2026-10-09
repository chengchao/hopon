import { useUser } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// Clerk usernames: at least 4 characters, not only digits. We keep them simple and lowercase.
const HANDLE = /^(?=.*[a-z_])[a-z0-9_]{4,20}$/u;

// Shown once after the first sign-in (and before publishing): the @handle that appears on your games.
const Handle = () => {
  // `auto`: opened right after sign-in, so skip straight on if a handle already exists.
  // `rejected`: Screening refused the current one.
  const { next, auto, rejected } = useLocalSearchParams<{
    next?: "create";
    auto?: "1";
    rejected?: "1";
  }>();
  const { user } = useUser();
  const [name, setName] = useState(user?.username ?? "");
  const [error, setError] = useState(
    rejected ? "Your name breaks hopon's rules. Pick a different one." : ""
  );
  const [saving, setSaving] = useState(false);

  const done = useCallback(
    () => (next === "create" ? router.replace("/create") : router.back()),
    [next]
  );
  useEffect(() => {
    if (auto && user?.username) {
      done();
    }
  }, [auto, user?.username, done]);

  const save = async () => {
    if (!user || !HANDLE.test(name) || saving) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await user.update({ username: name });
      done();
    } catch (saveError) {
      const clerk = saveError as {
        errors?: { longMessage?: string; message?: string }[];
        message?: string;
      };
      setError(
        clerk.errors?.[0]?.longMessage ??
          clerk.errors?.[0]?.message ??
          clerk.message ??
          "Could not save that name."
      );
    }
    setSaving(false);
  };

  return (
    <View className="flex-1 gap-5 bg-background px-6 pt-20">
      <View className="gap-2">
        <Text
          accessibilityRole="header"
          className="font-display text-[52px] leading-[52px]"
        >
          Pick your name
        </Text>
        <Text className="text-base leading-[22px] text-muted-foreground">
          It&apos;s shown on every game you publish. You can change it later.
        </Text>
      </View>
      <View className="h-14 flex-row items-center rounded-2xl bg-card px-4">
        <Text className="font-strong text-lg text-muted-foreground">@</Text>
        <Input
          value={name}
          onChangeText={(text) =>
            setName(text.toLowerCase().replaceAll(/[^a-z0-9_]/gu, ""))
          }
          placeholder="maya_makes"
          accessibilityLabel="Your name"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={() => save()}
          className="h-14 flex-1 border-0 bg-transparent px-1 text-lg dark:bg-transparent"
        />
      </View>
      <Text
        className={cn(
          "-mt-2 text-sm",
          error ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {error ||
          "4 to 20 characters: lowercase letters, numbers and underscores."}
      </Text>
      <Button
        className={cn(
          "h-12 rounded-full",
          !HANDLE.test(name) && "bg-card opacity-100"
        )}
        disabled={!HANDLE.test(name) || saving}
        onPress={() => save()}
      >
        <Text className={cn(!HANDLE.test(name) && "text-muted-foreground")}>
          {saving ? "Saving…" : "Continue"}
        </Text>
      </Button>
      <Button variant="ghost" onPress={done}>
        <Text>Not now</Text>
      </Button>
    </View>
  );
};

export default Handle;
