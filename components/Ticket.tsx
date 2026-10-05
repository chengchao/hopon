import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

// The ride ticket under each game: the same stub in the feed and on a draft, so a preview shows exactly what gets published.
export function Ticket({
  label,
  title,
  description,
  children,
  className,
  ...props
}: ViewProps & { label: string; title: string; description: string; children?: ReactNode }) {
  return (
    <View {...props} className={cn('gap-1 rounded-b-2xl bg-primary px-5 pb-4 pt-5', className)}>
      <Perforation />
      <Text className="font-strong text-xs text-primary-foreground/60">{label}</Text>
      <Text numberOfLines={2} className="font-display text-[44px] leading-[44px] text-primary-foreground">
        {title}
      </Text>
      <Text numberOfLines={3} className="text-base leading-[22px] text-primary-foreground/80">
        {description}
      </Text>
      {children}
    </View>
  );
}

// The torn edge between game and ticket: notches cut in the night colour, then a row of perforation dashes.
function Perforation() {
  return (
    <>
      <View className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-background" />
      <View className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full bg-background" />
      <View className="absolute left-5 right-5 top-0 flex-row justify-between">
        {Array.from({ length: 22 }, (_, i) => (
          <View key={i} className="h-[3px] w-1.5 rounded-full bg-primary-foreground/20" />
        ))}
      </View>
    </>
  );
}
