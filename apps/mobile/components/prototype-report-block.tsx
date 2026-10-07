// PROTOTYPE, throwaway (branch prototype/report-block-ui): where Report and Block live in the app.
// Three variants on the real feed, comments sheet and Me tab, cycled by the bar at the top of the screen.
// Nothing reaches the server: reports and blocks live in memory; long-press the bar's label to reset.
import { useAuth, useUser } from "@clerk/expo";
import { router } from "expo-router";
import { Ban, ChevronDown, Flag, MoreHorizontal } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Pressable,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Byline } from "@/components/ticket";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { COLORS } from "@/lib/theme";
import { cn } from "@/lib/utils";

const VARIANTS = {
  A: "Overflow menu",
  B: "Handle sheet",
  C: "Flag button",
} as const;
type Variant = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Variant[];
const REASONS = [
  "Not suitable for ages 13+",
  "Hateful or harassing",
  "Spam or scam",
  "Something else",
];
const MIST = "#AEB0E0";

export interface Target {
  kind: "game" | "comment";
  id: number;
  author: string;
}
interface Extra {
  label: string;
  onPress: () => void;
}

let state = {
  blocked: [] as string[],
  /** The last thing acted on: variant C leaves a placeholder there instead of removing it. */
  last: null as string | null,
  reported: [] as string[],
  variant: "A" as Variant,
};
type State = typeof state;
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const usePrototype = () => useSyncExternalStore(subscribe, () => state);

export const key = (t: Pick<Target, "kind" | "id">) => `${t.kind}:${t.id}`;
const noun = (t: Target) => t.kind;
const report = (t: Target) =>
  set({ last: key(t), reported: [...new Set([...state.reported, key(t)])] });
const block = (t: Target) =>
  set({ blocked: [...new Set([...state.blocked, t.author])], last: key(t) });
const unblock = (author: string) =>
  set({ blocked: state.blocked.filter((a) => a !== author) });

export const isReported = (s: State, t: Pick<Target, "kind" | "id">) =>
  s.reported.includes(key(t));
export const isHidden = (
  s: State,
  t: Pick<Target, "kind" | "id"> & { author: string | null }
) => isReported(s, t) || (!!t.author && s.blocked.includes(t.author));
/** What a list shows: hidden things drop out, except variant C's placeholder for the last one acted on. */
export const isListed = (
  s: State,
  t: Pick<Target, "kind" | "id"> & { author: string | null }
) => !isHidden(s, t) || (s.variant === "C" && s.last === key(t));

const Sheet = ({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/40"
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <View
          className="gap-3 rounded-t-3xl bg-card px-5 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-border" />
          {children}
        </View>
      </View>
    </Modal>
  );
};

const Title = ({ children }: { children: ReactNode }) => (
  <Text
    accessibilityRole="header"
    className="font-display text-[32px] leading-[36px]"
  >
    {children}
  </Text>
);

const Row = ({
  Icon,
  label,
  danger,
  onPress,
}: {
  Icon: LucideIcon;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="h-14 flex-row items-center gap-3 rounded-2xl bg-background px-4 active:opacity-80"
  >
    <Icon size={20} color={danger ? COLORS.bulb : COLORS.paper} />
    <Text className={cn("text-base", danger && "text-destructive")}>
      {label}
    </Text>
  </Pressable>
);

const Reasons = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (reason: string) => void;
}) => (
  <View accessibilityRole="radiogroup" className="gap-2">
    {REASONS.map((reason) => (
      <Pressable
        key={reason}
        accessibilityRole="radio"
        accessibilityState={{ checked: value === reason }}
        onPress={() => onChange(reason)}
        className={cn(
          "h-12 flex-row items-center gap-3 rounded-2xl bg-background px-4",
          value === reason && "border-2 border-primary"
        )}
      >
        <View
          className={cn(
            "h-5 w-5 rounded-full border-2 border-muted-foreground",
            value === reason && "border-[6px] border-primary"
          )}
        />
        <Text className="text-base">{reason}</Text>
      </Pressable>
    ))}
  </View>
);

const BLOCK_MEANS =
  "You won't see each other's games or comments anywhere in hopon. They won't be told. Unblock any time from Me.";

