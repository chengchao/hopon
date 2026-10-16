/* oxlint-disable no-await-in-loop, promise/avoid-new, no-promise-executor-return, react/exhaustive-effect-dependencies */
// PROTOTYPE: a stream is read one chunk at a time, with a pause between reconnects.
import { useEffect, useState } from "react";
import { AppState, ScrollView } from "react-native";
import EventSource from "react-native-sse";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { API_URL } from "@/lib/api";

// PROTOTYPE: reads GET /api/sse-test with expo/fetch streaming (or react-native-sse) and logs every event with
// the time, AppState changes and reconnects. Open with exp://127.0.0.1:8081/--/sse-test.
const SseTest = () => {
  const [lines, setLines] = useState<string[]>([]);
  const [query, setQuery] = useState("n=10&ms=500");
  const log = (line: string) => {
    const stamped = `${new Date().toISOString().slice(14, 23)} ${line}`;
    console.log(`[sse] ${stamped}`);
    setLines((old) => [...old, stamped]);
  };

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      log(`AppState ${state}`)
    );
    return () => sub.remove();
  }, []);

  // expo/fetch: parse the stream by hand, reconnect with Last-Event-ID until `done`.
  const runFetch = async () => {
    let lastId = "";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      log(`fetch connect #${attempt} Last-Event-ID=${lastId || "-"}`);
      try {
        const response = await fetch(`${API_URL}/api/sse-test?${query}`, {
          headers: {
            Accept: "text/event-stream",
            ...(lastId ? { "Last-Event-ID": lastId } : {}),
          },
        });
        const reader = response.body?.getReader();
        if (!reader) {
          return log("no response.body reader");
        }
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const field = (name: string) =>
              block
                .split("\n")
                .find((l) => l.startsWith(`${name}:`))
                ?.slice(name.length + 1)
                .trim();
            lastId = field("id") ?? lastId;
            log(`fetch event ${field("event")} id=${field("id") ?? "-"}`);
            if (field("event") === "done") {
              return log("fetch done");
            }
          }
        }
        log("fetch stream ended before done");
      } catch (error) {
        log(`fetch error ${(error as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  // react-native-sse: XHR-based, reconnects itself with Last-Event-ID.
  const runSse = () => {
    const source = new EventSource<"tick" | "done">(
      `${API_URL}/api/sse-test?${query}`,
      { pollingInterval: 1000 }
    );
    source.addEventListener("open", () => log("rn-sse open"));
    source.addEventListener("tick", (e) =>
      log(`rn-sse tick id=${e.lastEventId}`)
    );
    source.addEventListener("done", () => {
      log("rn-sse done");
      source.close();
    });
    source.addEventListener("error", (e) =>
      log(`rn-sse error ${"message" in e ? e.message : e.type}`)
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-2 p-4 pt-16"
    >
      <Button onPress={runFetch}>
        <Text>expo/fetch {query}</Text>
      </Button>
      <Button variant="outline" onPress={runSse}>
        <Text>react-native-sse {query}</Text>
      </Button>
      <Button
        variant="outline"
        onPress={() =>
          setQuery((q) =>
            q === "n=10&ms=500" ? "n=60&ms=1000" : "n=10&ms=500"
          )
        }
      >
        <Text>toggle length</Text>
      </Button>
      <Button variant="outline" onPress={() => setLines([])}>
        <Text>clear</Text>
      </Button>
      {lines.map((line, i) => (
        <Text key={i} className="font-mono text-xs">
          {line}
        </Text>
      ))}
    </ScrollView>
  );
};
export default SseTest;
