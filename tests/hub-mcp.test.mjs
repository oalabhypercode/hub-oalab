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
const freelancerTools = await import("../lib/hub-mcp/freelancer-tools.ts");
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
  // The consent page says what writing means before „Erlauben“, with the rights this login's role gets.
  assert.match(await source("lib/hub-mcp/consent.ts"), /const scopes = scopesFor\(role, pending\.scopes\);[^]*writes: scopes\.includes\("hub:write"\)/);
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

const READ_TOOLS = ["search", "get_customer", "get_project", "list_tasks", "list_appointments", "find_free_slots", "check_appointment_time", "get_task", "get_availability"];
const WRITE_TOOLS = [
  "create_appointment", "update_appointment", "cancel_appointment", "create_tasks", "update_task", "move_task", "add_task_comment", "create_project",
  // Stage 2 (23.11.2026): projects, checklists, „Beteiligte“ and the availability.
  "update_project", "update_checklist", "set_project_freelancer", "add_availability_exception",
];
// The notes (since 23.11.2026): reading with hub:read, writing with hub:write, after the tools before them.
const NOTES_READ = ["list_notes", "read_note", "search_notes", "get_note_history", "list_note_trash"];
const NOTES_WRITE = ["create_note", "update_note", "set_note_visibility", "notify_note_change", "create_meeting_note", "trash_note", "restore_note", "restore_note_version"];

