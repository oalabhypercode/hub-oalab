// `npm run dev`. Plain `next dev`, unless .env.local switches on the local extras (scripts/lib/dev-plan.mjs):
// - HUB_LOCAL_TUNNEL_SCRIPT: opens the tunnel to the OALab database and PostgREST first, checks it every 20 s and
//   reopens it (sleep, network change), closes it when the server stops. Without it the hub fails with ECONNREFUSED.
// - HUB_LOCAL_ADMIN_EMAIL: loopback only, signed in as that admin (lib/local-admin.ts).
// Reads only these two names from .env.local; Next loads the rest itself. Values are never printed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { devPlan } from "./lib/dev-plan.mjs";

const file = new URL("../.env.local", import.meta.url);
const values = existsSync(file) ? parseEnv(readFileSync(file, "utf8").replace(/^\uFEFF/u, "")) : {};
const plan = devPlan(
  { HUB_LOCAL_ADMIN_EMAIL: values.HUB_LOCAL_ADMIN_EMAIL, HUB_LOCAL_TUNNEL_SCRIPT: values.HUB_LOCAL_TUNNEL_SCRIPT },
  process.argv.slice(2),
  process.env.PORT,
);
const say = (line) => console.log(`[hub] ${line}`);

let tunnelBusy = false;
let tunnelDown = false;
let watch;
if (plan.tunnel) {
  if (!existsSync(plan.tunnel)) {
    say(`Tunnel-Skript fehlt (HUB_LOCAL_TUNNEL_SCRIPT in .env.local), ohne Tunnel keine Daten.`);
  } else {
    const first = spawnSync("sh", [plan.tunnel, "tunnel"], { stdio: "inherit" });
    if (first.status !== 0) {
      tunnelDown = true;
      say("Tunnel zum OALab-Server ist nicht aufgegangen; neuer Versuch alle 20 s. Bis dahin fehlen die Daten.");
    }
    watch = setInterval(checkTunnel, 20_000);
  }
}

function checkTunnel() {
  if (tunnelBusy) return;
  tunnelBusy = true;
  const run = spawn("sh", [plan.tunnel, "tunnel"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  run.stdout.on("data", (chunk) => { output += chunk; });
  run.stderr.on("data", (chunk) => { output += chunk; });
  run.on("close", (code) => {
    tunnelBusy = false;
    if (code !== 0) {
      if (!tunnelDown) say(`Tunnel weg, neuer Versuch in 20 s (${output.trim().split("\n").at(-1) || `Code ${code}`})`);
      tunnelDown = true;
    } else if (tunnelDown || output.includes("Tunnel offen")) {
      tunnelDown = false;
      say("Tunnel wieder offen.");
    }
  });
}

if (plan.bind) say(`Lokal immer Admin: http://localhost:${plan.port} öffnet ohne Anmeldung (nur auf diesem Rechner).`);
if (plan.adminOff) say("Eigener Host (-H): Lokal immer Admin ist dafür aus.");

const env = { ...process.env };
if (plan.bind) env.HUB_LOCAL_ADMIN_BIND = plan.bind;
else delete env.HUB_LOCAL_ADMIN_BIND;
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, ...plan.args], { stdio: "inherit", env });

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stopping = true;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}
child.on("exit", (code, signal) => {
  clearInterval(watch);
  if (plan.tunnel && existsSync(plan.tunnel)) spawnSync("sh", [plan.tunnel, "tunnel-stop"], { stdio: "ignore" });
  process.exit(code ?? (signal && !stopping ? 1 : 0));
});
