// Stage 11 part 2: hands the App Store Connect API key to the Store App build (.github/workflows/store-app-build.yml).
//   GET /api/store-build/credentials?scope=owner   Bearer <GitHub Actions OIDC token, audience menu-made-store-build>
// Only that workflow, on master of JPBattaglia/MENU, and only on a manual run (workflow_dispatch: the worker or the owner
// starting it) gets an answer; push-triggered builds are unsigned and never ask. The repo is public, so the workflow
// masks every line of the key before writing it to a file and never prints it.
import { verifyRenderer } from "../producers/social-posts/render-jobs.js";
import { loadCredential } from "./keys.js";

const BUILD_AUDIENCE = "menu-made-store-build";
const BUILD_WORKFLOW = "JPBattaglia/MENU/.github/workflows/store-app-build.yml@refs/heads/master";
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

async function handleBuildCredentials(request, env) {
  const auth = await verifyRenderer(request, env, { audience: BUILD_AUDIENCE, workflow: BUILD_WORKFLOW, events: ["workflow_dispatch"] });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const scope = new URL(request.url).searchParams.get("scope") || "owner";
  if (scope !== "owner") return json({ ok: false, error: "Unknown scope" }, 404); // restaurants' scopes come with the producer
  let api;
  try { api = await loadCredential(env, scope, "APPLE_API_KEY"); } catch { return json({ ok: false, error: "Stored key is not readable" }, 500); }
  if (!api || api.status !== "VERIFIED") return json({ ok: false, error: "No verified App Store Connect API key for this scope" }, 409);
  return json({ ok: true, apple: { key_id: api.keyId, issuer_id: api.issuerId, team_id: api.teamId, p8: api.p8 } });
}

export { BUILD_AUDIENCE, BUILD_WORKFLOW, handleBuildCredentials };
