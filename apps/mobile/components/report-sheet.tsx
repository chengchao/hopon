import { useAuth } from "@clerk/expo";
import { REPORT_REASONS } from "@hopon/schemas";
import type { ReportReason } from "@hopon/schemas";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Report someone else's game or comment: pick a reason, then Report. `onReported` runs once the server has the report.
export const ReportSheet = ({
  target,
  onClose,
  onReported,
}: {
  target: { kind: "game" | "comment"; id: number } | null;
  onClose: () => void;
  onReported: (id: number) => void;
}) => {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
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
    setSending(false);
    setError("");
  }

  const report = async () => {
    if (!target || !reason) {
      return;
    }
    const { kind, id: targetId } = target;
    setSending(true);
    setError("");
    try {
      await api(`/api/${kind}s/${targetId}/report`, {
        body: { reason },
        token: await getToken(),
      });
      onReported(targetId);
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
          {!!error && (
            <Text className="text-center text-sm text-destructive">
              {error}
            </Text>
          )}
          <Button
            className="h-12 rounded-full"
            disabled={!reason || sending}
            onPress={report}
          >
            <Text>{sending ? "Reporting…" : "Report"}</Text>
          </Button>
          <Text className="text-center text-sm text-muted-foreground">
            We review reports within 24 hours.
          </Text>
        </View>
      </View>
    </Modal>
  );
};
