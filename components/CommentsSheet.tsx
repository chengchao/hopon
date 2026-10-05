import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { Game } from '@/lib/api';
import { addComment, usePrototype } from '@/lib/prototype';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Covers the ticket and the lower part of the game; the game stays visible above so you keep your place.
export function CommentsSheet({ game, onClose }: { game: Game | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { comments } = usePrototype();
  const [text, setText] = useState('');
  const list = game ? (comments[game.id] ?? []) : [];

  function post() {
    if (!game || !text.trim()) return;
    addComment(game.id, text.trim());
    setText('');
  }

  return (
    <Modal visible={!!game} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
        <Pressable className="absolute inset-0" accessibilityLabel="Close comments" onPress={onClose} />
        <View className="h-[62%] rounded-t-3xl bg-card px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <View className="mb-2 h-1 w-10 self-center rounded-full bg-border" />
          <View className="flex-row items-center justify-between">
            <Text accessibilityRole="header" className="font-display text-[32px] leading-[36px]">
              Comments
            </Text>
            <Button size="sm" variant="ghost" className="rounded-full" onPress={onClose}>
              <Text>Close</Text>
            </Button>
          </View>
          <FlatList
            className="flex-1"
            contentContainerClassName="gap-3 py-3"
            data={list}
            keyExtractor={(_, index) => String(index)}
            renderItem={({ item }) => (
              <View className="gap-0.5">
                <Text className="font-strong text-sm text-muted-foreground">You</Text>
                <Text className="text-base leading-[22px]">{item}</Text>
              </View>
            )}
            ListEmptyComponent={
              <Text className="py-6 text-center text-muted-foreground">
                No comments on {game?.title} yet. Be the first.
              </Text>
            }
          />
          <View className="flex-row items-center gap-2">
            <Input
              value={text}
              onChangeText={setText}
              placeholder="Add a comment"
              accessibilityLabel="Comment"
              returnKeyType="send"
              onSubmitEditing={post}
              className="h-12 flex-1 rounded-full border-0 bg-background px-4"
            />
            <Button
              className={cn('h-12 rounded-full px-5', !text.trim() && 'bg-background opacity-100')}
              disabled={!text.trim()}
              onPress={post}
            >
              <Text className={cn(!text.trim() && 'text-muted-foreground')}>Post</Text>
            </Button>
          </View>
          <Text className="pt-2 text-center text-xs text-muted-foreground">
            Preview only: comments stay on this phone for now.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
