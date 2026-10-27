// Subdomain hosting (stage 7): <name>.menu-made.com serves the site called <name>.
// Cloudflare runs this Worker for every *.menu-made.com hostname once the wildcard route exists, which includes www and any
// other subdomain that already does something else. So the rule is: names we reserve (www, mail, api, ...) are passed straight
// through to whatever served them before, EXCEPT /api/ on www, which the Worker has always handled; every other name is a
// customer site. Without the wildcard DNS record and route none of this ever runs, so it is safe to deploy first.
import { publicBaseUrl } from "../../lib/config.js";
import { RESERVED } from "./intake.js";

function siteHostAction(request, env) {
  const url = new URL(request.url);
  let root;
  try { root = new URL(publicBaseUrl(env)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return { action: "none" }; }
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(`.${root}`)) return { action: "none" };
  const label = host.slice(0, -(root.length + 1));
  if (!label || label.includes(".")) return { action: "none" };
  if (RESERVED.has(label)) return url.pathname.startsWith("/api/") ? { action: "none" } : { action: "pass" };
  return { action: "site", slug: label, path: url.pathname.replace(/^\/+/, "") };
}

export { siteHostAction };
