# React Native WebSocket to a hibernating Durable Object: prototype

A throwaway spike on branch `prototype/rn-websocket`, for map #111's transport decision (ticket #126). Run 2026-10-16 on the iOS 26.3 simulator (iPhone 16e) in Expo Go (SDK 57, React Native 0.86.3) against `wrangler dev --local` (wrangler 4.130). The app was signed in to the Clerk test account. Logs are in [`rn-websocket-prototype/`](rn-websocket-prototype/). App lines are `[ws] <UTC time> …` from Metro, and Durable Object lines are `[talker <UTC time> <instance>] …` from wrangler. `<instance>` is a random id made in the constructor, so a new id means the object was built again: after a wake from hibernation, or after a restart.

## Verdict

**The transport decision holds:** a WebSocket with the Hibernation API, reconnecting with `since=N`, a tick every 15 s, a 40 s silence rule, POSTs for commands. Every check passed with no gap and no duplicate. The prototype adds four requirements to the spec:

1. Cap the reconnect backoff low while a turn is running (about 5 s), or retry at once when the network comes back.
2. The Talker enforces its turn limit with a timer that aborts the Coder call.
3. The Talker prunes sockets that went silent without closing.
4. The connect attempt gets a timeout.

## Answers

1. **Auth on the upgrade works in Expo Go.** `POST /api/proto/:id/ws-ticket` (Clerk Bearer) took 17–64 ms, then `new WebSocket(…/ws?ticket=…&since=N)` reached the Durable Object through the Worker. The first message arrived 57–157 ms after the attempt started. The exception was the first attempt after an API restart: 647 ms, of which the ticket took 562 ms. The ticket is single-use: the Durable Object deletes the row when it accepts the socket.

   **RN's undocumented `{ headers }` third argument works on iOS.** The Worker saw `Authorization=present`, verified the Clerk JWT, and the socket opened in 229 ms ([e](rn-websocket-prototype/e-headers-option.log)). Keep the ticket anyway: the headers option is documented nowhere, and the ticket works for any client. The headers option is a fallback that works today.

2. **Reconnect and replay are clean.**
   - **Backgrounded 50 s mid-turn** ([b](rn-websocket-prototype/b-background-45s.log)): the app closed the socket on `background`. On `active` it reconnected with `since=32`. The Durable Object replayed #33–#43, and `turn_done` (#44) followed live. **Reconnect time: 157 ms from `active` to the first message** (ticket 64 ms, upgrade 92 ms, all local).
   - **Network dead for 60 s mid-turn** ([c](rn-websocket-prototype/c-dead-socket-60s.log)): **the 40 s rule fired 40.002 s after the last message.** After the network came back, the app replayed #70–#87 with `since=69`, `turn_done` included.
   - Across all runs, no event arrived twice and none was skipped. The `DUPLICATE`/`GAP` counters stayed at 0.
3. **Hibernation behaves as the plan assumes** ([d](rn-websocket-prototype/d-hibernation.log)).
   - **During a turn** the object kept one instance id from `turn_started` to `turn_done`, including the 40 s stretch where only ticks went out. It stayed awake.
   - **Between turns** it hibernated with the socket held. Each later POST built a new instance that reported "22 events, 1 sockets held" (and later 44, 65, 87). Events from the new turn reached the socket opened before the hibernation. The SQLite log was intact every time.
   - A client's close also wakes the object (`webSocketClose`), which is cheap.

   This was local workerd. Production's idle timeout was not measured; here the object had hibernated by the next request, 18–50 s after its last activity.

## What was built

- **Worker** ([`apps/api/src/proto-talker.ts`](../../apps/api/src/proto-talker.ts), routes at the top and bottom of [`index.ts`](../../apps/api/src/index.ts), binding and `new_sqlite_classes` migration in `wrangler.jsonc`):
  - `TalkerProto` is a SQLite-backed Durable Object with two tables: `events(seq, turn, type, data)` and `tickets(ticket, expires)`.
  - `POST /api/proto/:id/turn` starts a fake turn: `turn_started`, 10 steps 1 s apart, a 40 s quiet stretch (the Coder building), 10 more steps, then `turn_done` once a pending 60 s `fetch` to `/api/proto/slow` answers. That makes 22 logged events. A `tick` goes out every 15 s. Ticks are not logged: they carry the latest seq and only prove the socket is alive.
  - `POST /api/proto/:id/ws-ticket` (behind the existing Clerk check on `/api` writes) returns a one-time ticket that lasts 60 s.
  - `GET /api/proto/:id/ws?ticket=…&since=N` is registered before the middleware, because the middleware sets headers on every response, the 101 included. It forwards to the Durable Object. The Durable Object consumes the ticket, calls `ctx.acceptWebSocket`, and sends `{seq, turn, type: "state", data: {status, turn, latest}}`, then every event after `N`. All of this runs synchronously inside `fetch`, so no append can fall between the state message and the replay.
