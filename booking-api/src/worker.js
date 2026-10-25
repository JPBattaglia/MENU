import { handleApprovalRequest } from "./approvals/approvals.js";
import { mmBookingEnvironment, mmBookingHandler } from "./booking/booking.js";
import { getPublicOffers } from "./checkout/catalog.js";
import { recordFunnelEvent } from "./checkout/funnel.js";
import { CheckoutValidationError, quoteMenuPackage } from "./checkout/quote.js";
import { createCheckoutSession, createCheckoutSessionTest } from "./checkout/session.js";
import { handleStripeWebhook } from "./checkout/webhook.js";
import { handleDeliveryDownload, handleHostedMenu } from "./delivery/delivery.js";
import { handleExtraPagesDone, handleExtraPagesPay } from "./producers/menu-qr/page-billing.js";
import { databaseHealthCheck } from "./lib/db.js";
import { corsHeaders, jsonResponse } from "./lib/http.js";
import { startProductionNow } from "./onboarding/extras.js";
import { getOnboarding, saveOnboarding } from "./onboarding/onboarding.js";
import { uploadOnboardingAsset } from "./onboarding/uploads.js";
import { runNextProductionStep, runScheduledProduction } from "./workflows/runner.js";

var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (approvalMatch && (request.method === "GET" || request.method === "POST")) {
      return handleApprovalRequest(request, env, ctx, approvalMatch[1].toLowerCase());
    }
    const hostedMenuMatch = url.pathname.match(/^\/api\/menu\/([a-z0-9-]{1,60})$/);
    if (hostedMenuMatch && request.method === "GET") {
      return handleHostedMenu(request, env, hostedMenuMatch[1]);
    }
    const extraPagesMatch = url.pathname.match(/^\/api\/extra-pages\/([A-Za-z0-9-]{1,64})(\/done)?$/);
    if (extraPagesMatch && request.method === "GET") {
      return extraPagesMatch[2] ? handleExtraPagesDone(request) : handleExtraPagesPay(request, env, extraPagesMatch[1]);
    }
    const deliveryMatch = url.pathname.match(/^\/api\/delivery\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (deliveryMatch && request.method === "GET") {
      return handleDeliveryDownload(request, env, deliveryMatch[1].toLowerCase());
    }
    if (request.method === "OPTIONS") {
      return new Response(
        null,
        {
          headers: corsHeaders()
        }
      );
    }
    if (request.method === "GET" && url.pathname === "/api/db-health") {
      return databaseHealthCheck(
        env
      );
    }
    if (request.method === "GET" && url.pathname === "/api/offers") {
      return getPublicOffers(
        env
      );
    }
    if (request.method === "GET" && url.pathname === "/api/menu-package-quote") {
      try {
        const rawPages = url.searchParams.get("pages");
        if (!rawPages || !/^\d+$/.test(rawPages)) {
          throw new CheckoutValidationError("Choose a menu page count from 1 to 50.");
        }
        return jsonResponse({ ok: true, quote: quoteMenuPackage(Number(rawPages)) });
      } catch (error) {
        return jsonResponse({ ok: false, error: error.message }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/funnel-event") {
      return recordFunnelEvent(
        request,
        env
      );
    }
    if (request.method === "GET" && url.pathname === "/api/onboarding") {
      return getOnboarding(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/onboarding") {
      return saveOnboarding(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/onboarding/start") {
      return startProductionNow(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/onboarding/upload") {
      return uploadOnboardingAsset(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/production/run-next") {
      return runNextProductionStep(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/stripe-webhook") {
      return handleStripeWebhook(
        request,
        env
      );
    }
    if (request.method === "POST" && url.pathname === "/api/create-checkout-test") {
      return createCheckoutSessionTest(
        request,
        env
      );
    }
    if (request.method === "POST" && (url.pathname === "/api/create-checkout" || url.pathname === "/api/create-checkout-session")) {
      return createCheckoutSession(
        request,
        env
      );
    }
    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }
};

const mmWorkerWithBooking = {
  async fetch(request, env, ctx) {
    if (['/api/booking', '/api/inquiry'].includes(new URL(request.url).pathname)) {
      return mmBookingHandler.fetch(request, mmBookingEnvironment(env), ctx);
    }
    return worker_default.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledProduction(env).catch((error) => {
      console.error("Scheduled production failed:", error instanceof Error ? error.message : String(error));
    }));
    return mmBookingHandler.scheduled(event, mmBookingEnvironment(env), ctx);
  }
};

export { worker_default, mmWorkerWithBooking };
export default mmWorkerWithBooking;