// B: tap the handle, get a sheet about that person, and every step happens inside it.
const PersonSheet = ({
  target: t,
  onClose,
}: {
  target: Target;
  onClose: () => void;
}) => {
  const s = usePrototype();
  const [step, setStep] = useState<
    "menu" | "reasons" | "reported" | "block" | "blocked"
  >("menu");
  const [reason, setReason] = useState<string | null>(null);
  const isBlocked = s.blocked.includes(t.author);
  const reported = isReported(s, t);
  if (step === "reasons") {
    return (
      <Sheet onClose={onClose}>
        <Title>{`Report ${noun(t)}`}</Title>
        <Text className="text-muted-foreground">{`Why are you reporting this ${noun(t)} by @${t.author}?`}</Text>
        <Reasons value={reason} onChange={setReason} />
        <Button
          className="h-12 rounded-full"
          disabled={!reason}
          onPress={() => {
            report(t);
            setStep("reported");
          }}
        >
          <Text>Report</Text>
        </Button>
      </Sheet>
    );
  }
  if (step === "reported") {
    return (
      <Sheet onClose={onClose}>
        <Title>Thanks</Title>
        <Text className="text-base text-muted-foreground">{`We review reports within 24 hours. You won't see this ${noun(t)} again.`}</Text>
        {!isBlocked && (
          <Button
            variant="outline"
            className="h-12 rounded-full bg-transparent"
            onPress={() => setStep("block")}
          >
            <Text>{`Also block @${t.author}`}</Text>
          </Button>
        )}
        <Button className="h-12 rounded-full" onPress={onClose}>
          <Text>Done</Text>
        </Button>
      </Sheet>
    );
  }
  if (step === "block") {
    return (
      <Sheet onClose={onClose}>
        <Title>{`Block @${t.author}?`}</Title>
        <Text className="text-base text-muted-foreground">{BLOCK_MEANS}</Text>
        <Button
          variant="destructive"
          className="h-12 rounded-full"
          onPress={() => {
            block(t);
            setStep("blocked");
          }}
        >
          <Text>Block</Text>
        </Button>
        <Button variant="ghost" className="rounded-full" onPress={onClose}>
          <Text>Cancel</Text>
        </Button>
      </Sheet>
    );
  }
  if (step === "blocked") {
    return (
      <Sheet onClose={onClose}>
        <Title>{`@${t.author} is blocked`}</Title>
        <Text className="text-base text-muted-foreground">
          Their games and comments are gone for you, and yours for them.
        </Text>
        {!reported && (
          <Button
            variant="outline"
            className="h-12 rounded-full bg-transparent"
            onPress={() => setStep("reasons")}
          >
            <Text>{`Also report this ${noun(t)}`}</Text>
          </Button>
        )}
        <Button className="h-12 rounded-full" onPress={onClose}>
          <Text>Done</Text>
        </Button>
        <Button
          variant="ghost"
          className="rounded-full"
          onPress={() => {
            unblock(t.author);
            onClose();
          }}
        >
          <Text>Undo</Text>
        </Button>
      </Sheet>
    );
  }
  return (
    <Sheet onClose={onClose}>
      <Title>{`@${t.author}`}</Title>
      <Row
        Icon={Flag}
        label={`Report this ${noun(t)}`}
        onPress={() => setStep("reasons")}
      />
      <Row
        Icon={Ban}
        danger
        label={`Block @${t.author}`}
        onPress={() => setStep("block")}
      />
    </Sheet>
  );
};

// C: the flag opens the report form straight away; Block rides along as a switch, or a link for block-only.
const ReportSheet = ({
  target: t,
  onClose,
}: {
  target: Target;
  onClose: () => void;
}) => {
  const [reason, setReason] = useState<string | null>(null);
  const [alsoBlock, setAlsoBlock] = useState(false);
  return (
    <Sheet onClose={onClose}>
      <Title>{`Report ${noun(t)}`}</Title>
      <Reasons value={reason} onChange={setReason} />
      <View className="flex-row items-center gap-3 rounded-2xl bg-background px-4 py-3">
        <View className="flex-1">
          <Text className="text-base">{`Also block @${t.author}`}</Text>
          <Text className="text-sm text-muted-foreground">
            You won’t see each other’s games or comments.
          </Text>
        </View>
        <Switch
          value={alsoBlock}
          onValueChange={setAlsoBlock}
          trackColor={{ true: COLORS.ticket }}
          accessibilityLabel={`Also block @${t.author}`}
        />
      </View>
      <Button
        className="h-12 rounded-full"
        disabled={!reason}
        onPress={() => {
          report(t);
          if (alsoBlock) {
            block(t);
          }
          onClose();
        }}
      >
        <Text>Report</Text>
      </Button>
      <Text className="text-center text-sm text-muted-foreground">
        We review reports within 24 hours.
      </Text>
      <Pressable
        accessibilityRole="button"
        className="items-center py-2"
        onPress={() =>
          Alert.alert(`Block @${t.author}?`, BLOCK_MEANS, [
            { style: "cancel", text: "Cancel" },
            {
              onPress: () => {
                block(t);
                onClose();
              },
              style: "destructive",
              text: "Block",
            },
          ])
        }
      >
        <Text className="text-destructive">{`Just block @${t.author}, don't report`}</Text>
      </Pressable>
    </Sheet>
  );
};

