import { useAuth } from "@clerk/expo";
import { REPORT_REASONS } from "@hopon/schemas";
import type { ReportReason } from "@hopon/schemas";
import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Someone else's game or comment, and the @handle of the account behind it. */
export interface ReportTarget {
  kind: "game" | "comment";
  id: number;
  handle: string | null;
  /** Already blocked (reporting after Block), so the sheet doesn't offer to block again. */
  blocked?: boolean;
}

export const targetOf = (
  kind: ReportTarget["kind"],
  { author, id }: { author: string | null; id: number }
): ReportTarget => ({ handle: author, id, kind });

// Blocks the account behind a game or comment; the server resolves which account that is.
const block = async ({ kind, id }: ReportTarget, token: string | null) => {
  await api(`/api/${kind}s/${id}/block`, { method: "POST", token });
};

// Block from the "…" menu or a comment's menu: confirm, block, let the caller hide everything, then offer a report.
export const confirmBlock = ({
  target,
  getToken,
  onBlocked,
  onReport,
}: {
  target: ReportTarget;
  getToken: () => Promise<string | null>;
  onBlocked: (handle: string | null) => void;
  onReport: (target: ReportTarget) => void;
}) =>
  Alert.alert(
    `Block @${target.handle}?`,
    "You won't see each other's games or comments anywhere in hopon. They won't be told. Unblock any time from Me.",
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: async () => {
          try {
            await block(target, await getToken());
          } catch (blockError) {
            return Alert.alert("Couldn't block", (blockError as Error).message);
          }
          onBlocked(target.handle);
          Alert.alert(`Also report this ${target.kind}?`, undefined, [
            { style: "cancel", text: "Not now" },
            {
              onPress: () => onReport({ ...target, blocked: true }),
              text: "Report",
            },
          ]);
        },
        style: "destructive",
        text: "Block",
      },
    ]
  );

// Report someone else's game or comment: pick a reason, then Report, optionally blocking its poster too, or just block.
// `onReported` and `onBlocked` run once the server has the report and the block.
export const ReportSheet = ({
  target,
  onClose,
  onReported,
  onBlocked,
}: {
  target: ReportTarget | null;
  onClose: () => void;
  onReported: (id: number) => void;
  onBlocked: (handle: string | null) => void;
}) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // The open target, so a reply that lands after the sheet moved on doesn't touch another target's sheet.
  const open = useRef<number | null>(null);
  const id = target?.id;
  useEffect(() => {
    open.current = id ?? null;
  }, [id]);

  // A different target starts from a blank sheet; reset during render so the old choice never paints.
  const [shown, setShown] = useState(id);
  if (shown !== id) {
    setShown(id);
    setReason(null);
    setAlsoBlock(false);
    setSending(false);
    setError("");
  }

  // Report (when `reporting`) and block (when asked to) in that order. Both are idempotent, so a retry after a failure is safe.
  const send = async (reporting: boolean, blocking: boolean) => {
    if (!target || (reporting && !reason)) {
      return;
    }
    const { kind, id: targetId, handle } = target;
    setSending(true);
    setError("");
    try {
      if (reporting) {
        await api(`/api/${kind}s/${targetId}/report`, {
          body: { reason },
          token: await getToken(),
        });
      }
      if (blocking) {
        await block(target, await getToken());
      }
      if (reporting) {
        onReported(targetId);
      }
      if (blocking) {
        onBlocked(handle);
      }
    } catch (reportError) {
      if (open.current === targetId) {
        setError((reportError as Error).message);
        setSending(false);
      }
    }
  };

  return (
    <Modal
      visible={!!target}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/40"
          accessibilityLabel="Close report"
          onPress={onClose}
        />
        <View
          className="gap-3 rounded-t-3xl bg-card px-5 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-border" />
          <Text
            accessibilityRole="header"
            className="font-display text-[32px] leading-[36px]"
          >
            {target?.kind === "comment" ? "Report comment" : "Report game"}
          </Text>
          <View accessibilityRole="radiogroup" className="gap-2">
            {REPORT_REASONS.map(({ reason: key, label }) => (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ checked: reason === key }}
                onPress={() => setReason(key)}
                className={cn(
                  "h-12 flex-row items-center gap-3 rounded-2xl bg-background px-4",
                  reason === key && "border-2 border-primary"
                )}
              >
                <View
                  className={cn(
                    "h-5 w-5 rounded-full border-2 border-muted-foreground",
                    reason === key && "border-[6px] border-primary"
                  )}
                />
                <Text className="text-base">{label}</Text>
              </Pressable>
            ))}
          </View>
          {!target?.blocked && (
            // The whole row toggles, and VoiceOver reads it as one switch; the Switch only shows the state.
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: alsoBlock }}
              onPress={() => setAlsoBlock((on) => !on)}
              className="flex-row items-center gap-3 px-1"
            >
              <View className="flex-1">
                <Text className="text-base">Also block @{target?.handle}</Text>
                <Text className="text-sm text-muted-foreground">
                  You won&apos;t see each other&apos;s games or comments
                </Text>
              </View>
              <View pointerEvents="none">
                <Switch value={alsoBlock} />
              </View>
            </Pressable>
          )}
          {!!error && (
            <Text className="text-center text-sm text-destructive">
              {error}
            </Text>
          )}
          <Button
            className="h-12 rounded-full"
            disabled={!reason || sending}
            onPress={() => send(true, alsoBlock)}
          >
            <Text>{sending ? "Reporting…" : "Report"}</Text>
          </Button>
          <Text className="text-center text-sm text-muted-foreground">
            We review reports within 24 hours.
          </Text>
          {!target?.blocked && (
            <Button
              variant="link"
              disabled={sending}
              onPress={() => send(false, true)}
            >
              <Text>Just block @{target?.handle}, don&apos;t report</Text>
            </Button>
          )}
        </View>
      </View>
    </Modal>
  );
};
