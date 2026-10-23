// The Make tab's WebSocket to a Draft's Talker (#126, #147). Each connect fetches a one-time ticket, then opens the
// socket, whose first frame is a snapshot of the whole chat. Messages and Stop are POSTs, so they work while this is
// down; the socket only brings the Maker's side.
import { addEventListener as onNetInfo } from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { api, API_URL } from "@/lib/api";
import type { Frame } from "@/lib/maker-chat";

// The Talker closes a socket that hasn't pinged for 60 s while a turn runs, and answers each ping with "pong".
const PING_MS = 20_000;
// No frame and no pong for this long is a lost connection, even if the socket never closed (#126).
const SILENCE_MS = 40_000;
// RN's fetch and WebSocket have no timeout of their own: a ticket and a snapshot must arrive within this.
const ATTEMPT_MS = 10_000;
// "Reconnecting…" becomes "Can't reach the Maker" after this.
const UNREACHABLE_MS = 30_000;
// A long backoff mid-turn cost the prototype 18–23 s of a live reply (#126).
const TURN_BACKOFF_MS = 5000;
const IDLE_BACKOFF_MS = 30_000;
const FIRST_BACKOFF_MS = 500;

export type Link = "connecting" | "open" | "reconnecting" | "unreachable";

export const useMakerSocket = ({
  draft,
  getToken,
  running,
  onFrame,
}: {
  draft: string | undefined;
  getToken: () => Promise<string | null>;
  running: boolean;
  onFrame: (frame: Frame) => void;
}) => {
  const [link, setLink] = useState<Link>("connecting");
  // Clerk's getToken and the screen's callbacks change on every render; the socket reads their latest.
  const latest = useRef({ getToken, onFrame, running });
  useEffect(() => {
    latest.current = { getToken, onFrame, running };
  });
  const reconnect = useRef<() => void>();

  useEffect(() => {
    if (!draft) {
      return;
    }
    let socket: WebSocket | undefined;
    // Bumped on every drop, so a late ticket or frame from an earlier attempt is ignored.
    let attempt = 0;
    let failures = 0;
    let down = false;
    let away = false;
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const clear = (...names: string[]) => {
      for (const name of names) {
        clearTimeout(timers[name]);
        clearInterval(timers[name]);
      }
    };

    const drop = () => {
      attempt += 1;
      clear("attempt", "silence", "ping", "retry");
      const closing = socket;
      socket = undefined;
      closing?.close();
    };

    const lost = () => {
      drop();
      if (away) {
        return;
      }
      if (!down) {
        down = true;
        setLink("reconnecting");
        timers.unreachable = setTimeout(
          () => setLink("unreachable"),
          UNREACHABLE_MS
        );
      }
      const cap = latest.current.running ? TURN_BACKOFF_MS : IDLE_BACKOFF_MS;
      timers.retry = setTimeout(
        // oxlint-disable-next-line no-use-before-define -- connect and lost call each other.
        connect,
        Math.min(cap, FIRST_BACKOFF_MS * 2 ** failures)
      );
      failures += 1;
    };

    // Any frame, or the pong to a ping, proves the socket alive.
    const heard = () => {
      clear("silence");
      timers.silence = setTimeout(lost, SILENCE_MS);
    };

    const open = (ticket: string) => {
      const ws = new WebSocket(
        `${API_URL.replace(/^http/u, "ws")}/api/drafts/${draft}/ws?ticket=${ticket}`
      );
      socket = ws;
      ws.addEventListener("open", () => {
        heard();
        timers.ping = setInterval(() => ws.send("ping"), PING_MS);
      });
      ws.addEventListener("message", ({ data }) => {
        if (socket !== ws) {
          return;
        }
        heard();
        if (data === "pong") {
          return;
        }
        const frame = JSON.parse(data) as Frame;
        if (frame.type === "snapshot") {
          clear("attempt", "unreachable");
          failures = 0;
          down = false;
          setLink("open");
        }
        latest.current.onFrame(frame);
      });
      ws.addEventListener("close", () => {
        if (socket === ws) {
          lost();
        }
      });
    };

    const connect = async () => {
      drop();
      const mine = attempt;
      timers.attempt = setTimeout(lost, ATTEMPT_MS);
      try {
        const { ticket } = await api<{ ticket: string }>(
          `/api/drafts/${draft}/ws-ticket`,
          { method: "POST", token: await latest.current.getToken() }
        );
        if (mine === attempt) {
          open(ticket);
        }
      } catch {
        if (mine === attempt) {
          lost();
        }
      }
    };

    // Retry, or the network or the app coming back: try at once.
    const now = () => {
      if (!away && !socket) {
        failures = 0;
        // Retry starts the ~30 s over.
        if (down) {
          down = false;
          clear("unreachable");
          setLink("reconnecting");
        }
        connect();
      }
    };
    reconnect.current = now;

    // `background`, not `inactive`: pulling down Control Center keeps the socket (#126).
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        away = true;
        clear("unreachable");
        drop();
      } else if (state === "active" && away) {
        away = false;
        now();
      }
    });
    let online = true;
    const netInfo = onNetInfo((state) => {
      const back = state.isConnected !== false && !online;
      online = state.isConnected !== false;
      if (back) {
        now();
      }
    });
    connect();
    return () => {
      away = true;
      appState.remove();
      netInfo();
      clear("unreachable");
      drop();
    };
  }, [draft]);

  const retry = useCallback(() => reconnect.current?.(), []);
  return { link, retry };
};
