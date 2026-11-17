import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

// lib/hub-mcp imports its neighbours without extension, as the bundler resolves them; Node needs the ".ts".
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.includes("/lib/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const config = await import("../lib/hub-mcp/config.ts");
const oauth = await import("../lib/hub-mcp/oauth.ts");
const protocol = await import("../lib/hub-mcp/protocol.ts");
const tools = await import("../lib/hub-mcp/tools.ts");
const input = await import("../lib/hub-mcp/write-input.ts");
const rules = await import("../lib/hub-calendar/rules.ts");
const projectEdit = await import("../lib/hub-projects/edit.ts");

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const origin = "https://hub.oalab.de";

test("the switch: off unless HUB_MCP_ENABLED says on", () => {
  assert.equal(config.mcpEnabled({}), false);
  assert.equal(config.mcpEnabled({ HUB_MCP_ENABLED: "0" }), false);
  assert.equal(config.mcpEnabled({ HUB_MCP_ENABLED: "1" }), true);
  assert.equal(config.mcpEnabled({ HUB_MCP_ENABLED: " true " }), true);
});

test("the proxy leaves exactly Claude's addresses alone; the consent page needs a session", async () => {
  for (const path of ["/api/mcp", "/api/mcp/oauth/authorize", "/api/mcp/oauth/token", "/api/mcp/oauth/revoke", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server"]) {
    assert.equal(config.isConnectorPath(path), true, path);
  }
  for (const path of ["/dashboard/settings/claude", "/api/mcpx", "/api/calendar/abc", "/.well-known/openid-configuration", "/auth/login", "/"]) {
    assert.equal(config.isConnectorPath(path), false, path);
  }
  assert.ok(config.CONSENT_PATH.startsWith("/dashboard/"), "a visitor without session signs in and comes back");
  const proxy = await source("lib/supabase/proxy.ts");
  const bypass = proxy.indexOf("if (isConnectorPath(pathname)) return supabaseResponse;");
  assert.ok(bypass > 0, "connector paths skip the session work");
  assert.ok(bypass < proxy.indexOf("createPlatformServerClient("), "before any session is read");
});

test("keys: random, stored only as SHA-256, PKCE S256 as in RFC 7636", async () => {
  const one = oauth.newSecret();
  assert.match(one, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(one, oauth.newSecret());
  assert.match(oauth.secretHash(one), /^[0-9a-f]{64}$/);
  // RFC 7636, appendix B.
  assert.equal(oauth.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(oauth.pkceMatches("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), true);
  assert.equal(oauth.pkceMatches("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXX", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), false);
  assert.equal(oauth.pkceMatches("short", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), false);
  assert.equal(oauth.pkceMatches(undefined, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), false);

  // The store never writes a key itself, only its checksum.
  const store = await source("lib/hub-mcp/store.ts");
  for (const statement of store.match(/insert into public\.hub_claude_connections[\s\S]*?\]\s*,?\s*\)/g) ?? []) {
    assert.doesNotMatch(statement, /keys\.(access|refresh)\s*[,\]]/, "raw keys never reach the table");
  }
  assert.match(store, /secretHash\(keys\.access\)/);
  assert.match(store, /secretHash\(keys\.refresh\)/);
});

test("only Claude's apps with Claude's return address get as far as the question", () => {
  assert.equal(oauth.readClientId("https://claude.ai/oauth/mcp-client-metadata"), "https://claude.ai/oauth/mcp-client-metadata");
  assert.equal(oauth.readClientId("https://claude.com/x/metadata.json"), "https://claude.com/x/metadata.json");
  for (const value of ["http://claude.ai/x", "https://evil.example/x", "https://claude.ai.evil.example/x", "https://claude.ai", "https://claude.ai/", "https://claude.ai:8443/x", "https://user:pw@claude.ai/x", "https://claude.ai/x#frag", "https://CLAUDE.ai/x", "claude.ai/x", null, 42]) {
    assert.equal(oauth.readClientId(value), null, String(value));
  }

  const clientId = "https://claude.ai/oauth/mcp-client-metadata";
  const good = { client_id: clientId, client_name: "Claude\u0007  ", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none" };
  const checked = oauth.checkClientDocument(good, clientId);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.name, "Claude");
  assert.equal(oauth.checkClientDocument({ ...good, client_id: "https://claude.ai/other" }, clientId).ok, false);
  assert.equal(oauth.checkClientDocument({ ...good, redirect_uris: [] }, clientId).ok, false);
  assert.equal(oauth.checkClientDocument({ ...good, token_endpoint_auth_method: "client_secret_basic" }, clientId).ok, false);
  assert.equal(oauth.checkClientDocument([good], clientId).ok, false);

  const document = { name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"] };
  assert.equal(oauth.pickRedirect("https://claude.ai/api/mcp/auth_callback", document), "https://claude.ai/api/mcp/auth_callback");
  assert.equal(oauth.pickRedirect("https://evil.example/cb", document), null, "listed in the document, but not Claude's own");
  assert.equal(oauth.pickRedirect("https://claude.com/api/mcp/auth_callback", document), null, "Claude's, but not in this document");
  assert.equal(oauth.pickRedirect(null, document), "https://claude.ai/api/mcp/auth_callback", "the only allowed one");
});

test("rights: reading always, writing only when asked and offered; the request is checked before the admin sees it", async () => {
  assert.deepEqual(config.OFFERED_SCOPES, ["hub:read", "hub:write"], "step 3 offers writing");
  assert.deepEqual(oauth.grantScopes(undefined), ["hub:read"]);
  assert.deepEqual(oauth.grantScopes("hub:read"), ["hub:read"], "reading only, when Claude asks for no more");
  assert.deepEqual(oauth.grantScopes("hub:read hub:write offline_access"), ["hub:read", "hub:write"], "Claude asks for every offered right");
  assert.deepEqual(oauth.grantScopes("hub:write", ["hub:read"]), ["hub:read"], "never more than offered");
  // The consent page says what writing means before „Erlauben“.
  assert.match(await source("lib/hub-mcp/consent.ts"), /writes: pending\.scopes\.includes\("hub:write"\)/);
  assert.match(await source("components/hub/claude-consent.tsx"), /\{state\.writes && <p [^>]*>Vor jeder Änderung fragt Claude dich, ob es sie machen darf/);
  assert.match(await source("components/hub/connected-apps-card.tsx"), /Trenne sie und verbinde Claude neu, dann darf Claude auch eintragen\./, "old read-only connections learn how to write");

  const params = (extra = {}) => ({ responseType: "code", clientId: "x", redirectUri: null, state: "s", codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", codeChallengeMethod: "S256", scope: null, resource: null, ...extra });
  assert.equal(oauth.authorizeProblem(params(), origin), null);
  assert.equal(oauth.authorizeProblem(params({ resource: `${origin}/api/mcp/` }), origin), null, "a trailing slash is the same address");
  assert.equal(oauth.authorizeProblem(params({ responseType: "token" }), origin).error, "unsupported_response_type");
  assert.equal(oauth.authorizeProblem(params({ codeChallenge: null }), origin).error, "invalid_request");
  assert.equal(oauth.authorizeProblem(params({ codeChallengeMethod: "plain" }), origin).error, "invalid_request");
  assert.equal(oauth.authorizeProblem(params({ resource: "https://other.example/mcp" }), origin).error, "invalid_target");

  const back = oauth.withParams("https://claude.ai/api/mcp/auth_callback?x=1", { code: "abc", state: "s t", iss: origin, error: null });
  const url = new URL(back);
  assert.equal(url.searchParams.get("x"), "1");
  assert.equal(url.searchParams.get("code"), "abc");
  assert.equal(url.searchParams.get("state"), "s t");
  assert.equal(url.searchParams.has("error"), false);
});

test("metadata: what Claude reads first, as RFC 8414, RFC 9728 and the MCP authorization spec ask", () => {
  const server = oauth.authorizationServerMetadata(origin);
  assert.equal(server.issuer, origin);
  assert.equal(server.authorization_endpoint, `${origin}/api/mcp/oauth/authorize`);
  assert.equal(server.token_endpoint, `${origin}/api/mcp/oauth/token`);
  assert.equal(server.revocation_endpoint, `${origin}/api/mcp/oauth/revoke`);
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(server.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(server.client_id_metadata_document_supported, true, "Claude uses its metadata document instead of registering");
  assert.equal("registration_endpoint" in server, false, "no dynamic registration");
  assert.deepEqual(server.scopes_supported, ["hub:read", "hub:write"]);

  const resource = oauth.protectedResourceMetadata(origin);
  assert.equal(resource.resource, `${origin}/api/mcp`);
  assert.deepEqual(resource.authorization_servers, [origin]);
  assert.deepEqual(resource.bearer_methods_supported, ["header"]);

  const challenge = oauth.bearerChallenge(origin, "invalid_token");
  assert.match(challenge, /^Bearer /);
  assert.match(challenge, /resource_metadata="https:\/\/hub\.oalab\.de\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  assert.match(challenge, /error="invalid_token"/);
  assert.equal(oauth.tokenResponse({ access: "a", refresh: "r" }, ["hub:read"]).expires_in, config.ACCESS_TOKEN_SECONDS);
});

test("protocol: initialize, ping, tools/list, tools/call and the errors of JSON-RPC", async () => {
  const calls = [];
  const context = {
    tools: [{ name: "search", title: "S", description: "d", inputSchema: { type: "object" }, annotations: {} }],
    instructions: "Hinweise",
    callTool: async (name, args) => {
      calls.push([name, args]);
      if (name === "boom") throw new Error("x");
      return name === "search" ? { content: [{ type: "text", text: "{}" }] } : null;
    },
  };
  const ask = (message) => protocol.answerMessage(message, context);

  const init = await ask({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(init.body.result.serverInfo.name, "oalab-hub");
  assert.equal(init.body.result.instructions, "Hinweise");
  assert.equal((await ask({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } })).body.result.protocolVersion, protocol.PROTOCOL_VERSIONS[0]);

  assert.deepEqual(await ask({ jsonrpc: "2.0", method: "notifications/initialized" }), { status: 202, body: null });
  assert.deepEqual(await ask({ jsonrpc: "2.0", id: 9, result: {} }), { status: 202, body: null });
  assert.deepEqual((await ask({ jsonrpc: "2.0", id: "p", method: "ping" })).body, { jsonrpc: "2.0", id: "p", result: {} });
  assert.deepEqual((await ask({ jsonrpc: "2.0", id: 3, method: "tools/list" })).body.result.tools, context.tools);

  const called = await ask({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search", arguments: { query: "x" } } });
  assert.deepEqual(called.body.result, { content: [{ type: "text", text: "{}" }] });
  assert.deepEqual(calls.at(-1), ["search", { query: "x" }]);
  assert.equal((await ask({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } })).body.error.code, -32602);
  assert.equal((await ask({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search", arguments: [] } })).body.error.code, -32602);
  assert.equal((await ask({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "boom" } })).body.error.code, -32603);
  assert.equal((await ask({ jsonrpc: "2.0", id: 8, method: "resources/list" })).body.error.code, -32601);

  for (const bad of [[{ jsonrpc: "2.0", id: 1, method: "ping" }], { id: 1, method: "ping" }, { jsonrpc: "2.0", id: null, method: "ping" }, { jsonrpc: "2.0", id: 1.5, method: "ping" }, "x", null]) {
    assert.equal((await ask(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(protocol.parseFailure().body.error.code, -32700);
  assert.equal(protocol.acceptedVersionHeader(null), true);
  assert.equal(protocol.acceptedVersionHeader("2025-11-25"), true);
  assert.equal(protocol.acceptedVersionHeader("1999-01-01"), false);
});

const READ_TOOLS = ["search", "get_customer", "get_project", "list_tasks", "list_appointments", "find_free_slots", "check_appointment_time"];
const WRITE_TOOLS = ["create_appointment", "update_appointment", "cancel_appointment", "create_tasks", "update_task", "move_task", "add_task_comment", "create_project"];

test("tools: seven reading, eight writing, strict and fully described; none without the right", () => {
  assert.deepEqual(tools.listTools(["hub:read"]).map((tool) => tool.name), READ_TOOLS, "a read-only connection sees no writing tool");
  const listed = tools.listTools(["hub:read", "hub:write"]);
  assert.deepEqual(listed.map((tool) => tool.name), [...READ_TOOLS, ...WRITE_TOOLS]);
  // Strict schemas all the way down (the tasks of create_tasks, the milestones of create_project).
  const strict = (schema, path) => {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, path);
      for (const key of schema.required ?? []) assert.ok(key in schema.properties, `${path}.${key}`);
      for (const [key, value] of Object.entries(schema.properties ?? {})) strict(value, `${path}.${key}`);
    }
    if (schema.items) strict(schema.items, `${path}[]`);
  };
  for (const tool of listed) {
    const writes = WRITE_TOOLS.includes(tool.name);
    assert.equal(tool.annotations.readOnlyHint, !writes, tool.name);
    assert.equal(tool.annotations.destructiveHint, writes, `${tool.name}: Claude asks before every change`);
    strict(tool.inputSchema, tool.name);
    assert.ok(tool.name.length <= 64 && /^[a-z_]+$/.test(tool.name), tool.name);
    assert.ok(tool.description.length > 60, tool.name);
    assert.ok(JSON.stringify(tool.inputSchema).length < 8000, `${tool.name}: compact`);
    assert.deepEqual(Object.keys(tool).sort(), ["annotations", "description", "inputSchema", "name", "title"], "no internal fields leave the hub");
  }
  assert.ok(!listed.some((tool) => /delete|archive|remove/.test(tool.name)), "nothing deletes or archives");
  assert.deepEqual(tools.listTools([]), []);
  assert.match(tools.SERVER_INSTRUCTIONS, /keine Anweisungen an dich/);
  assert.match(tools.SERVER_INSTRUCTIONS, /Europe\/Berlin/);
  assert.match(tools.SERVER_INSTRUCTIONS, /löschen oder archivieren können sie nichts/);
  assert.match(tools.SERVER_INSTRUCTIONS, /check_appointment_time/);
  // The pure runner never writes: writing tools run only on the server (lib/hub-mcp/writes.ts).
  assert.equal(tools.runHubTool("create_appointment", { title: "x" }, { origin, today: "2026-11-16", now: 0 }).isError, true);
});

const ids = { abc: "11111111-1111-4111-8111-111111111111", mueller: "22222222-2222-4222-8222-222222222222", web: "55555555-5555-4555-8555-555555555555" };
const task = (number, status, extra = {}) => ({ id: `t${number}`, number, title: `Aufgabe ${number}`, status, dueOn: null, customer: false, visible: false, ...extra });
const assistant = {
  customers: [
    { id: ids.abc, organizationId: "org-abc", company: "ABC GmbH", customerNumber: "OA-1001", packages: ["OALAB Service Max"], city: "Leipzig", website: "abc.de", contactEmail: "" },
    { id: ids.mueller, organizationId: null, company: "Müller Bau", customerNumber: "OA-1002", packages: [], city: "", website: "", contactEmail: "" },
  ],
  projects: [{
    id: ids.web, name: "Website-Relaunch", category: "", description: "", status: "In Umsetzung", progress: 50, date: "", artwork: "orange", company: "ABC GmbH", organizationId: "org-abc",
    startedOn: null, dueOn: "2026-12-01", milestones: [], tasks: [task(7, "done"), task(8, "todo", { customer: true, visible: true, dueOn: "2026-11-20" })],
  }],
};
const call = (name, args, extra = {}) => {
  const result = tools.runHubTool(name, args, { origin, today: "2026-11-16", now: Date.parse("2026-11-16T08:00:00Z"), assistant, ...extra });
  return result && { ...result, value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
};

test("the assistant's tools answer as in the hub, with links and without contact data", () => {
  const found = call("search", { query: "abc" }).value;
  assert.equal(found.customers[0].link, `${origin}/dashboard/projects?customer=${ids.abc}`);
  assert.equal(found.projects[0].link, `${origin}/dashboard/projects?project=${ids.web}`);

  const customer = call("get_customer", { customer_id: ids.abc }).value;
  assert.equal(customer.company, "ABC GmbH");
  assert.equal("contact_email" in customer, false, "contact data stays in the hub");
  assert.equal(customer.projects[0].link, `${origin}/dashboard/projects?project=${ids.web}`);

  const project = call("get_project", { project_id: ids.web }).value;
  assert.equal(project.tasks[1].link, `${origin}/dashboard/projects/tasks?project=${ids.web}&task=8`);

  const open = call("list_tasks", {}).value;
  assert.equal(open.total, 1, "without filters: open tasks of every project");
  assert.equal(open.tasks[0].link, `${origin}/dashboard/projects/tasks?project=${ids.web}&task=8`);
  assert.equal(call("list_tasks", { owner: "oalab" }).value.total, 0);

  assert.equal(call("get_customer", { customer_id: "nope" }).isError, true);
  assert.equal(tools.runHubTool("delete_everything", {}, { origin, today: "2026-11-16", now: 0 }), null);
  assert.equal(tools.runHubTool("search", { query: "" }, { origin, today: "2026-11-16", now: 0 }).isError, true, "no data, no answer");
});

// Monday 16 November 2026; oalab is available Monday to Friday 9 to 17 o'clock.
const at = (day, time) => rules.wallTimeToUtc(day, time);
const appointment = (id, title, status, day, from, to, customer = null) => ({ id, title, description: "", start: at(day, from), end: at(day, to), status, teamsUrl: null, customer });
const calendar = {
  availabilityReady: true,
  availability: { week: [[[540, 1020]], [[540, 1020]], [[540, 1020]], [[540, 1020]], [[540, 1020]], [], []], exceptions: [], rules: { notice: 0, buffer: 0, horizon: 8, durations: [30, 60] } },
  appointments: [
    appointment("a1111111-1111-4111-8111-111111111111", "Abstimmung", "confirmed", "2026-11-17", "10:00", "11:00", { id: ids.abc, company: "ABC GmbH", customerNumber: "OA-1001" }),
    appointment("a2222222-2222-4222-8222-222222222222", "Anfrage Logo", "requested", "2026-11-17", "14:00", "14:30"),
    appointment("a3333333-3333-4333-8333-333333333333", "Abgesagt", "cancelled", "2026-11-18", "10:00", "11:00"),
  ],
};

test("calendar: appointments of a range with times in Berlin, customer and link", () => {
  const week = call("list_appointments", {}, { calendar }).value;
  assert.equal(week.today, "2026-11-16");
  assert.equal(week.from, "2026-11-16");
  assert.equal(week.to, "2026-11-22");
  assert.deepEqual(week.appointments.map((item) => item.title), ["Abstimmung", "Anfrage Logo"], "active: confirmed and requested");
  const first = week.appointments[0];
  assert.equal(first.day, "2026-11-17");
  assert.equal(first.weekday, "Dienstag");
  assert.equal(first.start, "10:00");
  assert.equal(first.end, "11:00");
  assert.equal(first.status, "Bestätigt");
  assert.equal(first.customer.company, "ABC GmbH");
  assert.equal(first.link, `${origin}/dashboard/projects/calendar?appointment=a1111111-1111-4111-8111-111111111111`);
  assert.equal(week.appointments[1].internal, true);
  assert.equal(call("list_appointments", { status: "all" }, { calendar }).value.total, 3);
  assert.equal(call("list_appointments", { customer_id: ids.abc }, { calendar }).value.total, 1);
  assert.match(call("list_appointments", { from: "2026-11-01", to: "2027-01-31" }, { calendar }).value, /höchstens 62 Tage/);
  assert.match(call("list_appointments", { from: "2026-11-20", to: "2026-11-19" }, { calendar }).value, /vor from/);
  assert.match(call("list_appointments", { from: "17.11.2026" }, { calendar }).value, /JJJJ-MM-TT/);
});

test("calendar: free times as the appointment window suggests them (availability minus confirmed)", () => {
  const free = call("find_free_slots", { from: "2026-11-17", to: "2026-11-17", minutes: 60 }, { calendar }).value;
  assert.equal(free.days.length, 1);
  const starts = free.days[0].starts;
  assert.ok(starts.includes("09:00"));
  assert.ok(!starts.includes("09:30") && !starts.includes("10:00") && !starts.includes("10:30"), "the confirmed appointment blocks 10 to 11");
  assert.ok(starts.includes("11:00") && starts.includes("16:00") && !starts.includes("16:30"));
  assert.ok(starts.includes("14:00"), "requests do not block suggestions, as in the hub");
  assert.deepEqual(free.days[0].free, ["09:00–10:00", "11:00–17:00"]);
  const weekend = call("find_free_slots", { from: "2026-11-21", to: "2026-11-22", minutes: 30 }, { calendar }).value;
  assert.deepEqual(weekend.days, []);
  assert.match(weekend.note, /keine Zeit für 30 Minuten frei/);
  assert.match(call("find_free_slots", { minutes: 50 }, { calendar }).value, /minutes muss/);
  assert.match(call("find_free_slots", { from: "2026-11-16", to: "2026-12-16" }, { calendar }).value, /höchstens 14 Tage/);
});

test("calendar: a time is checked with the very hints of the appointment window", async () => {
  const check = (args) => call("check_appointment_time", args, { calendar }).value;
  const clash = check({ day: "2026-11-17", start: "10:30", minutes: 60 });
  assert.equal(clash.free, false);
  assert.deepEqual(clash.checks, [{ tone: "bad", text: "Überschneidet sich mit 10:00 „Abstimmung“." }]);
  assert.deepEqual(check({ day: "2026-11-17", start: "14:00", minutes: 30 }).checks, [{ tone: "bad", text: "Überschneidet sich mit 14:00 „Anfrage Logo“ (Anfrage)." }]);
  assert.deepEqual(check({ day: "2026-11-22", start: "10:00" }).checks, [{ tone: "warn", text: "Außerhalb deiner Verfügbarkeit. Du kannst trotzdem eintragen, Kunden könnten diese Zeit nicht anfragen." }]);
  const fine = check({ day: "2026-11-18", start: "10:00", minutes: 60 });
  assert.deepEqual(fine.checks, [{ tone: "ok", text: "Frei und in deiner Verfügbarkeit." }], "a cancelled appointment does not count");
  assert.equal(fine.free, true);
  assert.equal(check({ day: "2026-11-17", start: "10:30", minutes: 60, appointment_id: "a1111111-1111-4111-8111-111111111111" }).free, true, "moving an appointment does not clash with itself");
  assert.match(call("check_appointment_time", { day: "2026-11-17", start: "10:30", minutes: 50 }, { calendar }).value, /gültige Dauer/);

  // Same words as the hub's window: if the form changes its hints, this test points here.
  const panels = await source("components/hub/screens/calendar-panels.tsx");
  for (const words of ["Überschneidet sich mit", " (Anfrage)", "Außerhalb deiner Verfügbarkeit. Du kannst trotzdem eintragen, Kunden könnten diese Zeit nicht anfragen.", "Frei und in deiner Verfügbarkeit."]) {
    assert.ok(panels.includes(words), words);
  }
  assert.deepEqual(tools.calendarRange("check_appointment_time", { day: "2026-11-17" }, "2026-11-16"), { ok: true, from: "2026-11-17", to: "2026-11-17" });
});

test("routes: every address exists, answers per request and stays off with the switch", async () => {
  for (const path of ["app/api/mcp/route.ts", "app/api/mcp/oauth/authorize/route.ts", "app/api/mcp/oauth/token/route.ts", "app/api/mcp/oauth/revoke/route.ts", "app/.well-known/oauth-protected-resource/route.ts", "app/.well-known/oauth-protected-resource/api/mcp/route.ts", "app/.well-known/oauth-authorization-server/route.ts", "app/dashboard/settings/claude/page.tsx"]) {
    assert.ok(await source(path), path);
  }
  for (const path of ["app/api/mcp/route.ts", "app/api/mcp/oauth/authorize/route.ts", "lib/hub-mcp/metadata.ts"]) {
    const route = await source(path);
    assert.match(route, /await connection\(\);/, `${path}: never prerendered`);
    assert.match(route, /if \(!connectorReady\(\)\) return notFound\(\);/, `${path}: 404 with the switch off`);
  }
  const mcp = await source("app/api/mcp/route.ts");
  assert.ok(mcp.indexOf("authenticate(token)") < mcp.indexOf("answerMessage("), "the key is checked before any message");
  const actions = await source("lib/hub-mcp/actions.ts");
  const allow = actions.slice(actions.indexOf("export async function answerClaude"));
  assert.ok(allow.indexOf('aal !== "aal2"') < allow.indexOf("issueCode("), "„Erlauben“ needs a confirmed code");
  assert.ok(allow.indexOf("verifyHubAdmin()") < allow.indexOf("issueCode("), "and an active admin");
  // The web app's service worker never answers for these addresses (public/sw.js).
  const worker = await source("public/sw.js");
  for (const path of ["/api", "/.well-known", "/auth", "/dashboard/settings/claude"]) assert.ok(worker.includes(`"${path}"`), path);
});

test("writing: Claude's arguments become exactly what the hub's windows send", () => {
  // create_appointment: „Neuer Termin“ with 60 minutes and no customer unless named.
  assert.deepEqual(input.readNewAppointment({ title: "Abstimmung", day: "2026-11-18", start: "10:00" }).value, { title: "Abstimmung", description: "", customerId: null, day: "2026-11-18", start: "10:00", minutes: 60, teamsUrl: "" });
  assert.equal(input.readNewAppointment({ title: "Abstimmung", day: "2026-11-18", start: "10:00", minutes: 30, customer_id: ids.abc }).value.customerId, ids.abc);
  assert.match(input.readNewAppointment({ day: "2026-11-18", start: "10:00" }).error, /Titel/);
  assert.match(input.readNewAppointment({ title: "x", day: "18.11.2026", start: "10:00" }).error, /JJJJ-MM-TT/);
  assert.match(input.readNewAppointment({ title: "x", day: "2026-11-18", start: "10:00", teams_link: 5 }).error, /teams_link muss Text sein/);

  // update_appointment: the stored appointment with only the given fields over it, as the window saves all at once.
  const stored = { title: "Abstimmung", description: "Agenda", start: at("2026-11-17", "10:00"), end: at("2026-11-17", "11:00"), status: "confirmed", teamsUrl: null, customerId: ids.abc };
  assert.deepEqual(input.mergeAppointment(stored, { start: "14:00" }).value, { title: "Abstimmung", description: "Agenda", customerId: ids.abc, day: "2026-11-17", start: "14:00", minutes: 60, teamsUrl: "" });
  assert.equal(input.mergeAppointment(stored, { customer_id: null }).value.customerId, null, "null makes it internal");
  assert.equal(input.mergeAppointment(stored, { minutes: 90 }).value.minutes, 90);
  assert.match(input.mergeAppointment(stored, {}).error, /nichts zu ändern/);
  assert.match(input.mergeAppointment({ ...stored, status: "cancelled" }, { title: "Neu" }).error, /abgesagt oder abgelehnt/);

  // cancel_appointment: the window's two buttons.
  assert.equal(input.closingStatus("requested"), "declined");
  assert.equal(input.closingStatus("confirmed"), "cancelled");
  assert.equal(input.closingStatus("cancelled"), null);

  // create_tasks: title and column first, the rest as a change on the new card, the checklist after it.
  const tasks = input.readNewTasks({ tasks: [{ title: "Logo-Set", priority: "high", due_on: "2026-11-20", checklist: ["Entwurf", "Abstimmung"] }, { title: "Texte", status: "backlog", audience: "team" }] });
  assert.deepEqual(tasks.value, [
    { title: "Logo-Set", status: "todo", patch: { priority: "high", dueOn: "2026-11-20" }, checklist: ["Entwurf", "Abstimmung"] },
    { title: "Texte", status: "backlog", patch: { audience: "team" }, checklist: [] },
  ]);
  assert.match(input.readNewTasks({ tasks: [] }).error, /mindestens eine/);
  assert.match(input.readNewTasks({ tasks: Array.from({ length: 21 }, (_, index) => ({ title: `T${index}` })) }).error, /Höchstens 20/);
  assert.match(input.readNewTasks({ tasks: [{ title: "x", status: "later" }] }).error, /Aufgabe 1: Diese Spalte gibt es nicht/);
  assert.match(input.readNewTasks({ tasks: [{ title: "x" }, { title: "y", checklist: ["", "a"] }] }).error, /Aufgabe 2: Die Checkliste/);
  assert.deepEqual(input.readTaskPatch({ due_on: null, assignee_ids: [] }).value, { dueOn: null, assigneeIds: [] }, "null and [] clear");
  assert.deepEqual(input.readTaskRef({ project_id: ids.web, task_number: 8 }).value, { projectId: ids.web, number: 8 });
  assert.equal(input.readTaskRef({ project_id: ids.web, task_number: 0 }).ok, false);
  assert.equal(input.moveOrder("end", [1, 5, 3]), 6);
  assert.equal(input.moveOrder("start", [1, 5, 3]), 0);
  assert.equal(input.moveOrder(undefined, []), 1);
  assert.equal(input.moveOrder("end", [1e12]), 1e12, "within Studio's limit");

  // create_project: the fields of „Neues Projekt“, read by the hub's own check.
  const project = input.readNewProject({ customer_id: ids.abc, name: "Relaunch", due_date: "2026-12-01", live_url: "abc.de", milestones: [{ name: "Entwurf", date: "2026-11-25" }] }).value;
  assert.deepEqual(project, { customerId: ids.abc, draft: { name: "Relaunch", description: "", startDate: null, dueDate: "2026-12-01", milestones: [{ name: "Entwurf", date: "2026-11-25" }], liveUrl: "abc.de", testUrl: "" } });
  const draft = projectEdit.readProjectDraft(project.draft);
  assert.equal(draft.ok, true);
  assert.equal(draft.value.liveUrl, "https://abc.de");
  assert.equal(projectEdit.readProjectDraft(input.readNewProject({ customer_id: ids.abc }).value.draft).ok, false, "a name is needed, as in the hub");
  assert.match(input.readNewProject({ name: "x" }).error, /customer_id/);
});

test("writing: the answers say what the hub's own windows say", async () => {
  const day = rules.formatDayShort("2026-11-18");
  const saved = (extra = {}) => input.appointmentSavedText({ id: "a1111111-1111-4111-8111-111111111111", title: "Abstimmung", day: "2026-11-18", start: "10:00", customerId: ids.abc, company: "ABC GmbH", teams: false, before: null, ...extra });
  assert.equal(saved(), `„Abstimmung“ steht am ${day} um 10:00 im Kalender. ABC GmbH bekommt eine Meldung.`);
  assert.equal(saved({ customerId: null, company: null }), `„Abstimmung“ steht am ${day} um 10:00 im Kalender.`, "internal: nobody is told");
  const before = { status: "confirmed", startsAt: new Date(at("2026-11-17", "10:00")).toISOString(), customerId: ids.abc };
  assert.equal(saved({ before }), "„Abstimmung“ gespeichert. ABC GmbH bekommt eine Meldung zur neuen Zeit.");
  assert.equal(saved({ before: { ...before, startsAt: new Date(at("2026-11-18", "10:00")).toISOString() } }), "„Abstimmung“ gespeichert.", "same time: no notice");
  assert.equal(saved({ before: { ...before, customerId: ids.mueller } }), "„Abstimmung“ gespeichert. ABC GmbH bekommt eine Meldung.", "another customer hears of a new appointment");
  assert.equal(saved({ before: { ...before, status: "requested" }, teams: true }), `Bestätigt: „Abstimmung“ am ${day}, 10:00. ABC GmbH bekommt eine Meldung mit Teams-Link und Kalenderknöpfen.`);
  assert.equal(input.appointmentClosedText("cancelled", "Abstimmung", "ABC GmbH", ""), "„Abstimmung“ abgesagt. ABC GmbH bekommt eine Meldung.");
  assert.equal(input.appointmentClosedText("cancelled", "Intern", null, ""), "„Intern“ abgesagt.");
  assert.equal(input.appointmentClosedText("declined", "Anfrage Logo", null, "Urlaub"), "Anfrage „Anfrage Logo“ abgelehnt. Der Kunde bekommt eine Meldung mit deinem Grund.");
  // Same words as the window: if it changes its texts, this test points here.
  const panels = await source("components/hub/screens/calendar-panels.tsx");
  for (const words of ["“ steht am ${formatDayShort(day)} um ${start} im Kalender.", " bekommt eine Meldung zur neuen Zeit.", "Bestätigt: „", " mit Teams-Link", " und Kalenderknöpfen.", "“ abgesagt.", "Anfrage „", " mit deinem Grund"]) {
    assert.ok(panels.includes(words), words);
  }
});

test("writing: get_project names who can take a task, only where Claude may write", () => {
  const people = [{ id: "u1", name: "Mia Team", initials: "MT", kind: "team" }, { id: "u2", name: "Lea", initials: "LE", kind: "freelancer", company: "Studio Lea" }];
  assert.deepEqual(call("get_project", { project_id: ids.web }, { people }).value.people, [
    { user_id: "u1", name: "Mia Team", role: "oalab-Team" },
    { user_id: "u2", name: "Lea", role: "Freelancer (Studio Lea)" },
  ]);
  assert.equal("people" in call("get_project", { project_id: ids.web }).value, false);
});

test("writing goes through the hub's own save code, with the admin's claims, logged, never deleting", async () => {
  const writes = await source("lib/hub-mcp/writes.ts");
  for (const core of ["writeAppointment(", "closeAppointmentAs(", "createTaskAs(", "saveSubtaskAs(", "updateTaskAs(", "moveTaskAs(", "addCommentAs(", "createProjectAs("]) assert.ok(writes.includes(core), core);
  assert.doesNotMatch(writes, /\.delete\(|archived: true|refreshWorkspace|revalidate/, "no deleting, no archiving, no Server Action helpers");
  // Every save leaves a line in the admin log; create_project's comes from createProjectAs itself.
  for (const action of ["claude.appointment.created", "claude.appointment.updated", "claude.appointment.confirmed", "claude.appointment.${status}", "claude.tasks.created", "claude.task.updated", "claude.task.moved", "claude.task.commented"]) {
    assert.ok(writes.includes(action), action);
  }
  assert.match(writes, /createProjectAs\(team, [^\n]*"claude"\)/);
  // Archived customers (lib/hub-archive) are out of sight for the hub and the reading tools, so nothing is written for
  // them: their appointments count as gone, they are no customer to book or create for, their projects take no tasks.
  assert.match(writes, /&& !isArchivedCustomer\(archive, data\.id\) \? data : null;/);
  assert.match(writes, /return data && !isArchivedCustomer\(archive, data\.customer_id\) \? data : null;/);
  assert.match(writes, /archived: project\.data\.status === "archived" \|\| isArchivedOrganization\(archive, project\.data\.organization_id\)/);
  for (const name of ["createTasks", "updateTask", "moveTask", "addTaskComment"]) {
    const start = writes.indexOf(`async function ${name}(`);
    const body = writes.slice(writes.indexOf("\n", start), writes.indexOf("\n}\n", start));
    assert.match(body, /if \(!project \|\| project\.archived\) return refuse\(noProject\);/, name);
    const firstWrite = body.search(/\b(createTaskAs|updateTaskAs|moveTaskAs|addCommentAs|onCurrentTask)\(/);
    assert.ok(firstWrite > 0 && body.indexOf("project.archived") < firstWrite, `${name}: checked before writing`);
  }
  assert.match(writes.slice(writes.indexOf("async function createProject(")), /if \(!\(await customerOf\(w, read\.value\.customerId\)\)\) return refuse\(noCustomer\);/);
  assert.match(await source("lib/hub-tasks/server.ts"), /archive\.organizationIds\.has\(project\.data\.organization_id\)\) return null;/, "no assignees for an archived customer's project");

  // The hub's windows save through the same cores; the cores are no Server Actions.
  const calendar = await source("lib/hub-calendar/actions.ts");
  assert.ok(calendar.includes("writeAppointment(supabase, id, input)") && calendar.includes("closeAppointmentAs(supabase, id, status, note)"));
  for (const path of ["lib/hub-calendar/write.ts", "lib/hub-tasks/write.ts", "lib/hub-projects/write.ts", "lib/hub-mcp/writes.ts"]) {
    const file = await source(path);
    assert.match(file, /^import "server-only";/, path);
    assert.doesNotMatch(file, /"use server"/, path);
  }

  // The key: the admin's claims with the confirmed code of „Erlauben“, without a session (the keychain stays closed).
  const auth = await source("lib/platform/auth.ts");
  const claims = auth.slice(auth.indexOf("export async function connectorClaims"), auth.indexOf("export function claimsToken"));
  assert.match(claims, /aal: "aal2"/);
  assert.doesNotMatch(claims, /session_id/);
  assert.match(claims, /banned_until/);
  assert.match(await source("lib/platform/client.ts"), /export function createOwnClaimsClient\(claims: Claims\) \{\s+const data = restClient\(async \(\) => claimsToken\(claims\)\);/);
  // The right to write is checked before a writing tool runs, and every request checks the admin again (store.ts).
  const server = await source("lib/hub-mcp/server.ts");
  assert.ok(server.indexOf("hasScope(connection.scopes, tool.scope)") < server.indexOf("runWriteTool("), "the right first");
  assert.match(server, /name === "get_project" && hasScope\(connection\.scopes, "hub:write"\)/);

  // The pages show the change when opened again (the task board polls by itself).
  assert.match(await source("components/hub/screens/calendar.tsx"), /useRefreshOnReturn\(store\.live\);/);
  assert.match(await source("components/hub/screens/projects.tsx"), /useRefreshOnReturn\(!preview\);/);
  const hook = await source("components/hub/use-refresh-on-return.ts");
  assert.match(hook, /router\.refresh\(\);/);
  assert.match(hook, /addEventListener\("visibilitychange", onVisibility\)/);
});
