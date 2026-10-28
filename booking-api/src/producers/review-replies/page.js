// The owner's preview of review replies waiting for approval: each review (stars, text) next to the reply we would post.
import { escapeHtml } from "../../lib/email.js";
import { parseJsonOrNull } from "../../lib/http.js";

const e = escapeHtml;
const stars = (n) => (n ? `${"★".repeat(n)}${"☆".repeat(5 - n)}` : "No rating");

function draftsPageHtml({ business, rows, autoCount = 0, profile = "" }) {
  const items = rows.map((row, i) => {
    const problems = parseJsonOrNull(row.problems_json) || [];
    return `<section class="r${Number(row.star_rating) <= 2 ? " low" : ""}"><p class="meta"><span class="stars">${stars(Number(row.star_rating))}</span> ${e(row.reviewer_name || "A Google user")}${row.review_time ? ` · ${e(String(row.review_time).slice(0, 10))}` : ""}</p>
<blockquote>${e(row.review_text || "(rating only, no text)")}</blockquote>
<p class="label">Reply we will post${problems.length ? ` <span class="warn">${e(row.route_reason || "")}</span>` : ""}</p>
<div class="reply">${e(row.draft_reply || "(no draft)").replaceAll("\n", "<br>")}</div><p class="n">${i + 1} of ${rows.length}</p></section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(business)} review replies</title>
<style>body{margin:0;background:#f4f1ec;font:16px/1.55 system-ui,sans-serif;color:#1d1d1b}main{max-width:720px;margin:0 auto;padding:24px 16px 48px}h1{font-size:26px;margin:0 0 6px}.r{background:#fff;border:1px solid #e3ddd2;border-left:6px solid #c9a227;border-radius:8px;padding:8px 16px;margin:16px 0}.low{border-left-color:#b3261e}.meta{margin:8px 0;color:#4a4a45}.stars{color:#b8860b;letter-spacing:1px}blockquote{margin:0;padding:8px 12px;background:#f7f4ee;border-radius:6px}.label{font-size:13px;font-weight:700;margin:14px 0 4px;color:#08747b}.reply{padding:10px 12px;border:1px dashed #9fc9cc;border-radius:6px}.warn{color:#9b1c1c;font-weight:400}.n{font-size:12px;color:#8a857c;text-align:right;margin:6px 0}</style></head>
<body><main><h1>${e(business)}</h1><p>${rows.length} repl${rows.length === 1 ? "y waits" : "ies wait"} for your OK before we post ${rows.length === 1 ? "it" : "them"} on Google${profile ? ` (${e(profile)})` : ""}.${autoCount ? ` ${autoCount} repl${autoCount === 1 ? "y" : "ies"} to 4 and 5 star reviews went out automatically.` : ""}</p>${items}
<p>Approve from the email to post all of these. To change one, use "Request changes" on the approve page and say what to change (or which review not to answer).</p></main></body></html>`;
}

export { draftsPageHtml };
