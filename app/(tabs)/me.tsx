import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { usePrototype } from '@/lib/prototype';
import { api } from '@/lib/api';
import { useAuth, useUser } from '@clerk/expo';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Me() {
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { user } = useUser();
  const { saved } = usePrototype();
  const [error, setError] = useState('');
  const [liked, setLiked] = useState<number | null>(null);

  // Refetched whenever Me comes into view, so likes made on Discover show up.
  // getToken isn't stable, so it's left out of the deps; isSignedIn is what matters.
  useFocusEffect(
    useCallback(() => {
      if (!isSignedIn) return;
      void (async () => {
        try {
          setLiked((await api<{ count: number }>('/api/likes/count', { token: await getToken() })).count);
        } catch {
          // Keep the last count; the stat isn't worth an error banner.
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSignedIn]),
  );

  function deleteAccount() {
    Alert.alert(
      'Delete your account?',
      'You will be signed out and your account removed. Published games stay public.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void user?.delete().catch((e) => setError((e as Error).message)),
        },
      ],
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 24 }}
    >
      <Text accessibilityRole="header" className="font-display text-[44px] leading-[48px]">
        Me
      </Text>
      {!isLoaded ? null : isSignedIn ? (
        <>
          <View className="gap-1">
            {user?.username ? (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Change your name"
                onPress={() => router.push('/handle')}
              >
                <Text className="font-strong text-2xl text-primary">@{user.username}</Text>
              </Pressable>
            ) : (
              <Button className="h-11 self-start rounded-full px-5" onPress={() => router.push('/handle')}>
                <Text>Pick your name</Text>
              </Button>
            )}
            <Text className="text-sm text-muted-foreground">{user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
          <View className="flex-row gap-3">
            <Stat value={liked ?? '–'} label="Liked" />
            <Stat value={saved.length} label="Saved" />
          </View>
          {!!error && (
            <Text accessibilityRole="alert" className="text-destructive">
              {error}
            </Text>
          )}
          <View className="flex-row gap-2">
            <Button variant="outline" className="rounded-full bg-transparent" onPress={() => void signOut()}>
              <Text>Sign out</Text>
            </Button>
            <Button variant="ghost" className="rounded-full" onPress={deleteAccount}>
              <Text className="text-destructive">Delete account</Text>
            </Button>
          </View>
        </>
      ) : (
        <View className="gap-4">
          <Text className="text-base leading-[22px] text-muted-foreground">
            Sign in to make games and keep the ones you like.
          </Text>
          <Button className="h-12 self-start rounded-full px-6" onPress={() => router.push('/sign-in?next=me')}>
            <Text>Sign in</Text>
          </Button>
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-card px-4 py-3">
      <Text className="font-display text-[36px] leading-[40px]">{value}</Text>
      <Text className="text-sm text-muted-foreground">{label}</Text>
    </View>
  );
}
