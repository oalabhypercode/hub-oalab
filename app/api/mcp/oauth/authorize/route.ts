import { connection } from "next/server";
import { CONSENT_PATH } from "@/lib/hub-mcp/config";
import { authorizeProblem, grantScopes, pickRedirect, readAuthorizeParams, readClientId, withParams } from "@/lib/hub-mcp/oauth";
import { connectorReady, savePendingRequest } from "@/lib/hub-mcp/store";
import { fetchClientDocument, publicOrigin } from "@/lib/hub-mcp/server";
import { messagePage, NO_STORE, notFound } from "@/lib/hub-mcp/http";

// Step 1 of the sign-in: Claude sends the admin's browser here. Only Claude's apps with Claude's return address get
// as far as the question; the checked request waits (15 minutes) until the admin answers on the consent page, after
// signing in and confirming the code there if needed. Problems the app should hear about go back to it.

export async function GET(request: Request) {
  // Answered per request, never prerendered: the switch may change without a new build.
  await connection();
  if (!connectorReady()) return notFound();
  const origin = publicOrigin(request);
  const params = readAuthorizeParams(new URL(request.url).searchParams);

  const clientId = readClientId(params.clientId);
  if (!clientId) return messagePage(400, "Diese App darf sich nicht mit dem Hub verbinden. Verbinden lässt sich nur Claude.");
  const document = await fetchClientDocument(clientId);
  if (!document.ok) return messagePage(502, document.error);
  const redirectUri = pickRedirect(params.redirectUri, document.value);
  if (!redirectUri) return messagePage(400, "Die Rücksprungadresse dieser Anfrage gehört nicht zu Claude.");

  const back = (error: string, description: string) => Response.redirect(withParams(redirectUri, { error, error_description: description, state: params.state, iss: origin }), 303);
  const problem = authorizeProblem(params, origin);
  if (problem) return back(problem.error, problem.description);

  const token = await savePendingRequest({
    clientId,
    clientName: document.value.name,
    redirectUri,
    state: params.state,
    codeChallenge: params.codeChallenge!,
    scopes: grantScopes(params.scope),
  }).catch(() => null);
  if (!token) return back("temporarily_unavailable", "The hub could not keep the request. Please try again.");
  return new Response(null, { status: 303, headers: { Location: `${origin}${CONSENT_PATH}?request=${token}`, ...NO_STORE } });
}
