// Deployed entry module for the menu-checkout worker (wrangler.jsonc "main").
// worker.js stays importable by the Node tests; this file adds what only runs on Cloudflare.
import { WorkerEntrypoint } from "cloudflare:workers";
import mmWorkerWithBooking from "./worker.js";
import { sendNinoMail } from "./nino-mail.js";
import { writeNinoNewsletter } from "./nino-write.js";

export * from "./worker.js";
export default mmWorkerWithBooking;

// Private mail relay for the Nino shirt shop; reachable only through its service binding (see nino-mail.js).
export class NinoMail extends WorkerEntrypoint {
  async send(message) {
    return sendNinoMail(this.env, message);
  }
}

// Private newsletter copywriter for the Nino shop; reachable only through its service binding (see nino-write.js).
export class NinoWrite extends WorkerEntrypoint {
  async draft(brief) {
    return writeNinoNewsletter(this.env, brief);
  }
}
