import { handleAdminQueue } from "./admin/queue.js";
import { handleApprovalRequest, handleBatchApprovalRequest } from "./approvals/approvals.js";
import { mmBookingEnvironment, mmBookingHandler } from "./booking/booking.js";
import { getPublicOffers } from "./checkout/catalog.js";
import { recordFunnelEvent } from "./checkout/funnel.js";
import { CheckoutValidationError, quoteMenuPackage } from "./checkout/quote.js";
import { createCheckoutSession, createCheckoutSessionTest } from "./checkout/session.js";
import { handleStripeWebhook } from "./checkout/webhook.js";
import { handlePlanSettings } from "./subscriptions/settings.js";
import { handleMenuCareRequest } from "./producers/menu-care/intake.js";
import { handleDeliveryDownload, handleHostedMenu } from "./delivery/delivery.js";
import { handleExtraPagesDone, handleExtraPagesPay } from "./producers/menu-qr/page-billing.js";
import { advanceSelfTests } from "./selftest/menu-qr-selftest.js";
import { advanceMenuCareSelfTests } from "./selftest/menu-care-selftest.js";
import { advanceAccessibilitySelfTests } from "./selftest/accessibility-selftest.js";
import { advanceSocialPostsSelfTests } from "./selftest/social-posts-selftest.js";
import { advanceRoutingSelfTests } from "./selftest/routing-selftest.js";
import { advanceSubscriptionSelfTests } from "./selftest/subscription-selftest.js";
import { runDailySubscriptionPass } from "./subscriptions/daily.js";
import { handleBillingPortal } from "./subscriptions/portal.js";
import { databaseHealthCheck } from "./lib/db.js";
import { corsHeaders, jsonResponse } from "./lib/http.js";
import { startProductionNow } from "./onboarding/extras.js";
import { getOnboarding, saveOnboarding } from "./onboarding/onboarding.js";
import { uploadOnboardingAsset } from "./onboarding/uploads.js";
import { runNextProductionStep, runScheduledProduction } from "./workflows/runner.js";

var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/admin/queue" && (request.method === "GET" || request.method === "POST")) {
      return handleAdminQueue(request, env);
    }
    const batchMatch = url.pathname.match(/^\/api\/approvals\/batch\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (batchMatch && (request.method === "GET" || request.method === "POST")) {
      return handleBatchApprovalRequest(request, env, ctx, batchMatch[1].toLowerCase());
    }
    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (approvalMatch && (request.method === "GET" || request.method === "POST")) {
      return handleApprovalRequest(request, env, ctx, approvalMatch[1].toLowerCase());
    }
    const hostedMenuMatch = url.pathname.match(/^\/api\/menu\/([a-z0-9-]{1,60})$/);
    if (hostedMenuMatch && request.method === "GET") {
      return handleHostedMenu(request, env, hostedMenuMatch[1]);
    }
    const careMatch = url.pathname.match(/^\/api\/menu-care\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,64})$/i);
    if (careMatch && (request.method === "GET" || request.method === "POST")) {
      return handleMenuCareRequest(request, env, careMatch[1]);
    }
    const settingsMatch = url.pathname.match(/^\/api\/plan-settings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (settingsMatch && (request.method === "GET" || request.method === "POST")) {
      return handlePlanSettings(request, env, settingsMatch[1].toLowerCase());
    }
    const extraPagesMatch = url.pathname.match(/^\/api\/extra-pages\/([A-Za-z0-9-]{1,64})(\/done)?$/);
    if (extraPagesMatch && request.method === "GET") {
      return extraPagesMatch[2] ? handleExtraPagesDone(request) : handleExtraPagesPay(request, env, extraPagesMatch[1]);
    }
    const portalMatch = url.pathname.match(/^\/api\/billing-portal\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (portalMatch && (request.method === "GET" || request.method === "POST")) {
      return handleBillingPortal(request, env, portalMatch[1].toLowerCase());
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
    const app = (request) => mmWorkerWithBooking.fetch(request, env, ctx);
    ctx.waitUntil((async () => {
      // Sandbox self-test steps run before and after production so a test order moves quickly.
      await advanceSelfTests(env, app).catch((error) => console.error("Self-test failed:", error instanceof Error ? error.message : String(error)));
      await runScheduledProduction(env).catch((error) => {
        console.error("Scheduled production failed:", error instanceof Error ? error.message : String(error));
      });
      await advanceSelfTests(env, app).catch((error) => console.error("Self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceSubscriptionSelfTests(env, app).catch((error) => console.error("Subscription self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceRoutingSelfTests(env, app).catch((error) => console.error("Routing self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceMenuCareSelfTests(env, app).catch((error) => console.error("Menu Care self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceSocialPostsSelfTests(env, app).catch((error) => console.error("Social Posts self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceAccessibilitySelfTests(env, app).catch((error) => console.error("Accessibility self-test failed:", error instanceof Error ? error.message : String(error)));
      // Once a day: reconcile subscriptions with Stripe and create annual plans' monthly jobs.
      await runDailySubscriptionPass(env).catch((error) => console.error("Daily subscription pass failed:", error instanceof Error ? error.message : String(error)));
    })());
    return mmBookingHandler.scheduled(event, mmBookingEnvironment(env), ctx);
  }
};

export { worker_default, mmWorkerWithBooking };
export default mmWorkerWithBooking;
