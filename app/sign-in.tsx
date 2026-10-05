import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useSignIn, useSignUp } from '@clerk/expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

type ClerkFailure = { code?: string; message: string; longMessage?: string; errors?: { code: string }[] };
const notFound = (e: ClerkFailure) =>
  e.code === 'form_identifier_not_found' || !!e.errors?.some((x) => x.code === 'form_identifier_not_found');
const describe = (e: ClerkFailure) => e.longMessage ?? e.message;

// One screen for both: an email code signs in an existing user, or signs up a new one.
export default function SignIn() {
  const { signIn, fetchStatus } = useSignIn();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [flow, setFlow] = useState<'email' | 'signIn' | 'signUp'>('email');
  const [error, setError] = useState('');
  const fetching = fetchStatus === 'fetching';

  async function run(step: () => Promise<ClerkFailure | null | void>) {
    setError('');
    try {
      const failure = await step();
      if (failure) setError(describe(failure));
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Please try again.');
    }
  }

  const sendCode = () =>
    run(async () => {
      const emailAddress = email.trim();
      const sent = await signIn.emailCode.sendCode({ emailAddress });
      if (!sent.error) return setFlow('signIn');
      if (!notFound(sent.error)) return sent.error;
      const created = await signUp.create({ emailAddress });
      if (created.error) return created.error;
      const resent = await signUp.verifications.sendEmailCode();
      if (resent.error) return resent.error;
      setFlow('signUp');
    });

  const verify = () =>
    run(async () => {
      const resource = flow === 'signIn' ? signIn : signUp;
      const { error } =
        flow === 'signIn'
          ? await signIn.emailCode.verifyCode({ code })
          : await signUp.verifications.verifyEmailCode({ code });
      if (error) return error;
      if (resource.status !== 'complete') return { message: 'Could not finish signing in. Please try again.' };
      await resource.finalize();
      router.replace('/create');
    });

  return (
    <View className="flex-1 gap-5 bg-background px-6 pt-20">
      <View className="gap-2">
        <Text accessibilityRole="header" className="font-display text-[52px] leading-[52px]">
          {flow === 'email' ? 'Sign in to make games' : 'Check your email'}
        </Text>
        <Text className="text-base leading-[22px] text-muted-foreground">
          {flow === 'email'
            ? 'We email you a 6-digit code. No password. New here? The same code creates your account.'
            : `Enter the 6-digit code we sent to ${email.trim()}.`}
        </Text>
      </View>
      {flow === 'email' ? (
        <Input
          key="email"
          className="h-14 rounded-2xl border-0 bg-card px-4 text-lg"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          accessibilityLabel="Email"
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => void sendCode()}
        />
      ) : (
        <Input
          key="code"
          className="h-14 rounded-2xl border-0 bg-card px-4 text-lg"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          accessibilityLabel="Verification code"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => void verify()}
        />
      )}
      {!!error && (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
      <Button
        className="h-12 rounded-full"
        disabled={fetching || (flow === 'email' ? !email.includes('@') : code.trim().length < 6)}
        onPress={() => void (flow === 'email' ? sendCode() : verify())}
      >
        <Text>
          {flow === 'email' ? (fetching ? 'Sending…' : 'Email me a code') : fetching ? 'Checking…' : 'Sign in'}
        </Text>
      </Button>
      {flow !== 'email' && (
        <Button
          variant="link"
          onPress={() => {
            setFlow('email');
            setCode('');
            setError('');
          }}
        >
          <Text>Use a different email</Text>
        </Button>
      )}
      <Button variant="ghost" onPress={() => router.dismissTo('/')}>
        <Text>Cancel</Text>
      </Button>
    </View>
  );
}