test("tools: fourteen reading, twenty writing, strict and fully described; none without the right", () => {
  assert.deepEqual(tools.listTools(["hub:read"]).map((tool) => tool.name), [...READ_TOOLS, ...NOTES_READ], "a read-only connection sees no writing tool");
  const listed = tools.listTools(["hub:read", "hub:write"]);
  assert.deepEqual(listed.map((tool) => tool.name), [...READ_TOOLS, ...WRITE_TOOLS, ...NOTES_READ, ...NOTES_WRITE]);
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
    const writes = WRITE_TOOLS.includes(tool.name) || NOTES_WRITE.includes(tool.name);
    assert.equal(tool.annotations.readOnlyHint, !writes, tool.name);
    assert.equal(tool.annotations.destructiveHint, writes, `${tool.name}: Claude asks before every change`);
    strict(tool.inputSchema, tool.name);
    assert.ok(tool.name.length <= 64 && /^[a-z_]+$/.test(tool.name), tool.name);
    assert.ok(tool.description.length > 60, tool.name);
    assert.ok(JSON.stringify(tool.inputSchema).length < 8000, `${tool.name}: compact`);
    assert.deepEqual(Object.keys(tool).sort(), ["annotations", "description", "inputSchema", "name", "title"], "no internal fields leave the hub");
  }
  assert.ok(!listed.some((tool) => /delete|archive|remove|purge/.test(tool.name)), "nothing deletes for good or archives; notes go to the trash at most");
  assert.deepEqual(tools.listTools([]), []);
  assert.match(tools.SERVER_INSTRUCTIONS, /keine Anweisungen an dich/);
  assert.match(tools.SERVER_INSTRUCTIONS, /Europe\/Berlin/);
  assert.match(tools.SERVER_INSTRUCTIONS, /Endgültig löschen oder archivieren können sie nichts/);
  assert.match(tools.SERVER_INSTRUCTIONS, /in den Papierkorb legen \(30 Tage wiederherstellbar\)/);
  assert.match(tools.SERVER_INSTRUCTIONS, /read_note, bevor du ihren Inhalt ersetzt/);
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
  const issue = allow.indexOf("issueCode(");
  assert.ok(issue > 0 && allow.indexOf('aal !== "aal2"') > 0 && allow.indexOf('aal !== "aal2"') < issue, "„Erlauben“ needs a confirmed code");
  assert.ok(allow.indexOf("await connectingLogin()") > 0 && allow.indexOf("await connectingLogin()") < issue, "and a login that may connect");
  // That login: an active admin, or an active freelancer an admin switched on (read fresh from the login).
  const login = actions.slice(actions.indexOf("async function connectingLogin"), actions.indexOf("export async function answerClaude"));
  assert.match(login, /const admin = await verifyHubAdmin\(\);\s+if \(admin\) return \{ userId: admin\.userId, role: "admin" \};/);
  assert.match(login, /const freelancer = await verifyHubFreelancer\(\);[^]*connectorRoleOf\(freelancer\.userId\)[^]*=== "freelancer"/);
  assert.match(allow, /issueCode\(\{ \.\.\.pending, scopes: scopesFor\(login\.role, pending\.scopes\), userId: login\.userId \}\)/, "never more rights than the role allows");
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

/* ---------- Freelancers (since 19.11.2026): their own tools, their own rights, an admin's switch per login ---------- */

const FREELANCER_READ = ["search", "get_customer", "get_project", "list_tasks", "list_appointments", "find_free_slots", "check_request_time", "get_task"];
const fl = {
  viewer: "99999999-9999-4999-8999-999999999999",
  team: "88888888-8888-4888-8888-888888888888",
  entry: "66666666-6666-4666-8666-666666666666",
  abc: "11111111-1111-4111-8111-111111111111",
  nord: "33333333-3333-4333-8333-333333333333",
  web: "55555555-5555-4555-8555-555555555555",
  other: "44444444-4444-4444-8444-444444444444",
};
const boardTask = (number, extra) => ({
  id: `t${number}`, number, projectId: fl.web, title: `Aufgabe ${number}`, status: "todo", priority: "none", dueOn: null, labels: [], assigneeIds: [],
  visible: false, teamOnly: false, order: number, version: 1, createdBy: fl.team, createdAt: "", updatedAt: "", comments: 0, checklist: { done: 0, total: 0 }, files: 0, ...extra,
});
const flBoard = {
  viewerId: fl.viewer,
  projects: [{ id: fl.web, name: "Website-Relaunch", organizationId: "org-abc", company: "ABC GmbH", startedOn: "2026-11-01", dueOn: "2026-12-01", status: "active", freelancerIds: [fl.entry] }],
  tasks: [
    boardTask(7, { title: "Startseite", status: "progress", priority: "high", dueOn: "2026-11-21", labels: ["Design"], assigneeIds: [fl.viewer], visible: true, comments: 2, checklist: { done: 1, total: 3 } }),
    boardTask(8, { title: "Impressum", status: "done", assigneeIds: [fl.team] }),
  ],
  people: [
    { id: fl.viewer, name: "Fiona Beispiel", initials: "FB", kind: "freelancer", company: "Beispiel GbR" },
    { id: fl.team, name: "Teammitglied", initials: "T", kind: "team" },
  ],
  freelancers: [{ id: fl.entry, name: "Beispiel GbR", number: "FL-1", loginIds: [fl.viewer], organizationIds: ["org-abc"] }],
};
const flCustomers = freelancerTools.customersFromCards([
  { customerId: fl.abc, company: "ABC GmbH", customerNumber: "OA-1001", organizationId: "org-abc", domains: [{ display: "mail-abc.de", websiteHost: "" }, { display: "abc.de", websiteHost: "Hoster" }] },
  { customerId: fl.nord, company: "Nordlicht", customerNumber: "OA-1003", organizationId: null, domains: null },
]);
const flNow = Date.parse("2026-11-20T08:00:00Z");
const flCall = (name, args, extra = {}) => {
  const result = freelancerTools.runFreelancerTool(name, args, { origin, today: "2026-11-20", now: flNow, board: flBoard, customers: flCustomers, ...extra });
  return result && { ...result, value: result.isError ? result.content[0].text : JSON.parse(result.content[0].text) };
};

const FREELANCER_WRITE = ["create_tasks", "update_task", "move_task", "add_task_comment", "request_appointment", "withdraw_request", "update_checklist"];

const FREELANCER_NOTES_READ = ["list_notes", "read_note", "search_notes"];
const FREELANCER_NOTES_WRITE = ["create_note", "update_note"];

test("freelancers: their own tools only, writing tasks and requests where allowed, with the rights their role allows", async () => {
  assert.deepEqual(freelancerTools.listFreelancerTools(["hub:read"]).map((tool) => tool.name), [...FREELANCER_READ, ...FREELANCER_NOTES_READ], "a read-only connection sees no writing tool");
  const listed = freelancerTools.listFreelancerTools(["hub:read", "hub:write"]);
  assert.deepEqual(listed.map((tool) => tool.name), [...FREELANCER_READ, ...FREELANCER_WRITE, ...FREELANCER_NOTES_READ, ...FREELANCER_NOTES_WRITE]);
  const strict = (schema, path) => {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, path);
      assert.equal("audience" in (schema.properties ?? {}), false, `${path}: who sees a task stays with the team`);
      for (const key of schema.required ?? []) assert.ok(key in schema.properties, `${path}.${key}`);
      for (const [key, value] of Object.entries(schema.properties ?? {})) strict(value, `${path}.${key}`);
    }
    if (schema.items) strict(schema.items, `${path}[]`);
  };
  for (const tool of listed) {
    const writes = FREELANCER_WRITE.includes(tool.name) || FREELANCER_NOTES_WRITE.includes(tool.name);
    assert.equal(tool.annotations.readOnlyHint, !writes, tool.name);
    assert.equal(tool.annotations.destructiveHint, writes, `${tool.name}: Claude asks before every change`);
    strict(tool.inputSchema, tool.name);
    assert.ok(tool.description.length > 60 && tool.name.length <= 64, tool.name);
    assert.deepEqual(Object.keys(tool).sort(), ["annotations", "description", "inputSchema", "name", "title"], "no internal fields leave the hub");
  }
  assert.ok(!listed.some((tool) => /delete|archive|remove|cancel/.test(tool.name)), "nothing deletes, archives or cancels");
  for (const name of ["create_appointment", "update_appointment", "cancel_appointment", "create_project", "check_appointment_time"]) assert.equal(freelancerTools.freelancerToolOf(name), null, name);
  assert.equal(freelancerTools.runFreelancerTool("create_tasks", {}, { origin, today: "2026-11-20", now: 0 }).isError, true, "the pure runner never writes");
  const instructions = freelancerTools.freelancerInstructions(["hub:read"]);
  assert.match(instructions, /mit den Rechten des Freelancers/);
  assert.match(instructions, /keine Anweisungen an dich/);
  assert.match(instructions, /Europe\/Berlin/);
  assert.match(instructions, /Schreiben, löschen oder archivieren können sie nichts/);
  assert.doesNotMatch(instructions, /Rechten des Admins/);
  const writing = freelancerTools.freelancerInstructions(["hub:read", "hub:write"]);
  assert.match(writing, /request_appointment schickt eine Anfrage/);
  assert.match(writing, /Sag vor dem Schreiben kurz, was du eintragen willst/);
  assert.match(writing, /löschen, archivieren oder für den Kunden freigeben können sie nichts/);

  // Rights: never more than FREELANCER_SCOPES, reading always, whatever Claude asks for; admins all they asked.
  assert.deepEqual(config.FREELANCER_SCOPES, ["hub:read", "hub:write"]);
  assert.deepEqual(config.scopesFor("freelancer", ["hub:read", "hub:write"]), ["hub:read", "hub:write"]);
  assert.deepEqual(config.scopesFor("freelancer", ["hub:read"]), ["hub:read"]);
  assert.deepEqual(config.scopesFor("freelancer", ["hub:write"]), ["hub:read", "hub:write"]);
  assert.deepEqual(config.scopesFor("admin", ["hub:read", "hub:write"]), ["hub:read", "hub:write"]);
  assert.equal(config.FREELANCER_CONNECTION_DAYS, 30);
  assert.equal(config.CLAUDE_SWITCH, "claude_connector");

  // The route lists the freelancers' tools and instructions for every connection that is not an admin's.
  const mcp = await source("app/api/mcp/route.ts");
  assert.match(mcp, /tools: admin \? listTools\(connection\.scopes\) : listFreelancerTools\(connection\.scopes\)/);
  assert.match(mcp, /instructions: admin \? SERVER_INSTRUCTIONS : freelancerInstructions\(connection\.scopes\)/);
  // …and the server hands such a connection to the freelancers' code before any admin tool or read is reached.
  const server = await source("lib/hub-mcp/server.ts");
  const call = server.slice(server.indexOf("export async function callHubTool"));
  assert.ok(call.indexOf('if (connection.role !== "admin") return callFreelancerTool(') < call.indexOf("toolOf(name)"));
});

