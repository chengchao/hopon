import { useSignIn, useSignUp } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { CONTACT_EMAIL } from "@/lib/rules";

interface ClerkFailure {
  code?: string;
  message: string;
  longMessage?: string;
  errors?: { code: string }[];
}
const hasCode = (e: ClerkFailure, code: string) =>
  e.code === code || !!e.errors?.some((x) => x.code === code);
const notFound = (e: ClerkFailure) => hasCode(e, "form_identifier_not_found");
// Clerk refuses a Banned account's sign-in with `user_banned`.
const describe = (e: ClerkFailure) =>
  hasCode(e, "user_banned")
    ? t.signIn.banned(CONTACT_EMAIL)
    : (e.longMessage ?? e.message);

// One screen for both: an email code signs in an existing user, or signs up a new one.
const SignIn = () => {
  const { next } = useLocalSearchParams<{ next?: "create" | "me" }>();
  const { signIn, fetchStatus } = useSignIn();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [flow, setFlow] = useState<"email" | "signIn" | "signUp">("email");
  const [error, setError] = useState("");
  const fetching = fetchStatus === "fetching";
  const busyLabel = flow === "email" ? t.signIn.sending : t.signIn.checking;
  const idleLabel = flow === "email" ? t.signIn.sendCode : t.common.signIn;

  const run = async (step: () => Promise<ClerkFailure | null | undefined>) => {
    setError("");
    try {
      const failure = await step();
      if (failure) {
        setError(describe(failure));
      }
    } catch (stepError) {
      setError(describe(stepError as ClerkFailure) || t.signIn.somethingWrong);
    }
  };

  const sendCode = () =>
    run(async () => {
      const emailAddress = email.trim();
      const sent = await signIn.emailCode.sendCode({ emailAddress });
      if (!sent.error) {
        setFlow("signIn");
        return;
      }
      if (!notFound(sent.error)) {
        return sent.error;
      }
      const created = await signUp.create({ emailAddress });
      if (created.error) {
        return created.error;
      }
      const resent = await signUp.verifications.sendEmailCode();
      if (resent.error) {
        return resent.error;
      }
      setFlow("signUp");
    });

  const verify = () =>
    run(async () => {
      const resource = flow === "signIn" ? signIn : signUp;
      const { error: verifyError } =
        flow === "signIn"
          ? await signIn.emailCode.verifyCode({ code })
          : await signUp.verifications.verifyEmailCode({ code });
      if (verifyError) {
        return verifyError;
      }
      if (resource.status !== "complete") {
        return { message: t.signIn.couldNotFinish };
      }
      await resource.finalize();
      // Next: agree to the Rules, pick a handle (each skipped if already done), then on into Create or back.
      router.replace(
        next === "create" ? "/rules?next=create" : "/rules?next=handle"
      );
    });

  return (
    <View className="flex-1 gap-5 bg-background px-6 pt-20">
      <View className="gap-2">
        <Text
          accessibilityRole="header"
          className="font-display text-[52px] leading-[52px]"
        >
          {flow === "email" ? t.signIn.emailTitle : t.signIn.codeTitle}
        </Text>
        <Text className="text-base leading-[22px] text-muted-foreground">
          {flow === "email"
            ? t.signIn.emailIntro
            : t.signIn.codeIntro(email.trim())}
        </Text>
      </View>
      {flow === "email" ? (
        <Input
          key="email"
          className="h-14 rounded-2xl border-0 bg-card px-4 text-lg"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          accessibilityLabel={t.signIn.email}
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => sendCode()}
        />
      ) : (
        <Input
          key="code"
          className="h-14 rounded-2xl border-0 bg-card px-4 text-lg"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          accessibilityLabel={t.signIn.code}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => verify()}
        />
      )}
      {!!error && (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
      <Button
        className="h-12 rounded-full"
        disabled={
          fetching ||
          (flow === "email" ? !email.includes("@") : code.trim().length < 6)
        }
        onPress={() => (flow === "email" ? sendCode() : verify())}
      >
        <Text>{fetching ? busyLabel : idleLabel}</Text>
      </Button>
      {flow !== "email" && (
        <Button
          variant="link"
          onPress={() => {
            setFlow("email");
            setCode("");
            setError("");
          }}
        >
          <Text>{t.signIn.differentEmail}</Text>
        </Button>
      )}
      <Button variant="ghost" onPress={() => router.back()}>
        <Text>{t.common.cancel}</Text>
      </Button>
    </View>
  );
};

export default SignIn;
