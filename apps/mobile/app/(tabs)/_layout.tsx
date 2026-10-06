import { router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Bookmark, Compass, Plus, User } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { COLORS } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MIST = "#AEB0E0";
const TABS: { name: string; label: string; Icon: LucideIcon }[] = [
  { Icon: Compass, label: "Discover", name: "index" },
  { Icon: Bookmark, label: "Saved", name: "saved" },
  { Icon: User, label: "Me", name: "me" },
];

// Make sits in the middle like TikTok's +, but opens the Create sheet instead of switching tabs.
const TabBar = ({ state, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const tab = ({ name, label, Icon }: (typeof TABS)[number]) => {
    const focused = current === name;
    return (
      <Pressable
        key={name}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: focused }}
        onPress={() => navigation.navigate(name)}
        className="flex-1 items-center gap-1 pt-1"
      >
        <View className="h-7 justify-center">
          <Icon
            size={24}
            strokeWidth={focused ? 2.5 : 2}
            color={focused ? COLORS.ticket : MIST}
          />
        </View>
        <Text
          className={cn(
            "text-xs",
            focused ? "font-strong text-primary" : "text-muted-foreground"
          )}
        >
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <View
      className="flex-row items-start bg-background px-2 pt-1"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {tab(TABS[0])}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Make a game"
        onPress={() => router.push("/create")}
        className="flex-1 items-center gap-1 pt-1"
      >
        {({ pressed }) => (
          <>
            <View
              className={cn(
                "h-7 w-11 items-center justify-center rounded-lg bg-primary",
                pressed && "opacity-80"
              )}
            >
              <Plus size={20} strokeWidth={3} color={COLORS.ink} />
            </View>
            <Text className="font-strong text-xs text-primary">Make</Text>
          </>
        )}
      </Pressable>
      {tab(TABS[1])}
      {tab(TABS[2])}
    </View>
  );
};

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

const TabsLayout = () => (
  <Tabs screenOptions={{ headerShown: false }} tabBar={renderTabBar}>
    <Tabs.Screen name="index" />
    <Tabs.Screen name="saved" />
    <Tabs.Screen name="me" />
  </Tabs>
);

export default TabsLayout;
