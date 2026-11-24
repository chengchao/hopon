// A Draft's page, from its card on the Drafts tab: its game playing once it has one, and until then what the Maker is
// doing, with the way into the chat. It reads the Draft list, and the Draft's chat once its socket is open, so the
// first build turns the wait into the game with no tap.
import { useAuth } from "@clerk/expo";
import {
  Redirect,
  router,
  useIsFocused,
  useLocalSearchParams,
} from "expo-router";
import { ChevronLeft, RotateCcw } from "lucide-react-native";
import { useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DraftGame } from "@/components/draft-game";
import { PublishSheet } from "@/components/publish-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { draftPage, draftTitle, isWorking } from "@/lib/drafts";
import type { DraftPageView } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { useMaker } from "@/lib/maker-socket";
import { COLORS } from "@/lib/theme";
import { useDrafts } from "@/lib/use-drafts";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const CLOCK_MS = 1000;

// The Maker's work in flight, with its spinner.
const Work = ({ text, className }: { text: string; className?: string }) => (
  <View className={cn("flex-row items-center gap-2", className)}>
    <ActivityIndicator size="small" color={COLORS.paper} />
    <Text
      // The turn's clock ticks without the text shifting.
      style={{ fontVariant: ["tabular-nums"] }}
      className="text-base text-muted-foreground"
    >
      {text}
    </Text>
  </View>
);

// A Draft with no game: what the Maker is doing about it, or that it is doing nothing.
const Waiting = ({ page }: { page: DraftPageView }) => (
  <ScrollView
    className="flex-1"
    contentContainerClassName="gap-5 px-5 pb-6 pt-4"
  >
    <Text
      accessibilityRole="header"
      className="font-display text-[44px] leading-[48px]"
    >
      {page.working ? t.draftPage.making : t.draftPage.unmade}
    </Text>
    {page.work !== undefined && (
      <View className="gap-2">
        {page.steps.map((step) => (
          <Text key={step.key} className="text-base text-muted-foreground">
            ✓ {step.text}
          </Text>
        ))}
        <Work text={page.work} />
      </View>
    )}
    {page.asked !== undefined && (
      <View className="gap-1">
        <Text className="font-strong text-xs text-muted-foreground">
          {t.draftPage.youAsked}
        </Text>
        <View className="rounded-2xl bg-card px-4 py-3">
          <Text numberOfLines={6} className="text-base leading-[22px]">
            {page.asked}
          </Text>
        </View>
      </View>
    )}
    <Text className="text-base leading-[22px] text-muted-foreground">
      {page.working ? t.draftPage.makingHint : t.draftPage.unmadeHint}
    </Text>
  </ScrollView>
);

// In place of a Draft the list doesn't have: still loading, the list's error, or gone.
const Missing = ({
  loaded,
  error,
  onRetry,
}: {
  loaded: boolean;
  error: string;
  onRetry: () => void;
}) => {
  if (loaded) {
    return (
      <View className="flex-1 items-start gap-4 px-5 pt-4">
        <Text className="text-base leading-[22px] text-muted-foreground">
          {t.draftPage.gone}
        </Text>
        <Button
          variant="outline"
          className="rounded-full"
          onPress={() => router.back()}
        >
          <Text>{t.common.back}</Text>
        </Button>
      </View>
    );
  }
  if (error) {
    return (
      <View className="flex-1 items-start gap-3 px-5 pt-4">
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
        <Button variant="outline" className="rounded-full" onPress={onRetry}>
          <Text>{t.common.tryAgain}</Text>
        </Button>
      </View>
    );
  }
  return (
    <Text className="flex-1 px-5 pt-4 text-muted-foreground">
      {t.common.loading}
    </Text>
  );
};

// The top bar. `onRestart` is set while a game plays.
const Header = ({
  title,
  onRestart,
}: {
  title: string;
  onRestart?: () => void;
}) => (
  <View className="flex-row items-center gap-1 px-2 pb-2 pt-1">
    <Button
      size="icon"
      variant="ghost"
      accessibilityLabel={t.common.back}
      onPress={() => router.back()}
    >
      <ChevronLeft color={COLORS.paper} size={24} />
    </Button>
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      className="flex-1 text-center font-strong text-base"
    >
      {title}
    </Text>
    {onRestart ? (
      <Button
        size="icon"
        variant="ghost"
        accessibilityLabel={t.play.restart}
        onPress={onRestart}
      >
        <RotateCcw color={COLORS.paper} size={20} />
      </Button>
    ) : (
      // Balances the back button, so the title sits in the middle.
      <View className="h-10 w-10" />
    )}
  </View>
);

// The Draft under the top bar: its game with Chat and Publish, or the wait with the way into the chat.
const Found = ({
  page,
  game,
  onChat,
  onPublish,
}: {
  page: DraftPageView;
  game: ReactNode;
  onChat: () => void;
  onPublish: () => void;
}) =>
  page.hasGame ? (
    <>
      {game}
      {page.work !== undefined && (
        <Work text={page.work} className="justify-center pt-2" />
      )}
      <View className="flex-row gap-3 px-5 pt-3">
        <Button
          variant="outline"
          className="h-12 flex-1 rounded-full bg-transparent"
          onPress={onChat}
        >
          <Text>{t.draftPage.chat}</Text>
        </Button>
        <Button
          className="h-12 flex-1 rounded-full"
          disabled={!page.canPublish}
          accessibilityHint={
            page.working ? t.draftPage.publishWhenDone : undefined
          }
          onPress={onPublish}
        >
          <Text>{t.common.publish}</Text>
        </Button>
      </View>
    </>
  ) : (
    <>
      <Waiting page={page} />
      <View className="px-5 pt-2">
        <Button className="h-12 rounded-full" onPress={onChat}>
          <Text>{t.draftPage.goToChat}</Text>
        </Button>
      </View>
    </>
  );

const DraftPage = () => {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // Under the chat, or any other screen, this one lets go of the Draft's socket and stops its game: one socket per
  // Draft, and no game playing out of sight. Back in view, the game starts again from the newest Revision.
  const focused = useIsFocused();
  const { drafts, error, refresh } = useDrafts();
  const listed = drafts?.find((draft) => draft.id === id);
  const maker = useMaker({
    draft: focused && listed ? id : undefined,
    getToken,
  });
  const now = useNow(listed && isWorking(listed) ? CLOCK_MS : undefined);
  const [restarts, setRestarts] = useState(0);
  const [confirming, setConfirming] = useState(false);

  if (isLoaded && !isSignedIn) {
    return <Redirect href="/" />;
  }

  const page =
    listed && draftPage(listed, maker.live ? maker.view : undefined, now);
  const playing = !!page?.hasGame && focused;

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingBottom: Math.max(insets.bottom, 12),
        paddingTop: insets.top,
      }}
    >
      <Header
        title={page ? draftTitle(page.draft) : ""}
        onRestart={playing ? () => setRestarts((n) => n + 1) : undefined}
      />
      {page ? (
        <Found
          page={page}
          game={
            playing ? (
              <DraftGame
                draft={page.draft}
                turns={maker.turns}
                restarts={restarts}
              />
            ) : (
              <View className="flex-1" />
            )
          }
          onChat={() =>
            router.push({ params: { draft: id }, pathname: "/create" })
          }
          onPublish={() => setConfirming(true)}
        />
      ) : (
        <Missing
          loaded={drafts !== undefined}
          error={error}
          onRetry={refresh}
        />
      )}
      <PublishSheet
        draft={page?.draft}
        open={confirming}
        onClose={() => setConfirming(false)}
      />
    </View>
  );
};

export default DraftPage;
