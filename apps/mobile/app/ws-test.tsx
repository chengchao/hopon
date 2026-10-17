/* oxlint-disable react/exhaustive-effect-dependencies, react-hooks/exhaustive-deps, react/purity, max-statements, sort-keys, unicorn/prefer-add-event-listener -- PROTOTYPE */
import { useAuth } from "@clerk/expo";
import { useEffect, useRef, useState } from "react";
import { AppState, ScrollView } from "react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { API_URL, api } from "@/lib/api";

// PROTOTYPE for #126 (docs/research/rn-websocket-prototype.md): reads TalkerProto's event log over a WebSocket.
// Applies events by seq (drops duplicates, flags gaps), closes on background and reconnects with since=last on
// active, backs off with jitter, and treats 40 s of silence during a running turn as a lost connection. Every line
// is logged with the time. Open with exp://127.0.0.1:8081/--/ws-test.
const DRAFT = "proto-1";
const SILENCE_MS = 40_000;

interface Message {
  seq: number;
  turn: number;
  type: string;
  data: unknown;
}

const WsTest = () => {
  const { getToken } = useAuth();
  const [lines, setLines] = useState<string[]>([]);
  const [stats, setStats] = useState("");
  const s = useRef({
    attempt: 0,
    duplicates: 0,
    // Bumped to abandon an attempt still awaiting its ticket.
    gen: 0,
    gaps: 0,
    headers: false,
    last: 0,
    // The person pressed Connect and not Disconnect: foregrounding reconnects.
    session: false,
    retry: undefined as ReturnType<typeof setTimeout> | undefined,
    silence: undefined as ReturnType<typeof setTimeout> | undefined,
    status: "unknown",
    wanted: false,
    ws: null as WebSocket | null,
  }).current;

  const log = (line: string) => {
    const stamped = `${new Date().toISOString().slice(11, 23)} ${line}`;
    console.log(`[ws] ${stamped}`);
    setLines((old) => [stamped, ...old].slice(0, 300));
    setStats(
      `last #${s.last} status ${s.status} dup ${s.duplicates} gap ${s.gaps} socket ${s.ws ? "open" : "none"}`
    );
  };

  // Drop the socket without its handlers firing (a dead socket's close can take a long time on iOS).
  const drop = (why: string) => {
    s.gen += 1;
    clearTimeout(s.silence);
    if (s.ws) {
      s.ws.onclose = null;
      s.ws.onmessage = null;
      s.ws.onerror = null;
      s.ws.close(1000, why);
      s.ws = null;
      log(`closed (${why})`);
    }
  };

  const armSilence = () => {
    clearTimeout(s.silence);
    if (s.status === "running") {
      s.silence = setTimeout(() => {
        log(
          `no message for ${SILENCE_MS / 1000} s during a running turn: lost`
        );
        drop("silence");
        // oxlint-disable-next-line no-use-before-define -- mutual recursion with connect.
        reconnectLater();
      }, SILENCE_MS);
    }
  };

  const connect = async () => {
    clearTimeout(s.retry);
    if (!s.wanted || s.ws) {
      return;
    }
    const started = Date.now();
    const gen = s.gen + 1;
    s.gen = gen;
    let first = true;
    // A fetch over a dead keep-alive connection never settles, so an attempt has 10 s to deliver its first message.
    const watchdog = setTimeout(() => {
      if (gen === s.gen) {
        log("no first message 10 s after connect started: abandoned");
        drop("connect timeout");
        // oxlint-disable-next-line no-use-before-define -- mutual recursion with connect.
        reconnectLater();
      }
    }, 10_000);
    try {
      const token = await getToken();
      const base = `${API_URL.replace(/^http/u, "ws")}/api/proto/${DRAFT}/ws?since=${s.last}`;
      let ws: WebSocket;
      if (s.headers) {
        log(`connect (Authorization header) since=${s.last}`);
        // @ts-expect-error -- RN's undocumented third argument; the DOM typings know two.
        ws = new WebSocket(base, [], {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        const { ticket } = await api<{ ticket: string }>(
          `/api/proto/${DRAFT}/ws-ticket`,
          { method: "POST", token }
        );
        if (gen !== s.gen) {
          return;
        }
        log(`ticket in ${Date.now() - started} ms, connect since=${s.last}`);
        ws = new WebSocket(`${base}&ticket=${ticket}`);
      }
      s.ws = ws;
      ws.onopen = () => log(`open in ${Date.now() - started} ms`);
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as Message;
        if (first) {
          first = false;
          clearTimeout(watchdog);
          s.attempt = 0;
          log(`first message ${Date.now() - started} ms after connect started`);
        }
        if (message.type === "state") {
          s.status = (message.data as { status: string }).status;
          log(`state ${JSON.stringify(message.data)}`);
        } else if (message.type === "tick") {
          log(`tick (server latest #${message.seq})`);
        } else if (message.seq <= s.last) {
          s.duplicates += 1;
          log(`DUPLICATE #${message.seq} ${message.type} ignored`);
        } else {
          if (message.seq !== s.last + 1) {
            s.gaps += 1;
            log(`GAP: expected #${s.last + 1}, got #${message.seq}`);
          }
          s.last = message.seq;
          if (message.type === "turn_started") {
            s.status = "running";
          }
          if (message.type === "turn_done" || message.type === "turn_failed") {
            s.status = "idle";
          }
          log(
            `#${message.seq} t${message.turn} ${message.type} ${JSON.stringify(message.data)}`
          );
        }
        armSilence();
      };
      ws.onerror = (event) =>
        log(`error ${(event as { message?: string }).message ?? ""}`);
      ws.onclose = (event) => {
        clearTimeout(watchdog);
        clearTimeout(s.silence);
        s.ws = null;
        log(`onclose ${event.code} ${event.reason}`);
        // oxlint-disable-next-line no-use-before-define -- mutual recursion with connect.
        reconnectLater();
      };
    } catch (error) {
      clearTimeout(watchdog);
      if (gen !== s.gen) {
        return;
      }
      log(`connect failed: ${(error as Error).message}`);
      // oxlint-disable-next-line no-use-before-define -- mutual recursion with connect.
      reconnectLater();
    }
  };

  // Full jitter on 0.5 s · 2^n, capped at 30 s.
  const reconnectLater = () => {
    if (!s.wanted) {
      return;
    }
    s.attempt += 1;
    const delay = Math.round(
      Math.random() * Math.min(30_000, 500 * 2 ** s.attempt)
    );
    log(`reconnect #${s.attempt} in ${delay} ms`);
    clearTimeout(s.retry);
    s.retry = setTimeout(connect, delay);
  };

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      log(`AppState ${state}`);
      if (state === "background") {
        s.wanted = false;
        clearTimeout(s.retry);
        drop("background");
      } else if (state === "active" && s.session && !s.wanted) {
        s.wanted = true;
        s.attempt = 0;
        connect();
      }
    });
    return () => sub.remove();
  }, []);

  const start = (headers: boolean) => {
    s.headers = headers;
    s.session = true;
    s.wanted = true;
    s.attempt = 0;
    connect();
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-2 p-4 pt-16"
    >
      <Button onPress={() => start(false)}>
        <Text>Connect (ticket)</Text>
      </Button>
      <Button variant="outline" onPress={() => start(true)}>
        <Text>Connect (headers option)</Text>
      </Button>
      <Button
        variant="outline"
        onPress={async () => {
          const result = await api(`/api/proto/${DRAFT}/turn`, {
            method: "POST",
            token: await getToken(),
          }).catch((error: Error) => error.message);
          log(`POST turn ${JSON.stringify(result)}`);
        }}
      >
        <Text>Start turn</Text>
      </Button>
      <Button
        variant="outline"
        onPress={() => {
          s.session = false;
          s.wanted = false;
          clearTimeout(s.retry);
          drop("button");
        }}
      >
        <Text>Disconnect</Text>
      </Button>
      <Text className="font-mono text-xs">{stats}</Text>
      {lines.map((line, i) => (
        <Text key={i} className="font-mono text-xs">
          {line}
        </Text>
      ))}
    </ScrollView>
  );
};
export default WsTest;
