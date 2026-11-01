import test from "node:test";
import assert from "node:assert/strict";
import { sendNinoMail, NINO_FROM, NINO_REPLY_TO, NINO_NEWS_FROM } from "./src/nino-mail.js";

const env = { RESEND_API_KEY: "re_fixture_not_a_key" };
const ok = { to: "buyer@example.com", subject: "Your order", html: "<p>Hi</p>", text: "Hi" };

test("Nino mail is sent through Resend under Nino's name with replies to Nino", async () => {
  let sent;
  const result = await sendNinoMail(env, ok, async (url, init) => { sent = { url, init }; return Response.json({ id: "em_1" }); });
  assert.equal(result.id, "em_1");
  assert.equal(sent.url, "https://api.resend.com/emails");
  const body = JSON.parse(sent.init.body);
  assert.equal(body.from, NINO_FROM); assert.equal(body.reply_to, NINO_REPLY_TO); assert.deepEqual(body.to, ["buyer@example.com"]);
  assert.equal(body.bcc, undefined);
});

test("the caller cannot change the sender, and bad messages are refused before Resend", async () => {
  let calls = 0; const fetcher = async () => { calls++; return Response.json({ id: "x" }); };
  const body = await (async () => { let b; await sendNinoMail(env, { ...ok, from: "ceo@bank.com", reply_to: "x@evil.com" }, async (u, i) => { b = JSON.parse(i.body); return Response.json({}); }); return b; })();
  assert.equal(body.from, NINO_FROM); assert.equal(body.reply_to, NINO_REPLY_TO);
  for (const bad of [{ ...ok, to: "not an email" }, { ...ok, to: ["a@b.com"] }, { ...ok, subject: "" }, { ...ok, html: 5 }]) {
    await assert.rejects(sendNinoMail(env, bad, fetcher));
  }
  await assert.rejects(sendNinoMail({}, ok, fetcher), /nino_mail_not_configured/);
  assert.equal(calls, 0);
});

test("a Resend error is reported", async () => {
  await assert.rejects(sendNinoMail(env, ok, async () => Response.json({ message: "domain not verified" }, { status: 403 })), /nino_mail_resend_403: domain not verified/);
});

test("newsletter mail comes from the news address with a one-click unsubscribe, and only the shop's unsubscribe link is accepted", async () => {
  const link = `https://nino-printful-commerce-api.ijpbattaglia.workers.dev/api/unsubscribe?t=${"a".repeat(48)}`;
  let body;
  await sendNinoMail(env, { ...ok, kind: "news", unsubscribe: link }, async (u, i) => { body = JSON.parse(i.body); return Response.json({ id: "n1" }); });
  assert.equal(body.from, NINO_NEWS_FROM);
  assert.deepEqual(body.headers, { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  const never = async () => { throw new Error("should not send"); };
  await assert.rejects(sendNinoMail(env, { ...ok, kind: "news" }, never), /needs_unsubscribe/);
  await assert.rejects(sendNinoMail(env, { ...ok, kind: "news", unsubscribe: "https://evil.example/api/unsubscribe?t=" + "a".repeat(48) }, never), /needs_unsubscribe/);
  await assert.rejects(sendNinoMail(env, { ...ok, kind: "promo" }, never), /invalid_kind/);
  let plain; await sendNinoMail(env, ok, async (u, i) => { plain = JSON.parse(i.body); return Response.json({}); });
  assert.equal(plain.from, NINO_FROM); assert.equal(plain.headers, undefined);
});
