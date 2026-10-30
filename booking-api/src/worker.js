import { handleAdminQueue } from "./admin/queue.js";
import { handleApprovalRequest, handleBatchApprovalRequest } from "./approvals/approvals.js";
import { mmBookingEnvironment, mmBookingHandler } from "./booking/booking.js";
import { getPublicOffers, getSiteCatalog } from "./checkout/catalog.js";
import { recordFunnelEvent } from "./checkout/funnel.js";
import { handleCheckoutResume, maybeFollowUpAbandonedCheckouts } from "./checkout/abandoned.js";
import { handleMenuHostingRenewal } from "./producers/menu-qr/hosting-renewal.js";
import { handleSample } from "./delivery/samples.js";
import { advanceAbandonedCheckoutSelfTests } from "./selftest/abandoned-checkout-selftest.js";
import { advanceMenuHostingSelfTests } from "./selftest/menu-hosting-selftest.js";
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
import { handleAppCounter, handleAppPush, sendQueuedPushes } from "./producers/guest-app/engage.js";
import { handleNativePushJobs, nudgeNativePushes, sendAndroidPushes } from "./store-app/native-push.js";
import { handleGoogleKeys } from "./store-app/google-keys.js";
import { handleSwitches } from "./lib/switches.js";
import { advanceStoreApps, handleStoreAppDone } from "./store-app/store-flow.js";
import { advanceGuestAppPushSelfTests } from "./selftest/guest-app-push-selftest.js";
import { customHostSlug, runDomainWatch } from "./producers/website/domains.js";
import { handlePlanSettings } from "./subscriptions/settings.js";
import { handleMenuCareRequest } from "./producers/menu-care/intake.js";
import { handleDeliveryDownload, handleHostedMenu } from "./delivery/delivery.js";
import { handleExtraPagesDone, handleExtraPagesPay } from "./producers/menu-qr/page-billing.js";
import { advanceSelfTests } from "./selftest/menu-qr-selftest.js";
import { advanceWebsiteTrialSelfTests } from "./selftest/website-trial-selftest.js";
import { advanceDomainSetupSelfTests } from "./selftest/domain-setup-selftest.js";
import { advanceAccountSelfTests } from "./selftest/account-selftest.js";
import { advanceMenuCareSelfTests } from "./selftest/menu-care-selftest.js";
import { advanceConversionSelfTests } from "./selftest/conversion-selftest.js";
import { advanceWebsiteCareSelfTests } from "./selftest/website-care-selftest.js";
import { advanceWebsiteSelfTests } from "./selftest/website-selftest.js";
import { advanceGuestAppSelfTests } from "./selftest/guest-app-selftest.js";
import { advanceGoogleSelfTests } from "./selftest/google-selftest.js";
import { advanceReviewRepliesSelfTests } from "./selftest/review-replies-selftest.js";
import { advanceGoogleCareSelfTests } from "./selftest/google-care-selftest.js";
import { advanceGoogleVisibilitySelfTests } from "./selftest/google-visibility-selftest.js";
import { advanceStage5ExitTests } from "./selftest/stage5-exit-selftest.js";
import { handleGoogleMedia, handlePhotoLibrary } from "./producers/google-care/library.js";
import { handleGoogleCallback, handleGoogleConnect, handleGoogleLocation } from "./google/connect.js";
import { handleStoreKeys } from "./store-app/keys.js";
import { handleRestaurantKeys } from "./store-app/restaurant-keys.js";
import { advanceStoreBuilds, handleBuildConfig, handleBuildResult, handleRebuild } from "./store-app/store-build.js";
import { advanceStoreListings, handleListingImage, handleListingImageView, handleListingPage } from "./store-app/store-listing.js";
import { handleAndroidBundle, handleAndroidKey, handleBuildCredentials, handleBundleDownload } from "./store-app/build-credentials.js";
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
import { handleMe, handleOpen, handleSignIn, handleSignOut } from "./account/account.js";
import { handleDesignBrief, remindDesignBriefs } from "./producers/nino-design/brief.js";
import { emailMerchTracking, handleMerchCheckout, handleMerchLogo, handleMerchLogoUpload, handleMerchProducts, handleMerchQuote, handleMerchUpload } from "./producers/staff-merch/order.js";
import { advanceNinoDesignSelfTests } from "./selftest/nino-design-selftest.js";
import { advanceStaffMerchSelfTests } from "./selftest/staff-merch-selftest.js";

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
    // Stage 11 part 2: the owner hands over Apple keys (emailed one-hour link, keys checked with Apple, stored sealed).
    if (url.pathname === "/api/store-build/credentials" && request.method === "GET") return handleBuildCredentials(request, env);
    if (url.pathname === "/api/store-build/config" && request.method === "GET") return handleBuildConfig(request, env);
    if (url.pathname === "/api/store-build/result" && request.method === "POST") return handleBuildResult(request, env);
    if (url.pathname === "/api/store-build/listing" && request.method === "POST") return handleListingImage(request, env);
    const listingMatch = url.pathname.match(/^\/api\/store-app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/listing(?:\/([a-z0-9-]{1,20})\.png)?$/i);
    if (listingMatch && listingMatch[2] && request.method === "GET") return handleListingImageView(request, env, listingMatch[1].toLowerCase(), listingMatch[2]);
    if (listingMatch && !listingMatch[2] && (request.method === "GET" || request.method === "POST")) return handleListingPage(request, env, listingMatch[1].toLowerCase());
    if (url.pathname === "/api/store-build/android-key" && request.method === "POST") return handleAndroidKey(request, env);
    if (url.pathname === "/api/store-build/android-bundle" && request.method === "POST") return handleAndroidBundle(request, env);
    const bundleMatch = url.pathname.match(/^\/api\/store-build\/bundle\/(\d{1,9})$/);
    if (bundleMatch && request.method === "GET") return handleBundleDownload(request, env, bundleMatch[1]);
    if (url.pathname === "/api/store-keys/owner" && (request.method === "GET" || request.method === "POST")) return handleStoreKeys(request, env);
    if (url.pathname === "/api/store-keys/google" && (request.method === "GET" || request.method === "POST")) return handleGoogleKeys(request, env);
    const restaurantKeysMatch = url.pathname.match(/^\/api\/store-keys\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (restaurantKeysMatch && (request.method === "GET" || request.method === "POST")) return handleRestaurantKeys(request, env, restaurantKeysMatch[1].toLowerCase());
    if (url.pathname === "/api/switches" && (request.method === "GET" || request.method === "POST")) return handleSwitches(request, env);
    const storeAppDoneMatch = url.pathname.match(/^\/api\/store-app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/done$/i);
    if (storeAppDoneMatch && (request.method === "GET" || request.method === "POST")) return handleStoreAppDone(request, env, storeAppDoneMatch[1].toLowerCase());
    const storeAppRebuildMatch = url.pathname.match(/^\/api\/store-app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/rebuild$/i);
    if (storeAppRebuildMatch && (request.method === "GET" || request.method === "POST")) return handleRebuild(request, env, storeAppRebuildMatch[1].toLowerCase());
    // Stage 11 part 2: native push batches for the GitHub sender (.github/workflows/native-push.yml), OIDC only.
    const nativePushMatch = url.pathname.match(/^\/api\/native-push\/(next|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (nativePushMatch && (request.method === "GET" || request.method === "POST")) return handleNativePushJobs(request, env, nativePushMatch[1].toLowerCase());
    if (url.pathname === "/api/google/callback" && request.method === "GET") {
      return handleGoogleCallback(request, env);
    }
    const googleLocationMatch = url.pathname.match(/^\/api\/google\/location\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (googleLocationMatch && request.method === "POST") {
      return handleGoogleLocation(request, env, googleLocationMatch[1].toLowerCase());
    }
    const photoLibraryMatch = url.pathname.match(/^\/api\/photo-library\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (photoLibraryMatch && (request.method === "GET" || request.method === "POST")) {
      return handlePhotoLibrary(request, env, photoLibraryMatch[1].toLowerCase());
    }
    const googleMediaMatch = url.pathname.match(/^\/api\/gmedia\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (googleMediaMatch && (request.method === "GET" || request.method === "HEAD")) {
      return handleGoogleMedia(request, env, googleMediaMatch[1].toLowerCase());
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
    const appPushMatch = url.pathname.match(/^\/api\/app-push\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (appPushMatch && (request.method === "GET" || request.method === "POST")) {
      return handleAppPush(request, env, appPushMatch[1].toLowerCase());
    }
    const appCounterMatch = url.pathname.match(/^\/api\/app-counter\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (appCounterMatch && request.method === "GET") {
      return handleAppCounter(request, env, appCounterMatch[1].toLowerCase());
    }
    const appPreviewMatch = url.pathname.match(/^\/api\/app-preview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_.-]{20,900})\/?(.*)$/i);
    if (appPreviewMatch && (request.method === "GET" || request.method === "HEAD")) {
      return handleAppPreview(request, env, appPreviewMatch[1].toLowerCase(), appPreviewMatch[2], appPreviewMatch[3]);
    }
    const liveSiteMatch = url.pathname.match(/^\/api\/site\/([a-z0-9][a-z0-9-]{1,28}[a-z0-9])\/?(.*)$/);
    if (liveSiteMatch && methodAllowed(request, liveSiteMatch[2])) {
      return serveSlug(request, env, liveSiteMatch[1], liveSiteMatch[2]);
    }
    const extraPagesMatch = url.pathname.match(/^\/api\/extra-pages\/([A-Za-z0-9-]{1,64})(\/done)?$/);
    if (extraPagesMatch && request.method === "GET") {
      return extraPagesMatch[2] ? handleExtraPagesDone(request) : handleExtraPagesPay(request, env, extraPagesMatch[1]);
    }
    // Customer accounts (stage 9 part 2): emailed sign-in link, session cookie, account summary.
    if (request.method === "POST" && url.pathname === "/api/account/sign-in") return handleSignIn(request, env);
    if (request.method === "POST" && url.pathname === "/api/account/sign-out") return handleSignOut(request, env);
    if (request.method === "GET" && url.pathname === "/api/account/me") return handleMe(request, env);
    const accountOpen = url.pathname.match(/^\/api\/account\/open\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (accountOpen && (request.method === "GET" || request.method === "POST")) return handleOpen(request, env, accountOpen[1].toLowerCase());
    // Abandoned-checkout follow-up (stage 9 part 2): the emailed link reopens the same order in a new Stripe session.
    const resumeMatch = url.pathname.match(/^\/api\/checkout\/resume\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (resumeMatch && (request.method === "GET" || request.method === "POST")) return handleCheckoutResume(request, env, resumeMatch[1].toLowerCase());
    // Online Menu + QR after year one: Menu Care checkout bound to the business that owns the menu.
    const hostingMatch = url.pathname.match(/^\/api\/menu-hosting\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (hostingMatch && (request.method === "GET" || request.method === "POST")) return handleMenuHostingRenewal(request, env, hostingMatch[1].toLowerCase());
    // Product samples: the newest real self-test output of each product, renamed "Sample Cafe", private links removed.
    const sampleMatch = url.pathname.match(/^\/api\/samples\/(menu|accessibility|conversion|social|google-visibility|google-care|website|app)(?:\/(.*))?$/);
    if (sampleMatch && (request.method === "GET" || request.method === "HEAD")) return handleSample(request, env, sampleMatch[1], sampleMatch[2] || "");
    const portalMatch = url.pathname.match(/^\/api\/billing-portal\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (portalMatch && (request.method === "GET" || request.method === "POST")) {
      return handleBillingPortal(request, env, portalMatch[1].toLowerCase());
    }
    // Stage 10: Nino design services brief (after payment) and staff merch.
    const designBriefMatch = url.pathname.match(/^\/api\/design-brief\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (designBriefMatch && (request.method === "GET" || request.method === "POST")) return handleDesignBrief(request, env, designBriefMatch[1].toLowerCase());
    const merchLogoMatch = url.pathname.match(/^\/api\/merch-logo\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (merchLogoMatch && (request.method === "GET" || request.method === "HEAD")) return handleMerchLogo(request, env, merchLogoMatch[1].toLowerCase());
    const merchUploadMatch = url.pathname.match(/^\/api\/merch-upload\/([0-9a-f-]{36}\.(?:png|jpg))$/);
    if (merchUploadMatch && (request.method === "GET" || request.method === "HEAD")) return handleMerchUpload(request, env, merchUploadMatch[1]);
    if (request.method === "GET" && url.pathname === "/api/merch/products") return handleMerchProducts(request, env, ctx);
    if (request.method === "POST" && url.pathname === "/api/merch/logo") return handleMerchLogoUpload(request, env);
    if (request.method === "POST" && url.pathname === "/api/merch/quote") return handleMerchQuote(request, env);
    if (request.method === "POST" && url.pathname === "/api/merch/checkout") return handleMerchCheckout(request, env);
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
    if (request.method === "GET" && url.pathname === "/api/catalog") {
      return getSiteCatalog(env);
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

// The Guest App's own API (notifications and rewards) is the only place on a customer address that takes a POST.
const APP_API_PATH = /^app\/api\//;
// OPTIONS reaches it too: the Store App (stage 11 part 2) asks before posting to rewards (guest-app/native.js).
const methodAllowed = (request, path) => request.method === "GET" || request.method === "HEAD" || ((request.method === "POST" || request.method === "OPTIONS") && APP_API_PATH.test(path || ""));

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
      if (!methodAllowed(request, host.path)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return serveSlug(request, env, host.slug, host.path);
    }
    if (host.action === "none") {
      // A customer's own domain (via Cloudflare for SaaS). Our own hostnames never reach the database here.
      const customSlug = await customHostSlug(env, new URL(request.url).hostname).catch(() => null);
      if (customSlug) {
        if (!methodAllowed(request, new URL(request.url).pathname.replace(/^\/+/, ""))) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
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
      await sendQueuedPushes(env).catch((error) => console.error("Guest App notifications failed:", error instanceof Error ? error.message : String(error)));
      await nudgeNativePushes(env).catch((error) => console.error("Native push nudge failed:", error instanceof Error ? error.message : String(error)));
      await sendAndroidPushes(env).catch((error) => console.error("Android notifications failed:", error instanceof Error ? error.message : String(error)));
      await advanceStoreApps(env).catch((error) => console.error("Store App steps failed:", error instanceof Error ? error.message : String(error)));
      await advanceStoreBuilds(env).catch((error) => console.error("Store App builds failed:", error instanceof Error ? error.message : String(error)));
      await advanceStoreListings(env).catch((error) => console.error("Store App listings failed:", error instanceof Error ? error.message : String(error)));
      await advanceGuestAppPushSelfTests(env, app).catch((error) => console.error("Guest App push self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceGuestAppSelfTests(env, app).catch((error) => console.error("Guest App self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceGoogleSelfTests(env).catch((error) => console.error("Google self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceReviewRepliesSelfTests(env, app).catch((error) => console.error("Review Replies self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceGoogleCareSelfTests(env, app).catch((error) => console.error("Google Profile Care self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceGoogleVisibilitySelfTests(env, app).catch((error) => console.error("Google Visibility self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceStage5ExitTests(env, app).catch((error) => console.error("Stage 5 exit test failed:", error instanceof Error ? error.message : String(error)));
      await advanceDomainSetupSelfTests(env).catch((error) => console.error("Domain setup self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceAccountSelfTests(env).catch((error) => console.error("Account self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceAbandonedCheckoutSelfTests(env, app).catch((error) => console.error("Abandoned checkout self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceMenuHostingSelfTests(env).catch((error) => console.error("Menu hosting self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceNinoDesignSelfTests(env, app).catch((error) => console.error("Nino design self-test failed:", error instanceof Error ? error.message : String(error)));
      await advanceStaffMerchSelfTests(env, app).catch((error) => console.error("Staff merch self-test failed:", error instanceof Error ? error.message : String(error)));
      // Once an hour: design-brief reminders and staff merch tracking emails.
      await remindDesignBriefs(env).catch((error) => console.error("Design brief reminders failed:", error instanceof Error ? error.message : String(error)));
      await emailMerchTracking(env).catch((error) => console.error("Merch tracking failed:", error instanceof Error ? error.message : String(error)));
      // Once an hour: one reminder email to buyers who left a checkout unpaid 24-72 hours ago.
      await maybeFollowUpAbandonedCheckouts(env).catch((error) => console.error("Abandoned checkout follow-up failed:", error instanceof Error ? error.message : String(error)));
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
