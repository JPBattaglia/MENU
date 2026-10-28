import { handleAdminQueue } from "./admin/queue.js";
import { handleApprovalRequest, handleBatchApprovalRequest } from "./approvals/approvals.js";
import { mmBookingEnvironment, mmBookingHandler } from "./booking/booking.js";
import { getPublicOffers } from "./checkout/catalog.js";
import { recordFunnelEvent } from "./checkout/funnel.js";
import { CheckoutValidationError, quoteMenuPackage } from "./checkout/quote.js";
import { createCheckoutSession, createCheckoutSessionTest } from "./checkout/session.js";
import { handleStripeWebhook } from "./checkout/webhook.js";
import { siteHostAction } from "./producers/website/hosts.js";
import { handleSiteCareRequest } from "./producers/website-care/intake.js";
import { runSiteHealthPass } from "./producers/website-care/health.js";
import { handleSiteIntake } from "./producers/website/intake.js";
import { alertStaleRenders, handleRenderJobs, nudgeWaitingRenders } from "./producers/social-posts/render-jobs.js";
import { handleLiveSite, handleSitePreview } from "./producers/website/serve.js";
import { appOnlyRedirect, handleAppPreview, handleLiveApp } from "./producers/guest-app/serve.js";
import { handleAppIntake } from "./producers/guest-app/intake.js";
import { handleAppUpdate } from "./producers/guest-app/update.js";
import { customHostSlug, runDomainWatch } from "./producers/website/domains.js";
import { handlePlanSettings } from "./subscriptions/settings.js";
import { handleMenuCareRequest } from "./producers/menu-care/intake.js";
import { handleDeliveryDownload, handleHostedMenu } from "./delivery/delivery.js";
import { handleExtraPagesDone, handleExtraPagesPay } from "./producers/menu-qr/page-billing.js";
import { advanceSelfTests } from "./selftest/menu-qr-selftest.js";
import { advanceWebsiteTrialSelfTests } from "./selftest/website-trial-selftest.js";
import { advanceDomainSetupSelfTests } from "./selftest/domain-setup-selftest.js";
import { advanceMenuCareSelfTests } from "./selftest/menu-care-selftest.js";
import { advanceConversionSelfTests } from "./selftest/conversion-selftest.js";
import { advanceWebsiteCareSelfTests } from "./selftest/website-care-selftest.js";
import { advanceWebsiteSelfTests } from "./selftest/website-selftest.js";
import { advanceGuestAppSelfTests } from "./selftest/guest-app-selftest.js";
import { advanceGoogleSelfTests } from "./selftest/google-selftest.js";
import { advanceReviewRepliesSelfTests } from "./selftest/review-replies-selftest.js";
import { handleGoogleCallback, handleGoogleConnect, handleGoogleLocation } from "./google/connect.js";
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
    const googleConnectMatch = url.pathname.match(/^\/api\/google\/connect\/(owner|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (googleConnectMatch && (request.method === "GET" || request.method === "POST")) {
      return handleGoogleConnect(request, env, googleConnectMatch[1].toLowerCase());
    }
    if (url.pathname === "/api/google/callback" && request.method === "GET") {
      return handleGoogleCallback(request, env);
    }
    const googleLocationMatch = url.pathname.match(/^\/api\/google\/location\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (googleLocationMatch && request.method === "POST") {
      return handleGoogleLocation(request, env, googleLocationMatch[1].toLowerCase());
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
    const siteCareMatch = url.pathname.match(/^\/api\/site-care\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,64})$/i);
    if (siteCareMatch && (request.method === "GET" || request.method === "POST")) {
      return handleSiteCareRequest(request, env, siteCareMatch[1]);
    }
    const renderJobMatch = url.pathname.match(/^\/api\/render-jobs\/(next|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (renderJobMatch && (request.method === "GET" || (request.method === "POST" && renderJobMatch[1] !== "next"))) {
      return handleRenderJobs(request, env, renderJobMatch[1].toLowerCase());
    }
    const siteIntakeMatch = url.pathname.match(/^\/api\/site-intake\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (siteIntakeMatch && (request.method === "GET" || request.method === "POST")) {
      return handleSiteIntake(request, env, siteIntakeMatch[1].toLowerCase());
    }
    const sitePreviewMatch = url.pathname.match(/^\/api\/site-preview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_.-]{20,900})\/?(.*)$/i);
    if (sitePreviewMatch && (request.method === "GET" || request.method === "HEAD")) {
      return handleSitePreview(request, env, sitePreviewMatch[1].toLowerCase(), sitePreviewMatch[2], sitePreviewMatch[3]);
    }
    const appIntakeMatch = url.pathname.match(/^\/api\/app-intake\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (appIntakeMatch && (request.method === "GET" || request.method === "POST")) {
      return handleAppIntake(request, env, appIntakeMatch[1].toLowerCase());
    }
    const appUpdateMatch = url.pathname.match(/^\/api\/app-update\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (appUpdateMatch && (request.method === "GET" || request.method === "POST")) {
      return handleAppUpdate(request, env, appUpdateMatch[1].toLowerCase());
    }
    const appPreviewMatch = url.pathname.match(/^\/api\/app-preview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_.-]{20,900})\/?(.*)$/i);
    if (appPreviewMatch && (request.method === "GET" || request.method === "HEAD")) {
      return handleAppPreview(request, env, appPreviewMatch[1].toLowerCase(), appPreviewMatch[2], appPreviewMatch[3]);
    }
    const liveSiteMatch = url.pathname.match(/^\/api\/site\/([a-z0-9][a-z0-9-]{1,28}[a-z0-9])\/?(.*)$/);
    if (liveSiteMatch && (request.method === "GET" || request.method === "HEAD")) {
      return serveSlug(request, env, liveSiteMatch[1], liveSiteMatch[2]);
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

// One slug serves the website at / and the Guest App at /app/. A slug with only an app opens the app from its root.
async function serveSlug(request, env, slug, path) {
  const app = /^app(?:\/(.*))?$/.exec(path || "");
  if (app) return handleLiveApp(request, env, slug, app[1] || "");
  if (!path && env.DB) {
    const redirect = await appOnlyRedirect(request, env, slug);
    if (redirect) return redirect;
  }
  return handleLiveSite(request, env, slug, path);
}

const mmWorkerWithBooking = {
  async fetch(request, env, ctx) {
    // <name>.menu-made.com: reserved names pass through to the existing site, every other name is a customer website.
    const host = siteHostAction(request, env);
    if (host.action === "pass") return fetch(request);
    if (host.action === "site") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return serveSlug(request, env, host.slug, host.path);
    }
    if (host.action === "none") {
      // A customer's own domain (via Cloudflare for SaaS). Our own hostnames never reach the database here.
      const customSlug = await customHostSlug(env, new URL(request.url).hostname).catch(() => null);
      if (customSlug) {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
        return serveSlug(request, env, customSlug, new URL(request.url).pathname.replace(/^\/+/, ""));
      }
    }
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
      await advanceConversionSelfTests(env, app).catch((error) => console.error("Conversion Fix self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceWebsiteSelfTests(env, app).catch((error) => console.error("Website Package self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceWebsiteCareSelfTests(env, app).catch((error) => console.error("Website Care self-test failed:", error instanceof Error ? error.message : String(error)));
      await nudgeWaitingRenders(env).catch((error) => console.error("Renderer nudge failed:", error instanceof Error ? error.message : String(error)));
      await alertStaleRenders(env).catch((error) => console.error("Stale render check failed:", error instanceof Error ? error.message : String(error)));
      await advanceWebsiteTrialSelfTests(env, app).catch((error) => console.error("Website trial self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceGuestAppSelfTests(env, app).catch((error) => console.error("Guest App self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceGoogleSelfTests(env).catch((error) => console.error("Google self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceReviewRepliesSelfTests(env, app).catch((error) => console.error("Review Replies self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceDomainSetupSelfTests(env).catch((error) => console.error("Domain setup self-test failed:", error instanceof Error ? error.message : String(error)));
      await runDomainWatch(env).catch((error) => console.error("Domain watch failed:", error instanceof Error ? error.message : String(error)));
      await runSiteHealthPass(env).catch((error) => console.error("Site health pass failed:", error instanceof Error ? error.message : String(error)));
      // Once a day: reconcile subscriptions with Stripe and create annual plans' monthly jobs.
      await runDailySubscriptionPass(env).catch((error) => console.error("Daily subscription pass failed:", error instanceof Error ? error.message : String(error)));
    })());
    return mmBookingHandler.scheduled(event, mmBookingEnvironment(env), ctx);
  }
};

export { worker_default, mmWorkerWithBooking };
export default mmWorkerWithBooking;