// A: native sheets and alerts only, so it also works on top of the comments sheet.
const pickReason = (t: Target) =>
  ActionSheetIOS.showActionSheetWithOptions(
    {
      cancelButtonIndex: REASONS.length,
      options: [...REASONS, "Cancel"],
      title: `Why are you reporting this ${noun(t)}?`,
    },
    (i) => {
      if (i < REASONS.length) {
        report(t);
        Alert.alert("Thanks", "We review reports within 24 hours.");
      }
    }
  );
const confirmBlock = (t: Target) =>
  Alert.alert(`Block @${t.author}?`, BLOCK_MEANS, [
    { style: "cancel", text: "Cancel" },
    {
      onPress: () => {
        block(t);
        Alert.alert(`@${t.author} is blocked`, `Also report this ${noun(t)}?`, [
          { style: "cancel", text: "Not now" },
          { onPress: () => pickReason(t), text: "Report" },
        ]);
      },
      style: "destructive",
      text: "Block",
    },
  ]);
const overflow = (t: Target, extra?: Extra) => {
  const options = [
    ...(extra ? [extra.label] : []),
    `Report ${noun(t)}`,
    `Block @${t.author}`,
    "Cancel",
  ];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      cancelButtonIndex: options.length - 1,
      destructiveButtonIndex: extra ? 0 : undefined,
      options,
    },
    (i) => {
      const pick = options[i];
      if (extra && pick === extra.label) {
        extra.onPress();
      } else if (pick?.startsWith("Report")) {
        pickReason(t);
      } else if (pick?.startsWith("Block")) {
        confirmBlock(t);
      }
    }
  );
};

/** Render `element` in the list's owner (not the row), so it survives the row disappearing. */
export const useReportBlock = () => {
  const { variant } = usePrototype();
  const { isSignedIn } = useAuth();
  const [sheet, setSheet] = useState<Target | null>(null);
  const open = (t: Target, extra?: Extra) => {
    if (!isSignedIn) {
      return router.push("/sign-in");
    }
    if (variant === "A") {
      overflow(t, extra);
    } else {
      setSheet(t);
    }
  };
  const close = () => setSheet(null);
  let element: ReactNode = null;
  if (sheet && variant === "B") {
    element = <PersonSheet target={sheet} onClose={close} />;
  } else if (sheet && variant === "C") {
    element = <ReportSheet target={sheet} onClose={close} />;
  }
  return { element, open };
};

export const useIsOwn = (author: string | null) =>
  useUser().user?.username === author;

/** A: a "more" pill after Save. C: a flag pill. B: nothing, the byline is the way in. */
export const PrototypeTicketPill = ({ onPress }: { onPress: () => void }) => {
  const { variant } = usePrototype();
  if (variant === "B") {
    return null;
  }
  const Icon = variant === "A" ? MoreHorizontal : Flag;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={variant === "A" ? "More" : "Report"}
      hitSlop={{ bottom: 6, top: 6 }}
      onPress={onPress}
      className="h-8 min-w-8 items-center justify-center rounded-full border-[1.5px] border-primary-foreground/70 px-2 active:bg-primary-foreground/10"
    >
      <Icon size={18} strokeWidth={2.25} color={COLORS.ink} />
    </Pressable>
  );
};

export const PrototypeByline = ({
  author,
  onPress,
}: {
  author: string | null;
  onPress?: () => void;
}) => {
  const { variant } = usePrototype();
  if (variant !== "B" || !onPress) {
    return <Byline author={author} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Report or block"
      onPress={onPress}
      className="flex-row items-center gap-1 self-start"
    >
      <Byline author={author} />
      <ChevronDown size={16} strokeWidth={2.5} color={COLORS.ink} />
    </Pressable>
  );
};

