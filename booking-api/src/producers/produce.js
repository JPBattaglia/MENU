// The PRODUCE step of the stage 6 workflows: one entry in the runner, one producer per workflow.
import { runAccessibilityProduceStep } from "./accessibility/access-step.js";
import { runConversionProduceStep } from "./conversion/conversion-step.js";
import { runWebsiteCareProduceStep } from "./website-care/care-step.js";
import { runWebsiteProduceStep } from "./website/site-step.js";
import { runMenuCareProduceStep } from "./menu-care/care-step.js";
import { runSocialPostsProduceStep } from "./social-posts/social-step.js";
import { runGuestAppMonthStep, runGuestAppSetupStep } from "./guest-app/app-step.js";
import { runReviewRepliesProduceStep } from "./review-replies/review-step.js";
import { runGoogleCareProduceStep } from "./google-care/care-step.js";
import { runGoogleVisibilityProduceStep } from "./google-visibility/visibility-step.js";
import { runNinoDesignProduceStep } from "./nino-design/produce.js";
import { runStaffMerchProduceStep } from "./staff-merch/produce.js";

const PRODUCERS = {
  MENU_CARE_V1: runMenuCareProduceStep,
  SOCIAL_POSTS_V1: runSocialPostsProduceStep,
  ACCESSIBILITY_MONITORING_V1: runAccessibilityProduceStep,
  CONVERSION_FIX_V1: runConversionProduceStep,
  WEBSITE_PACKAGE_V1: runWebsiteProduceStep,
  WEBSITE_CARE_V1: runWebsiteCareProduceStep,
  GUEST_APP_SETUP_V1: runGuestAppSetupStep,
  GUEST_APP_V1: runGuestAppMonthStep,
  REVIEW_REPLIES_V1: runReviewRepliesProduceStep,
  GOOGLE_PROFILE_CARE_V1: runGoogleCareProduceStep,
  GOOGLE_VISIBILITY_V1: runGoogleVisibilityProduceStep,
  NINO_SOCIAL_PACK_V1: runNinoDesignProduceStep,
  NINO_FLYER_V1: runNinoDesignProduceStep,
  NINO_MENU_DESIGN_V1: runNinoDesignProduceStep,
  NINO_LOGO_V1: runNinoDesignProduceStep,
  STAFF_MERCH_V1: runStaffMerchProduceStep
};

async function runProduceStep(targetStep, env, deps = {}) {
  const producer = PRODUCERS[targetStep.workflow_key];
  if (!producer) throw new Error(`No producer for ${targetStep.workflow_key}`);
  return producer(targetStep, env, deps);
}

export { PRODUCERS, runProduceStep };
