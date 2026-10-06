import { WebView } from "react-native-webview";

import { COLORS } from "@/lib/theme";

// Generated games are untrusted code. The server's CSP (`sandbox allow-scripts`, no network) does the isolating;
// these props keep the WebView from navigating away, opening windows, sharing storage or talking to the app (no onMessage).
export function GameView({
  uri,
  title,
  token,
}: {
  uri: string;
  title: string;
  token?: string;
}) {
  return (
    <WebView
      source={{
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        uri,
      }}
      accessibilityLabel={`Play: ${title}`}
      onShouldStartLoadWithRequest={(request) => request.url === uri}
      incognito
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
}