- **App** ([`apps/mobile/app/ws-test.tsx`](../../apps/mobile/app/ws-test.tsx), open with `exp://127.0.0.1:8081/--/ws-test`):
  - Applies events by seq: drops `seq <= last` as a duplicate and flags `seq != last + 1` as a gap.
  - On `background`, closes the socket. On `active`, reconnects with `since=last`.
  - Reconnects with full-jitter backoff: a random wait up to 0.5 s · 2^n, capped at 30 s.
  - Treats 40 s with no message while `status` is `running` as a lost connection.
  - Gives each attempt 10 s to deliver its first message.
- **Dead network** ([`blackhole-proxy.mjs`](rn-websocket-prototype/blackhole-proxy.mjs)): the simulator has no airplane mode, and cutting the Mac's network leaves localhost up. Instead, the app ran through a TCP proxy (`EXPO_PUBLIC_API_URL=http://localhost:8788`). On `SIGUSR1` the proxy keeps open sockets open but drops every byte, with no FIN and no RST, and resets new connections. That is the worst case for detecting a dead socket. On `SIGUSR2` it accepts new connections again.

## Findings for the spec

- **The backoff cap is too high for a running turn.** In (c) the network came back at 03:27:20.3, but the app sat in a 28.7 s wait and reconnected at 03:27:43.2: 23 s of avoidable delay (the first run had 18.5 s). During a turn, cap the backoff at about 5 s, or reset it when the network returns (NetInfo) or on `active`. The ticket POST is cheap, so a few extra attempts cost little.
- **The Talker must enforce its own turn deadline.** In the first run of (c) ([c0](rn-websocket-prototype/c0-coder-fetch-also-silenced.log)), the Durable Object's stand-in Coder fetch also went through the proxy, so it was silenced too. The fetch never settled, and the turn never ended: it ticked every 15 s until the API was restarted. That was a test-setup accident, and the rerun sent the Coder fetch straight to `:8787`. But it is exactly what a lost Coder response does. The map's 5-minute turn limit has to be an abort timer on the Coder call that appends `turn_failed`, not just a count.
- **Silent dead sockets stay in `getWebSockets()`.** After (c), the Durable Object held 2 sockets: the silenced one never closed, and it even survived hibernation. Broadcasting to it is harmless at this scale, but it grows with every lost connection. Prune it: `setWebSocketAutoResponse` with an app ping, and close sockets whose `getWebSocketAutoResponseTimestamp` is old. Or close all sockets a while after `turn_done`, since the app reconnects with `since` anyway.
- **A connect attempt needs a timeout.** React Native's `fetch` has none. Here new connections were reset, so the 10 s watchdog never fired. On a real dead keep-alive connection, though, the ticket POST could hang forever.
- **Act on `background`, not `inactive`.** iOS reported `inactive` about 4 s before `background`, and events kept arriving in between ([b](rn-websocket-prototype/b-background-45s.log)).
- **A server restart works like a deploy.** Restarting `wrangler dev` closed the socket cleanly. The app backed off, reconnected on its third attempt with `since=65`, and was in sync.

## Not covered

- **A real device.** The simulator never suspends a backgrounded app, so the app closing its own socket on `background` is the only behaviour seen. Real airplane mode may error the socket at once, which is better than the silence emulated here. The 40 s rule covers the case where it doesn't.
- **Production hibernation timing and billing.** Everything ran on local workerd.
- **Whether a pending `fetch` alone keeps the object awake.** During the turn the tick interval and the step timers were pending too, as they will be in the real Talker.
- **Draft ownership.** The prototype's ticket route accepts any signed-in account. The real `ws-ticket` checks that the caller owns the Draft.