/** One comment row. `onMenu` opens Report/Block; it's undefined on your own comment. */
export const PrototypeComment = ({
  comment,
  onDelete,
  onMenu,
}: {
  comment: { id: number; author: string; body: string; canDelete: boolean };
  onDelete: () => void;
  onMenu?: (extra?: Extra) => void;
}) => {
  const s = usePrototype();
  const t = {
    author: comment.author,
    id: comment.id,
    kind: "comment" as const,
  };
  if (isHidden(s, t)) {
    return (
      <Text className="py-1 text-sm italic text-muted-foreground">
        {isReported(s, t)
          ? "You reported this comment. It's hidden for you."
          : `You blocked @${comment.author}.`}
      </Text>
    );
  }
  const deleteHere = comment.canDelete ? onDelete : undefined;
  let longPress = deleteHere;
  if (s.variant === "A" && onMenu) {
    longPress = () =>
      onMenu(deleteHere && { label: "Delete comment", onPress: deleteHere });
  }
  return (
    <View className="flex-row items-start gap-2">
      <Pressable
        className="flex-1 gap-0.5"
        onLongPress={longPress}
        accessibilityLabel={`@${comment.author}: ${comment.body}`}
      >
        {s.variant === "B" && onMenu ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Report or block"
            hitSlop={6}
            onPress={() => onMenu()}
            className="flex-row items-center gap-1 self-start"
          >
            <Text className="font-strong text-sm text-muted-foreground">
              @{comment.author}
            </Text>
            <ChevronDown size={14} strokeWidth={2.5} color={MIST} />
          </Pressable>
        ) : (
          <Text className="font-strong text-sm text-muted-foreground">
            @{comment.author}
          </Text>
        )}
        <Text className="text-base leading-[22px]">{comment.body}</Text>
      </Pressable>
      {s.variant === "C" && onMenu && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report comment"
          hitSlop={10}
          onPress={() => onMenu()}
          className="pt-1"
        >
          <Flag size={16} color={MIST} />
        </Pressable>
      )}
    </View>
  );
};

const BlockedRows = () => {
  const { blocked } = usePrototype();
  if (!blocked.length) {
    return (
      <Text className="text-muted-foreground">You haven’t blocked anyone.</Text>
    );
  }
  return (
    <View className="gap-2">
      {blocked.map((author) => (
        <View
          key={author}
          className="h-14 flex-row items-center justify-between rounded-2xl bg-card px-4"
        >
          <Text className="font-strong text-base">@{author}</Text>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full bg-transparent"
            onPress={() => unblock(author)}
          >
            <Text>Unblock</Text>
          </Button>
        </View>
      ))}
    </View>
  );
};

/** B: the list sits right on Me. A and C: a row on Me that opens it. */
export const PrototypeBlockedAccounts = () => {
  const { variant, blocked } = usePrototype();
  const [open, setOpen] = useState(false);
  if (variant === "B") {
    return (
      <View className="gap-2">
        <Text className="font-strong text-sm text-muted-foreground">
          BLOCKED ACCOUNTS
        </Text>
        <BlockedRows />
      </View>
    );
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="h-14 flex-row items-center justify-between rounded-2xl bg-card px-4"
      >
        <Text className="text-base">Blocked accounts</Text>
        <Text className="text-muted-foreground">{blocked.length}</Text>
      </Pressable>
      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <Title>Blocked accounts</Title>
          <BlockedRows />
          <Button className="h-12 rounded-full" onPress={() => setOpen(false)}>
            <Text>Done</Text>
          </Button>
        </Sheet>
      )}
    </>
  );
};

// Not part of any design: switches variants and shows the in-memory state.
export const PrototypeBar = () => {
  const s = usePrototype();
  const insets = useSafeAreaInsets();
  if (!__DEV__) {
    return null;
  }
  const i = KEYS.indexOf(s.variant);
  const go = (d: number) =>
    set({ variant: KEYS[(i + d + KEYS.length) % KEYS.length] });
  const blocked = s.blocked.map((a) => `@${a}`).join(" ") || "none";
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center"
      style={{ top: insets.top + 2 }}
    >
      <View className="flex-row items-center rounded-full bg-white px-1 shadow-lg">
        <Pressable
          onPress={() => go(-1)}
          className="h-9 w-9 items-center justify-center"
        >
          <Text className="font-strong text-lg text-black">‹</Text>
        </Pressable>
        <Pressable
          onLongPress={() => set({ blocked: [], last: null, reported: [] })}
          className="items-center px-1"
        >
          <Text className="font-strong text-xs text-black">{`${s.variant} · ${VARIANTS[s.variant]}`}</Text>
          <Text className="text-[10px] text-black/60">{`reported ${s.reported.length} · blocked ${blocked}`}</Text>
        </Pressable>
        <Pressable
          onPress={() => go(1)}
          className="h-9 w-9 items-center justify-center"
        >
          <Text className="font-strong text-lg text-black">›</Text>
        </Pressable>
      </View>
    </View>
  );
};