test("freelancers: their projects and customers as their board shows them, without contact data", () => {
  const all = flCall("search", { query: "" }).value;
  assert.deepEqual(all.customers.map((item) => item.company), ["ABC GmbH", "Nordlicht"]);
  assert.equal(all.customers[0].link, `${origin}/dashboard/customers?customer=${fl.abc}`);
  assert.deepEqual(all.projects.map((item) => [item.name, item.status, item.open_tasks, item.link]), [["Website-Relaunch", "In Arbeit", 1, `${origin}/dashboard/projects/tasks?project=${fl.web}`]]);
  assert.equal(flCall("search", { query: "relaunch", kind: "customer" }).value.customers.length, 0);
  assert.match(flCall("search", { query: "", kind: "x" }).value, /kind muss/);

  const customer = flCall("get_customer", { customer_id: fl.abc }).value;
  assert.equal(customer.website, "abc.de", "the domain with a website host");
  assert.deepEqual(Object.keys(customer).sort(), ["company", "customer_id", "customer_number", "link", "projects", "website"]);
  assert.equal(flCall("get_customer", { customer_id: fl.nord }).value.website, null, "nothing released, no website");
  assert.match(flCall("get_customer", { customer_id: fl.nord }).value.note, /auf kein Projekt gesetzt/);
  assert.equal(flCall("get_customer", { customer_id: fl.other }).isError, true, "a customer they do not look after");
  assert.doesNotMatch(JSON.stringify(flCall("search", { query: "" }).value), /contact|mail-abc|@/);

  const project = flCall("get_project", { project_id: fl.web }).value;
  assert.equal(project.customer_id, fl.abc);
  const [start, imprint] = project.tasks;
  assert.deepEqual(
    [start.task_number, start.status, start.priority, start.assignees, start.assigned_to_me, start.checklist, start.comments, start.visible_to_customer, start.link],
    [7, "In Arbeit", "Hoch", ["Fiona Beispiel"], true, "1/3", 2, true, `${origin}/dashboard/projects/tasks?project=${fl.web}&task=7`],
  );
  assert.equal(imprint.priority, null);
  assert.equal("people" in project, false, "who can take a task only where Claude may write");
  assert.deepEqual(flCall("get_project", { project_id: fl.web }, { canWrite: true }).value.people.map((person) => [person.name, person.role, person.you ?? false]), [["Fiona Beispiel", "Freelancer (Beispiel GbR)", true], ["Teammitglied", "oalab-Team", false]]);
  assert.equal(flCall("get_project", { project_id: fl.other }).isError, true, "a project they are not on");

  assert.deepEqual(flCall("list_tasks", {}).value.tasks.map((item) => item.task_number), [7], "open by default");
  assert.deepEqual(flCall("list_tasks", { status: "all" }).value.tasks.map((item) => item.task_number), [7, 8]);
  assert.deepEqual(flCall("list_tasks", { status: "all", assigned: "me" }).value.tasks.map((item) => item.task_number), [7]);
  assert.equal(flCall("list_tasks", { customer_id: fl.nord }).value.total, 0);
  assert.equal(flCall("list_tasks", { project_id: fl.other }).isError, true);
  assert.equal(flCall("get_project", { project_id: fl.web }, { board: undefined }).isError, true, "no board, no answer");
});

