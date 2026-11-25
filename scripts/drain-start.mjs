// `npm start`: Next production server with a graceful switch-over behind Traefik (Coolify app „oalab-hub“; rule in
// service-oalab docs/operations/eigener-server.md, „Deploy switch-over“). On SIGTERM the server keeps serving for
// OALAB_DRAIN_MS while its health port answers 503, so Traefik's active health check takes it out of the load balancer
// before Next closes its port; only then does Next's own shutdown run.
import { createServer } from "node:http";

const drainMs = Number(process.env.OALAB_DRAIN_MS ?? 5000);
const healthPort = Number(process.env.OALAB_HEALTH_PORT ?? 3001);
let draining = false;

createServer((_request, response) => {
  response.writeHead(draining ? 503 : 200, { "cache-control": "no-store", "content-type": "text/plain" });
  response.end(draining ? "draining" : "ok");
}).listen(healthPort, "0.0.0.0");

// Next registers its SIGTERM cleanup itself; delay every SIGTERM listener by the drain time.
for (const method of ["on", "addListener", "once"]) {
  const original = process[method].bind(process);
  process[method] = (event, listener) =>
    event === "SIGTERM"
      ? original(event, (...args) => {
          draining = true;
          setTimeout(() => listener(...args), drainMs);
        })
      : original(event, listener);
}

process.argv = [process.argv[0], "next", "start", ...process.argv.slice(2)];
await import("next/dist/bin/next");
