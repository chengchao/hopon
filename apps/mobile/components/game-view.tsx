import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { WebView } from "react-native-webview";

import { t } from "@/lib/i18n";
import { COLORS } from "@/lib/theme";

// Generated games are untrusted code. The server's CSP (`sandbox allow-scripts`, no network) does the isolating, and
// its opaque origin gets no storage; these props keep the WebView from navigating away, opening windows or talking to
// the app (no onMessage). Not incognito, so the runtime (/runtime/v3.js) stays cached between games.
// The app talks to the game, one way: the runtime pauses while `active` is false or the app is in the background, and
// goes silent while `muted`. Its audio session is "playback" (#213), which iOS keeps playing in the background.
export const GameView = ({
  uri,
  title,
  token,
  active = true,
  muted = false,
  onCrash,
}: {
  uri: string;
  title: string;
  token?: string;
  active?: boolean;
  muted?: boolean;
  // WebKit killed the game's content process; the WebView stays blank until reloaded.
  onCrash?: () => void;
}) => {
  const view = useRef<WebView>(null);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active"
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active")
    );
    return () => subscription.remove();
  }, []);
  const playing = active && foreground;
  const sync = () => {
    view.current?.postMessage(
      JSON.stringify({ type: playing ? "resume" : "pause" })
    );
    view.current?.postMessage(JSON.stringify({ on: muted, type: "mute" }));
  };
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `sync` is new each render; only these matter.
  useEffect(sync, [playing, muted]);
  return (
    <WebView
      ref={view}
      source={{
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        uri,
      }}
      accessibilityLabel={t.feed.play(title)}
      onShouldStartLoadWithRequest={(request) => request.url === uri}
      onLoadEnd={sync}
      onContentProcessDidTerminate={onCrash}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      style={{ backgroundColor: COLORS.raised, flex: 1 }}
    />
  );
};