test("freelancers: free times and checks exactly as the request window, only their own appointments", () => {
  const at = (day, time) => rules.wallTimeToUtc(day, time);
  const weekday = [[540, 1020]];
  const calendar = {
    availability: { week: [weekday, weekday, weekday, weekday, weekday, [], []], exceptions: [], rules: { notice: 0, buffer: 0, horizon: 8, durations: [30, 60] } },
    availabilityReady: true,
    busy: [{ start: at("2026-11-20", "10:00"), end: at("2026-11-20", "11:00") }],
    own: [
      { id: "a1", title: "Abstimmung", description: "", start: at("2026-11-20", "13:00"), end: at("2026-11-20", "14:00"), status: "requested", teamsUrl: null, responseNote: null },
      { id: "a2", title: "Kickoff", description: "Agenda", start: at("2026-11-23", "10:00"), end: at("2026-11-23", "11:00"), status: "confirmed", teamsUrl: "https://teams.microsoft.com/l/x", responseNote: null },
      { id: "a3", title: "Alt", description: "", start: at("2026-11-24", "10:00"), end: at("2026-11-24", "11:00"), status: "declined", teamsUrl: "https://teams.microsoft.com/l/y", responseNote: "Da sind wir nicht da." },
    ],
  };
  const slots = flCall("find_free_slots", { from: "2026-11-20", to: "2026-11-21", minutes: 60 }, { calendar }).value;
  assert.deepEqual(slots.days.map((day) => [day.day, day.starts]), [["2026-11-20", ["09:00", "11:00", "11:30", "12:00", "14:00", "14:30", "15:00", "15:30", "16:00"]]], "booked times and own requests stay free of starts; Saturday is off");
  assert.deepEqual(slots.rules.durations, [30, 60]);
  assert.match(flCall("find_free_slots", { minutes: 45 }, { calendar }).value, /30, 60 Minuten/, "only the durations oalab offers");

  const check = (start, day = "2026-11-20") => flCall("check_request_time", { day, start, minutes: 60 }, { calendar }).value;
  assert.deepEqual([check("14:00").requestable, check("14:00").text, check("14:00").end], [true, "Frei: Diese Zeit kannst du bei oalab anfragen.", "15:00"]);
  assert.match(check("10:00").text, /schon belegt/);
  assert.match(check("08:00").text, /in der Vergangenheit/);
  assert.match(check("10:00", "2026-11-21").text, /bietet oalab keine Termine an/);

  const listed = flCall("list_appointments", {}, { calendar }).value;
  assert.deepEqual(listed.appointments.map((item) => [item.title, item.status, item.teams_link]), [["Abstimmung", "Angefragt", null], ["Kickoff", "Bestätigt", "https://teams.microsoft.com/l/x"]]);
  assert.equal(listed.appointments[0].link, `${origin}/dashboard/projects/calendar?appointment=a1`);
  const declined = flCall("list_appointments", { status: "all" }, { calendar }).value.appointments.find((item) => item.title === "Alt");
  assert.deepEqual([declined.answer_from_oalab, declined.teams_link], ["Da sind wir nicht da.", null], "the answer of oalab; a Teams link only for a confirmed appointment");
  assert.equal(flCall("list_appointments", {}).isError, true, "no calendar, no answer");

  assert.deepEqual(freelancerTools.freelancerCalendarRange("check_request_time", { day: "2026-11-20" }, "2026-11-20"), { ok: true, from: "2026-11-20", to: "2026-11-20" });
  assert.equal(freelancerTools.freelancerCalendarRange("find_free_slots", { from: "2026-11-20", to: "2026-12-20" }, "2026-11-20").ok, false, "at most 14 days");
});

