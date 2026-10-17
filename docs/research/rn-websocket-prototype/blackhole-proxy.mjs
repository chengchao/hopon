// PROTOTYPE for #126: stands in for airplane mode, which the iOS Simulator lacks. Forwards localhost:<listen> to
// localhost:<target>. `kill -USR1` goes dark: open sockets stay open but every byte is dropped both ways (no FIN, no
// RST, the worst case for detecting a dead socket), and new connections are reset (a request fails fast, as offline).
// `kill -USR2` accepts new connections again; silenced sockets stay silent.
// Usage: node blackhole-proxy.mjs 8788 8787
import net from "node:net";

const [listen, target] = process.argv.slice(2).map(Number);
const log = (line) =>
  console.log(`[proxy ${new Date().toISOString().slice(11, 23)}] ${line}`);
let dark = false;
const live = new Set();

net
  .createServer((client) => {
    if (dark) {
      log("reset a new connection");
      client.destroy();
      return;
    }
    const upstream = net.connect(target, "127.0.0.1");
    const pair = { dead: false };
    live.add(pair);
    client.on("data", (data) => pair.dead || upstream.write(data));
    upstream.on("data", (data) => pair.dead || client.write(data));
    const end = () => {
      live.delete(pair);
      if (!pair.dead) {
        client.destroy();
        upstream.destroy();
      }
    };
    client.on("close", end);
    upstream.on("close", end);
    client.on("error", () => null);
    upstream.on("error", () => null);
  })
  .listen(listen, () => log(`${listen} -> ${target}`));

process.on("SIGUSR1", () => {
  dark = true;
  for (const pair of live) {
    pair.dead = true;
  }
  log(`dark: ${live.size} open sockets silenced, new connections reset`);
});
process.on("SIGUSR2", () => {
  dark = false;
  log("light: new connections accepted");
});
