// How `npm run dev` starts `next dev` (scripts/dev.mjs). Self-contained, so `node --test` can load it.
// Without HUB_LOCAL_* in .env.local it is plain `next dev`. With HUB_LOCAL_ADMIN_EMAIL the server binds to 127.0.0.1
// and gets HUB_LOCAL_ADMIN_BIND, the switch lib/local-admin.ts asks for; a host of your own (-H/--hostname) turns the
// switch off instead. With HUB_LOCAL_TUNNEL_SCRIPT the tunnel to the OALab server opens before the start and stays
// open (Omed's Mac only, service-oalab/scripts/hub-lokal.sh).

const OWN_HOST = /^(?:-H|--hostname)(?:=|$)/u;
const PORT = /^(?:-p|--port)(?:=(.+))?$/u;

/**
 * @param {Readonly<Record<string, string | undefined>>} localEnv values from .env.local
 * @param {readonly string[]} args extra arguments for `next dev`
 * @param {string | undefined} portEnv PORT from the shell
 */
export function devPlan(localEnv, args, portEnv = undefined) {
  const admin = Boolean(localEnv.HUB_LOCAL_ADMIN_EMAIL?.trim());
  const ownHost = args.some((arg) => OWN_HOST.test(arg));
  const bind = admin && !ownHost;
  let port = portEnv?.trim() || "3000";
  args.forEach((arg, index) => {
    const match = PORT.exec(arg);
    if (match) port = match[1] ?? args[index + 1] ?? port;
  });
  return {
    port,
    args: ["dev", ...(bind ? ["-H", "127.0.0.1"] : []), ...args],
    bind: bind ? "127.0.0.1" : undefined,
    adminOff: admin && ownHost,
    tunnel: localEnv.HUB_LOCAL_TUNNEL_SCRIPT?.trim() || null,
  };
}
