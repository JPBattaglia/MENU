// Deployed entry module for the menu-checkout worker (wrangler.jsonc "main").
// worker.js stays importable by the Node tests; this file adds what only runs on Cloudflare.
import { WorkerEntrypoint } from "cloudflare:workers";
import mmWorkerWithBooking from "./worker.js";
import { sendNinoMail } from "./nino-mail.js";

export * from "./worker.js";
export default mmWorkerWithBooking;

// Private mail relay for the Nino shirt shop; reachable only through its service binding (see nino-mail.js).
export class NinoMail extends WorkerEntrypoint {
  async send(message) {
    return sendNinoMail(this.env, message);
  }
}