test("freelancers: read with their own claims, never the server key; the store checks the admin's switch on every use", async () => {
  const freelancer = await source("lib/hub-mcp/freelancer.ts");
  assert.doesNotMatch(freelancer, /supabase\/admin|createAdminClient|createOwnAdminClient|service_role/, "no server key in the freelancers' reads");
  assert.match(freelancer, /const claims = await connectorClaims\(userId\)/);
  assert.match(freelancer, /createOwnClaimsClient\(claims\)/);
  assert.match(freelancer, /loadFreelancerBoardAs\(connection\.userId, client\)/, "the board as the hub shows it to them");
  assert.match(freelancer, /loadFreelancerCardsWith\(client\)/, "only what oalab released");
  assert.match(freelancer, /\.from\("hub_appointments"\)[^;]*\.in\("customer_id", entries\)/, "only the entries the login belongs to");
  assert.ok(freelancer.indexOf("hasScope(connection.scopes, tool.scope)") < freelancer.indexOf("freelancerClient(connection.userId)"), "the right first");
  assert.match(await source("lib/hub-tasks/server.ts"), /export async function loadFreelancerBoardAs\(viewerId: string, session: SupabaseClient\)[^]*?return freelancerBoard\(viewerId, session, db\);/);
  assert.match(await source("lib/hub-freelancer-customers/server.ts"), /supabase\.rpc\("hub_freelancer_customer_cards"\);\s+return error \? null : parseCards\(data, readable\);/);

  // Every use: an active admin, or an active, unbanned freelancer with the switch on, within 30 days of „Erlauben“.
  const store = await source("lib/hub-mcp/store.ts");
  const gate = store.slice(store.indexOf("const allowedLogin"), store.indexOf("const ALLOWED"));
  for (const part of ["p.status = 'active'", "u.banned_until is null", "= 'oalab_admin'", "= 'oalab_freelancer'", "${CLAUDE_SWITCH}', '') = 'true'", "${since} > now() - make_interval(days => ${FREELANCER_CONNECTION_DAYS})"]) {
    assert.ok(gate.includes(part), part);
  }
  assert.match(store, /const ALLOWED = allowedLogin\("c\.user_id", "c\.created_at"\);/);
  assert.match(store, /where \$\{allowedLogin\("\$1", "now\(\)"\)\}/, "connecting checks the same");
  assert.equal((store.match(/\$\{ALLOWED\}/g) ?? []).length, 3, "refresh, every request and the list of connections");
  assert.doesNotMatch(store, /ACTIVE_ADMIN/);
  assert.match(store, /role: row\.app_role === "oalab_admin" \? "admin" : "freelancer"/);
  assert.match(store, /export async function disconnectAll\(userId: string\)/);

  // The consent page: freelancers without the switch hear why; with it, they see their own rights and the 30 days.
  const consent = await source("lib/hub-mcp/consent.ts");
  assert.match(consent, /if \(role === "off"\) return \{ kind: "not-allowed", request \};/);
  assert.match(consent, /const labels = role === "admin" \? scopeLabels : freelancerScopeLabels;/);
  const page = await source("components/hub/claude-consent.tsx");
  assert.match(page, /state\.kind === "not-allowed"[^]*Noch nicht freigeschaltet/);
  assert.match(page, /Claude arbeitet dann mit deinen Rechten als Freelancer/);
  assert.match(page, /Die Verbindung gilt \{state\.days\} Tage\./);

  // The admin's switch at a freelancer login, and what it does.
  const users = await source("lib/hub-users/actions.ts");
  const setter = users.slice(users.indexOf("export async function setHubUserClaude"), users.indexOf("export async function loadHubUserClaude"));
  assert.ok(setter.indexOf("await context()") < setter.indexOf("updateUserById"), "an active admin first");
  assert.match(setter, /if \(roleOf\(user\) !== "oalab_freelancer"\) return failed\(/, "freelancer logins only");
  assert.match(setter, /app_metadata: \{ \[CLAUDE_SWITCH\]: allowed \? true : null \}/);
  assert.match(setter, /const ended = allowed \? 0 : await disconnectAll\(user\.id\)/, "off ends every connection");
  assert.match(setter, /await log\(ctx, allowed \? "user\.claude_on" : "user\.claude_off"/);
  for (const name of ["loadHubUserClaude", "disconnectHubUserClaude"]) {
    const body = users.slice(users.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /roleOf\(user\) !== "oalab_freelancer"\) return failed\(/, name);
  }
  assert.match(await source("lib/hub-users/server.ts"), /claude: roleOf\(user\) === "oalab_freelancer" && \(user\.app_metadata as Record<string, unknown> \| undefined\)\?\.\[CLAUDE_SWITCH\] === true,/);
  assert.match(await source("components/hub/screens/users-dialogs.tsx"), /\{freelancerLogin && user\.status !== "rejected" && <ClaudeLoginRow user=\{user\} name=\{fullName\(user\)\} onNotice=\{onNotice\} \/>\}/);
  // The profile card: freelancers see it only once the switch is on.
  const card = await source("components/hub/connected-apps-card.tsx");
  assert.match(card, /if \(freelancer && !\(state\?\.enabled && state\.allowed\)\) return null;/);
  assert.match(await source("components/hub/screens/workspace.tsx"), /\{!preview && \(account\.admin \|\| account\.freelancer\) && <ConnectedAppsCard freelancer=\{!account\.admin\} \/>\}/);
});

test("freelancers: writing goes through the board's and the request window's own code, with their claims, logged, never deleting", async () => {
  const writes = await source("lib/hub-mcp/freelancer-writes.ts");
  for (const core of ["createTaskAs(", "saveSubtaskAs(", "updateTaskAs(", "moveTaskAs(", "addCommentAs(", "requestAppointmentAs(", "withdrawRequestAs("]) assert.ok(writes.includes(core), core);
  for (const admin of ["writeAppointment(", "closeAppointmentAs(", "createProjectAs("]) assert.ok(!writes.includes(admin), `${admin} stays with the admins`);
  // The board's own context for freelancers: every write and every check with their claims; their guard decides.
  assert.match(writes, /const taskContext = \(w: Writer\): TaskContext => \(\{ userId: w\.userId, supabase: w\.client, read: w\.client, db: w\.db, freelancer: true \}\);/);
  assert.match(writes, /async function findTask[^]*?await w\.client\.from\("studio_tasks"\)/, "cards as they see them: no „Nur Team“");
  assert.match(writes, /const column = await w\.client\.from\("studio_tasks"\)/);
  assert.doesNotMatch(writes, /\.delete\(|archived: true|refreshWorkspace|revalidate|w\.db\.from\(/, "no deleting, no archiving, no reads with the server key");
  // Their own projects only, checked before the first write; who sees a card stays with the team.
  for (const name of ["createTasks", "updateTask", "moveTask", "addTaskComment"]) {
    const start = writes.indexOf(`async function ${name}(`);
    const body = writes.slice(writes.indexOf("\n", start), writes.indexOf("\n}\n", start));
    assert.match(body, /const project = await ownProject\(w, [^)]+\);\s+if \(!project\) return refuse\(noProject\);/, name);
    const firstWrite = body.search(/\b(createTaskAs|updateTaskAs|moveTaskAs|addCommentAs|onCurrentTask)\(/);
    assert.ok(firstWrite > 0 && body.indexOf("ownProject(") < firstWrite, `${name}: checked before writing`);
  }
  assert.match(writes, /const projectsOf = \(w: Writer\) => \(w\.projects \?\?= loadFreelancerBoardAs\(w\.userId, w\.client\)/);
  assert.match(writes, /args\.tasks\.some\(hasAudience\)\) return refuse\(teamDecides\);/);
  assert.match(writes, /if \(hasAudience\(fields\)\) return refuse\(teamDecides\);/);
  assert.match(writes, /item\.patch\.assigneeIds === undefined \? \{ \.\.\.item\.patch, assigneeIds: \[w\.userId\] \} : item\.patch/, "the new card is theirs, as in the board's form");
  // Requests: only their own entries; a confirmed appointment is cancelled by the team only.
  assert.match(writes, /\.from\("hub_appointments"\)\.select\("id, title, status"\)\.eq\("id", id\)\.in\("customer_id", entries\)/);
  assert.match(writes, /if \(data\.status === "confirmed"\) return refuse\(/);
  for (const action of ["claude.tasks.created", "claude.task.updated", "claude.task.moved", "claude.task.commented", "claude.appointment.requested", "claude.appointment.withdrawn", "claude.task.checklist"]) assert.ok(writes.includes(`"${action}"`), action);
  assert.equal((writes.match(/\(Freelancer\)`/g) ?? []).length, 7, "the admin log says a freelancer did it");

  // The request window and Claude share one core; the Server Actions only add the session and the refresh.
  const calendar = await source("lib/hub-calendar/actions.ts");
  assert.match(calendar, /const result = await requestAppointmentAs\(session\.supabase, session\.userId, input\);/);
  assert.match(calendar, /const result = await withdrawRequestAs\(session\.supabase, id\);/);
  const core = await source("lib/hub-calendar/write.ts");
  const request = core.slice(core.indexOf("export async function requestAppointmentAs"), core.indexOf("export async function withdrawRequestAs"));
  assert.match(request, /readAvailabilityRequest\(input, availability, intervals\(busy\.data\), intervals\(own\.data\), now, dayOf\(now\)\)/);
  assert.match(request, /\(open\.count \?\? 0\) >= MAX_OPEN_REQUESTS/);
  assert.match(request, /error\?\.code === "42501"/);
  assert.doesNotMatch(core, /refreshWorkspace|"use server"/);

  // The server: the right first, then the write with the same claims as the reads.
  const freelancer = await source("lib/hub-mcp/freelancer.ts");
  assert.ok(freelancer.indexOf("hasScope(connection.scopes, tool.scope)") < freelancer.indexOf("runFreelancerWrite("), "the right to write first");
  assert.match(freelancer, /if \(tool\.needs === "write"\) return runFreelancerWrite\(connection, name, args, context, client\);/);
});

/* ---------- Notes (since 23.11.2026): read and write pages through the notes' own code, with the person's claims ---------- */

const notesTools = await import("../lib/hub-mcp/notes-tools.ts");

test("notes: the team's tools and the freelancers' few, strict, every change asking first, the trash at most", () => {
  const admin = notesTools.notesTools("admin");
  assert.deepEqual(admin.map((tool) => tool.name), [...NOTES_READ, ...NOTES_WRITE]);
  const freelancer = notesTools.notesTools("freelancer");
  assert.deepEqual(freelancer.map((tool) => tool.name), [...FREELANCER_NOTES_READ, ...FREELANCER_NOTES_WRITE], "no release, notice, history, meeting note or trash for freelancers");
  for (const tool of [...admin, ...freelancer]) {
    const writes = tool.scope === "hub:write";
    assert.equal(writes, NOTES_WRITE.includes(tool.name), tool.name);
    assert.equal(tool.annotations.destructiveHint, writes, `${tool.name}: Claude asks before every change`);
    assert.equal(typeof tool.description, "string", `${tool.name}: one text per role`);
  }
  // The freelancers' words: their pages are always „Nur Freelancer“, other pages they only read.
  const create = freelancer.find((tool) => tool.name === "create_note");
  assert.match(create.description, /immer „Nur Freelancer“/);
  assert.match(freelancer.find((tool) => tool.name === "update_note").description, /Andere Seiten kannst du nur lesen/);
  assert.match(admin.find((tool) => tool.name === "create_note").description, /set_note_visibility/);
  // How Claude writes a page: Markdown and the hub's blocks as oalab: links on their own line.
  assert.match(notesTools.NOTE_MARKDOWN_HELP, /oalab:task\/<project_id>\/<task_number>/);
  assert.match(notesTools.NOTE_MARKDOWN_HELP, /"Linkkarte"/);
  assert.match(create.description, /oalab:page\/<page_id>/);
  // Replacing the content needs the version Claude read; adding does not.
  const update = admin.find((tool) => tool.name === "update_note");
  assert.deepEqual(update.inputSchema.properties.content_mode.enum, ["replace", "append", "prepend"]);
  assert.match(update.description, /braucht dafür die version aus read_note/);
  assert.deepEqual(admin.find((tool) => tool.name === "set_note_visibility").inputSchema.properties.audience.enum, ["team", "both", "customer", "freelancer"]);
  assert.equal(tools.runHubTool("read_note", { page_id: ids.abc }, { origin, today: "2026-11-23", now: 0 }).isError, true, "the pure runner never reads notes");
  assert.equal(freelancerTools.runFreelancerTool("read_note", { page_id: ids.abc }, { origin, today: "2026-11-23", now: 0 }).isError, true);
  // The rights as the consent page and the profile card name them.
  assert.match(config.scopeLabels["hub:read"], /Notizen/);
  assert.match(config.scopeLabels["hub:write"], /Notizen anlegen und ändern, Notizen freigeben und in den Papierkorb legen/);
  assert.match(config.freelancerScopeLabels["hub:write"], /eigene Notizseiten schreiben/);
});

test("notes: through the notes' own code with the person's claims, logged as claude.note.*, never deleting for good", async () => {
  const notes = await source("lib/hub-mcp/notes.ts");
  assert.match(notes, /^import "server-only";/);
  assert.match(notes, /const claims = await connectorClaims\(connection\.userId\)/);
  assert.match(notes, /session: createOwnClaimsClient\(claims\) as unknown as SupabaseClient,/);
  assert.match(notes, /viewer: connection\.role === "admin" \? "admin" : "freelancer",/);
  assert.match(notes, /via: "claude",/);
  for (const core of ["createPageAs(", "savePageAs(", "setAudienceAs(", "notifyChangeAs(", "createMeetingNoteAs(", "trashPageAs(", "restorePageAs(", "restoreRevisionAs(", "searchNotesAs(", "noteHistoryAs(", "readPage(", "readPages(", "notesCustomers("]) {
    assert.ok(notes.includes(core), core);
  }
  assert.doesNotMatch(notes, /purgePageAs|listTrashAs|\.delete\(|"use server"/, "no final delete, not even the trash's tidying");
  // Replacing the content needs the version Claude read and never goes on over a newer page.
  assert.match(notes, /if \(typeof args\.content === "string" && mode === "replace" && !explicit\) \{/);
  assert.match(notes, /if \(!result\.ok && result\.stale && !explicit\) \{/);
  // Blocks new on a page must belong to its customer and be visible to the person.
  assert.match(notes, /const problem = await foreignBlocks\(ctx, customer, parsed\.doc, before, projectIds\);/);
  assert.match(notes, /await logNoteEvent\(ctx, "note\.updated", "Notiz geändert", page\.customerId\);/);
  // The notes' code logs Claude's changes as claude.note.*, and signs nothing for display without a browser.
  const write = await source("lib/hub-notes/write.ts");
  assert.match(write, /action: claude \? `claude\.\$\{action\}` : action/);
  assert.match(write, /· über Claude\$\{ctx\.viewer === "freelancer" \? " \(Freelancer\)" : ""\}/);
  const server = await source("lib/hub-notes/server.ts");
  assert.match(server, /const logos = ctx\.via \? new Map<string, CustomerLogo>\(\) : await loadCustomerLogos\(/);
  assert.match(server, /if \(ctx\.via\) return \{ \.\.\.cover, url: null \};/);
  // Admins and freelancers reach the notes only after the right is checked, each with their own claims.
  const admin = await source("lib/hub-mcp/server.ts");
  assert.ok(admin.indexOf("hasScope(connection.scopes, tool.scope)") < admin.indexOf("runNotesTool("));
  const freelancer = await source("lib/hub-mcp/freelancer.ts");
  assert.ok(freelancer.indexOf("hasScope(connection.scopes, tool.scope)") < freelancer.indexOf("runNotesTool("));
  assert.ok(freelancer.indexOf("runNotesTool(") < freelancer.indexOf("freelancerClient(connection.userId)"), "no board or calendar is loaded for notes");
});

/* ---------- Stage 2 (23.11.2026): projects, task details, checklists, „Beteiligte“ and the availability ---------- */

test("stage 2: Claude's arguments become what the project panel, the checklist and „Verfügbarkeit“ send", () => {
  const project = input.readProjectUpdate({ project_id: ids.web, name: "Relaunch", start_date: null, due_date: "2026-12-20", milestones: [{ name: "Live", date: "2026-12-18" }], live_url: "", visible: true, status: "active" });
  assert.deepEqual(project, { ok: true, value: { projectId: ids.web, patch: { name: "Relaunch", startDate: null, dueDate: "2026-12-20", milestones: [{ name: "Live", date: "2026-12-18" }], liveUrl: "", clientVisible: true }, status: "active" } });
  // The panel's own checks run on it (lib/hub-projects/edit.ts readProjectPatch): an empty address clears it.
  const checked = projectEdit.readProjectPatch(project.value.patch);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.liveUrl, null);
  assert.equal(input.readProjectUpdate({ project_id: ids.web }).ok, false, "nothing to change");
  assert.equal(input.readProjectUpdate({ project_id: ids.web, visible: "ja" }).ok, false);
  assert.equal(input.readProjectUpdate({ project_id: ids.web, status: "complete" }).ok, true, "the status alone is a change");

  const checklist = input.readChecklistChange({ points: [{ point_id: ids.abc, done: true }, { point_id: ids.mueller, title: "Neu" }], add: ["Dritter Punkt"] });
  assert.deepEqual(checklist, { ok: true, value: { points: [{ id: ids.abc, done: true }, { id: ids.mueller, title: "Neu" }], add: ["Dritter Punkt"] } });
  for (const bad of [{}, { points: [{ point_id: ids.abc }] }, { points: [{ done: true }] }, { add: [""] }, { points: [{ point_id: ids.abc, done: true }, { point_id: ids.abc, done: false }] }]) {
    assert.equal(input.readChecklistChange(bad).ok, false, JSON.stringify(bad));
  }

  assert.deepEqual(input.readExceptionArgs({ kind: "off", from: "2026-12-24", until: "2026-12-31", all_day: true, note: "Urlaub" }).value,
    { kind: "off", from: "2026-12-24", until: "2026-12-31", allDay: true, start: undefined, end: undefined, note: "Urlaub" });
  assert.equal(input.readExceptionArgs({ kind: "extra", from: "2026-12-05", until: "2026-12-06", start: "10:00", end: "12:00" }).ok, false, "extra time is one day");
  assert.equal(input.readExceptionArgs({ kind: "off", from: "2026-12-05", all_day: true, start: "10:00" }).ok, false);
  assert.equal(input.readExceptionArgs({ kind: "pause", from: "2026-12-05" }).ok, false);
  // The panel's own rules decide what is stored (lib/hub-calendar/rules.ts readException).
  const rows = rules.readException(input.readExceptionArgs({ kind: "off", from: "2026-12-24", until: "2026-12-26", all_day: true }).value, "2026-11-23");
  assert.deepEqual(rows.ok && rows.rows.map((row) => [row.day, row.from, row.to]), [["2026-12-24", null, null], ["2026-12-25", null, null], ["2026-12-26", null, null]]);
});

test("stage 2: the availability as the panel shows it, and who may be put on a project", () => {
  const week = rules.DEFAULT_AVAILABILITY.week;
  const calendar = {
    appointments: [],
    availabilityReady: true,
    availability: { ...rules.DEFAULT_AVAILABILITY, week, exceptions: [
      { id: "x1", day: "2026-11-27", kind: "off", from: null, to: null, note: "Messe" },
      { id: "x2", day: "2026-11-25", kind: "extra", from: 1080, to: 1200, note: "" },
      { id: "x3", day: "2027-03-01", kind: "off", from: null, to: null, note: "später" },
    ] },
  };
  const result = tools.runHubTool("get_availability", {}, { origin, today: "2026-11-23", now: Date.parse("2026-11-23T08:00:00Z"), calendar });
  const value = JSON.parse(result.content[0].text);
  assert.equal(value.from, "2026-11-23");
  assert.equal(value.to, "2026-12-20", "four weeks without days");
  assert.deepEqual(value.week[0], { weekday: "Montag", times: ["09:00–17:00"] });
  assert.deepEqual(value.week[6], { weekday: "Sonntag", times: [] });
  assert.deepEqual(value.exceptions, [
    { day: "2026-11-25", weekday: "Mittwoch", kind: "zusätzliche Zeit", time: "18:00–20:00", note: null },
    { day: "2026-11-27", weekday: "Freitag", kind: "nicht verfügbar", time: "ganztags", note: "Messe" },
  ]);
  assert.equal(value.rules.horizon, "8 Wochen im Voraus");
  assert.equal(tools.runHubTool("get_availability", { from: "2026-11-01", to: "2027-02-01" }, { origin, today: "2026-11-23", now: 0, calendar }).isError, true, "at most 62 days");

  const freelancers = [{ id: "77777777-7777-4777-8777-777777777777", name: "Beispiel GbR", number: "FL-1", onProject: false }];
  const project = call("get_project", { project_id: ids.web }, { freelancers }).value;
  assert.deepEqual(project.freelancers, [{ freelancer_id: freelancers[0].id, name: "Beispiel GbR", number: "FL-1", on_project: false }]);
  assert.equal("freelancers" in call("get_project", { project_id: ids.web }).value, false, "only where Claude may write");
  assert.equal(tools.runHubTool("get_task", { project_id: ids.web, task_number: 7 }, { origin, today: "2026-11-23", now: 0 }).isError, true, "the pure runner reads no card");
});

test("stage 2: through the project page's, the board's and the calendar's own cores, logged, never deleting", async () => {
  const writes = await source("lib/hub-mcp/writes.ts");
  const update = writes.slice(writes.indexOf("async function updateProject("), writes.indexOf("async function updateChecklist("));
  assert.match(update, /if \(!project \|\| project\.archived\) return refuse\(noProject\);/);
  assert.ok(update.indexOf("project.archived") < update.indexOf("saveProjectDetailsAs("), "checked before writing");
  assert.match(update, /saveProjectDetailsAs\(team, \{ projectId, expectedVersion: version, patch \}, "claude"\)/);
  assert.match(update, /setProjectStatusAs\(team, \{ projectId, status, expectedVersion: version \}, "claude"\)/);
  // A change made in between: once more on the version Studio has now, never more than once.
  assert.match(update, /result\.error === staleDetails\.error\) result = await saveProjectDetailsAs\(/);
  assert.match(update, /result\.error === staleStatus\.error\) result = await setProjectStatusAs\(/);
  const freelancer = writes.slice(writes.indexOf("async function setProjectFreelancer("), writes.indexOf("async function addAvailabilityException("));
  assert.match(freelancer, /const choices = await loadProjectFreelancers\(w\.db, args\.project_id\);/, "only freelancers who look after the customer");
  assert.match(freelancer, /setProjectFreelancerAs\(taskContext\(w\), /);
  assert.match(writes, /addAvailabilityExceptionAs\(calendarClient\(w\), read\.value, w\.today\)/);
  for (const action of ["claude.task.checklist", "claude.project.freelancer_on", "claude.project.freelancer_off", "claude.availability.exception"]) assert.ok(writes.includes(action), action);
  assert.doesNotMatch(writes, /\.delete\(|archived: true|refreshWorkspace|revalidate/, "still no deleting, no archiving, no Server Action helpers");

  // The cores are shared with the hub's windows, which only add who may call and the refresh.
  const projects = await source("lib/hub-projects/write.ts");
  assert.match(projects, /action: via === "claude" \? "claude\.project\.saved" : "project\.saved"/);
  assert.match(projects, /action: via === "claude" \? "claude\.project\.status_set" : "project\.status_set"/);
  const tasks = await source("lib/hub-tasks/write.ts");
  for (const core of ["export async function setProjectFreelancerAs(", "export async function readTaskDetailAs("]) assert.ok(tasks.includes(core), core);
  const calendar = await source("lib/hub-calendar/write.ts");
  assert.match(calendar, /export async function addAvailabilityExceptionAs\(supabase: CalendarClient, input: ExceptionInput, today: string\)/);
  assert.match(await source("lib/hub-calendar/actions.ts"), /const result = await addAvailabilityExceptionAs\(supabase, input, dayOf\(Date\.now\(\)\)\);/);

  // One card for get_task: admins with the server key after their checks, freelancers with their own claims and only
  // in the projects of their own board; the checklist through the window's own code, removing stays in the hub.
  const board = await source("lib/hub-mcp/board.ts");
  assert.match(board, /^import "server-only";/);
  assert.match(board, /const detail = await readTaskDetailAs\(input\.read, row\.id\);/);
  assert.match(board, /const \[board, db\] = \[await loadFreelancerBoardAs\(userId, client\), createAdminClient\(\)\];/);
  assert.match(board, /return taskAnswer\(\{ read: client, db, project:/);
  assert.match(board, /saveSubtaskAs\(ctx, \{ taskId, subtaskId: stored\.id,/);
  assert.doesNotMatch(board, /\.delete\(|deleteSubtask/);
  const server = await source("lib/hub-mcp/server.ts");
  assert.match(server, /if \(tool\.needs === "task"\) return readTaskForAdmin\(args, origin\);/);
  assert.match(server, /archive\.organizationIds\.has\(project\.data\.organization_id\)\) return refusal\(/, "no card of an archived customer");
  const flWrites = await source("lib/hub-mcp/freelancer-writes.ts");
  const checklist = flWrites.slice(flWrites.indexOf("async function updateChecklist("));
  assert.ok(checklist.indexOf("ownProject(") < checklist.indexOf("changeChecklist("), "their own project first");
});
