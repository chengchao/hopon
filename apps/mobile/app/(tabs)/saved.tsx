import { Byline, Ticket } from '@/components/Ticket';
import { Text } from '@/components/ui/text';
import { usePrototype } from '@/lib/prototype';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Saved() {
  const insets = useSafeAreaInsets();
  const { saved } = usePrototype();
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <FlatList
        data={saved}
        keyExtractor={(game) => String(game.id)}
        contentContainerClassName="gap-4 px-3 pb-6"
        ListHeaderComponent={
          <Text accessibilityRole="header" className="px-2 pb-1 pt-4 font-display text-[44px] leading-[48px]">
            Saved
          </Text>
        }
        renderItem={({ item }) => (
          <Ticket
            className="rounded-2xl"
            torn={false}
            compact
            byline={<Byline author={item.author} />}
            title={item.title}
            description={item.description}
          />
        )}
        ListEmptyComponent={
          <Text className="px-2 pt-2 text-base leading-[22px] text-muted-foreground">
            Tap the bookmark on a game's ticket to keep it here.
          </Text>
        }
      />
    </View>
  );
}
