import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";

import { COLORS } from "@/lib/theme";

// Generated games are untrusted code. The server's CSP (`sandbox allow-scripts`, no network) does the isolating;
// these props keep the WebView from navigating away, opening windows or sharing storage.
// PROTOTYPE: `active`/`muted` drive the runtime's bridge ({type:'pause'|'resume'|'mute'}), and onMessage logs what
// the page reports back. `gesture` flips mediaPlaybackRequiresUserAction to compare both settings.
export const GameView = ({
  uri,
  title,
  token,
  active = true,
  muted = false,
  gesture = true,
}: {
  uri: string;
  title: string;
  token?: string;
  active?: boolean;
  muted?: boolean;
  gesture?: boolean;
}) => {
  const view = useRef<WebView>(null);
  const send = (message: object) =>
    view.current?.postMessage(JSON.stringify(message));
  const sync = () => {
    send({ on: muted, type: "mute" });
    send({ type: active ? "resume" : "pause" });
  };
  useEffect(() => {
    send({ type: active ? "resume" : "pause" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `send` is new each render; only the prop matters.
  }, [active]);
  useEffect(() => {
    send({ on: muted, type: "mute" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- as above.
  }, [muted]);
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
      onMessage={(e) =>
        console.log(
          `[audio] ${uri.split("/").at(-2)} ${active ? "ACTIVE" : "offscreen"} ${e.nativeEvent.data}`
        )
      }
      incognito
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={gesture}
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      style={{ backgroundColor: COLORS.raised, flex: 1 }}
    />
  );
};
