// Stage 12, task 7: GitHub refusing to start a job. The worker starts four GitHub workflows itself (Store App builds,
// social post renders, native push, the owner's GitHub alarm) with GITHUB_DISPATCH_TOKEN. 401, 403 or 404 means the
// token expired, lost its access or the workflow is gone: nothing retries its way out of that, so the owner gets one
// email a day until it's fixed. Other refusals (GitHub briefly down) are left to each feature's own retry and wait.
import { alertOnce } from "./alert-once.js";
import { brandedEmailHtml, sendTransactionalEmail } from "./email.js";
import { ownerEmailAddress } from "./config.js";

const DAY_MS = 86400000;

async function dispatchRefused(env, status, what, now = Date.now()) {
  if (![401, 403, 404].includes(Number(status))) return { alerted: false };
  if (!(await alertOnce(env, "github-dispatch", DAY_MS, now))) return { alerted: false };
  const heading = "GitHub refused to start a job";
  const why = Number(status) === 404 ? "GitHub couldn't find the workflow, or the token can no longer see the MENU repository" : "the GitHub token the worker uses has expired or lost its access";
  const paragraphs = [
    `GitHub answered HTTP ${status} when the worker tried to start: ${what}. That usually means ${why}.`,
    "Until it's fixed, Store App builds, social post images and app notifications wait (nothing is lost; they start as soon as GitHub accepts again).",
    "What to do: tell Claude \"GitHub token refused\". It will walk you through making a new token, about 3 minutes."
  ];
  const sent = await sendTransactionalEmail(env, {
    to: ownerEmailAddress(env), subject: heading,
    html: brandedEmailHtml({ preheader: paragraphs[0], eyebrow: "AUTOMATION ALERT", heading, paragraphs }),
    text: `${heading}\n\n${paragraphs.join("\n\n")}`,
    idempotencyKey: `github-dispatch-refused/${new Date(now).toISOString().slice(0, 10)}`, purpose: "AUTOMATION_ALERT", templateKey: "github_dispatch_refused_v1"
  }).catch(() => ({ ok: false }));
  return { alerted: Boolean(sent?.ok) };
}

export { dispatchRefused };
