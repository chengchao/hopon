import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";

import { COLORS } from "@/lib/theme";

// Generated games are untrusted code. The server's CSP (`sandbox allow-scripts`, no network) does the isolating, and
// its opaque origin gets no storage; these props keep the WebView from navigating away, opening windows or talking to
// the app (no onMessage). Not incognito, so the runtime (/runtime/v1.js) stays cached between games.
// The app talks to the game, one way: the runtime pauses while `active` is false and goes silent while `muted`.
export const GameView = ({
  uri,
  title,
  token,
  active = true,
  muted = false,
}: {
  uri: string;
  title: string;
  token?: string;
  active?: boolean;
  muted?: boolean;
}) => {
  const view = useRef<WebView>(null);
  const sync = () => {
    view.current?.postMessage(
      JSON.stringify({ type: active ? "resume" : "pause" })
    );
    view.current?.postMessage(JSON.stringify({ on: muted, type: "mute" }));
  };
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `sync` is new each render; only the props matter.
  useEffect(sync, [active, muted]);
  return (
    <WebView
      ref={view}
      source={{
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        uri,
      }}
      accessibilityLabel={`Play: ${title}`}
      onShouldStartLoadWithRequest={(request) => request.url === uri}
      onLoadEnd={sync}
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
