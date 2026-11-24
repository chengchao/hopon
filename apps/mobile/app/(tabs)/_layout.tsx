import { router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Bookmark, Compass, Hammer, Plus, User } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { COLORS } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MIST = "#AEB0E0";
const TABS: { name: string; label: string; Icon: LucideIcon }[] = [
  { Icon: Compass, label: t.tabs.discover, name: "index" },
  { Icon: Hammer, label: t.tabs.drafts, name: "drafts" },
  { Icon: Bookmark, label: t.tabs.saved, name: "saved" },
  { Icon: User, label: t.tabs.me, name: "me" },
];

// Make sits beside the tabs, not among them: it opens the Create sheet instead of switching tabs.
const TabBar = ({ state, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  return (
    <View
      className="flex-row items-center gap-3 bg-background px-4 pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <View className="h-14 flex-1 flex-row items-center rounded-full border border-border bg-card">
        {TABS.map(({ name, label, Icon }) => {
          const focused = current === name;
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              onPress={() => navigation.navigate(name)}
              className="h-full flex-1 items-center justify-center gap-0.5"
            >
              <Icon
                size={22}
                strokeWidth={focused ? 2.5 : 2}
                color={focused ? COLORS.ticket : MIST}
              />
              <Text
                className={cn(
                  "text-[11px] leading-[14px]",
                  focused ? "font-strong text-primary" : "text-muted-foreground"
                )}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.tabs.makeGame}
        onPress={() => router.push("/create")}
        className="h-14 w-14 items-center justify-center rounded-full bg-primary active:opacity-80"
      >
        <Plus size={26} strokeWidth={3} color={COLORS.ink} />
      </Pressable>
    </View>
  );
};

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

const TabsLayout = () => (
  <Tabs screenOptions={{ headerShown: false }} tabBar={renderTabBar}>
    <Tabs.Screen name="index" />
    <Tabs.Screen name="drafts" />
    <Tabs.Screen name="saved" />
    <Tabs.Screen name="me" />
  </Tabs>
);

export default TabsLayout;
