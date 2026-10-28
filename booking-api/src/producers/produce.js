// The PRODUCE step of the stage 6 workflows: one entry in the runner, one producer per workflow.
import { runAccessibilityProduceStep } from "./accessibility/access-step.js";
import { runConversionProduceStep } from "./conversion/conversion-step.js";
import { runWebsiteCareProduceStep } from "./website-care/care-step.js";
import { runWebsiteProduceStep } from "./website/site-step.js";
import { runMenuCareProduceStep } from "./menu-care/care-step.js";
import { runSocialPostsProduceStep } from "./social-posts/social-step.js";
import { runGuestAppMonthStep, runGuestAppSetupStep } from "./guest-app/app-step.js";
import { runReviewRepliesProduceStep } from "./review-replies/review-step.js";

const PRODUCERS = {
  MENU_CARE_V1: runMenuCareProduceStep,
  SOCIAL_POSTS_V1: runSocialPostsProduceStep,
  ACCESSIBILITY_MONITORING_V1: runAccessibilityProduceStep,
  CONVERSION_FIX_V1: runConversionProduceStep,
  WEBSITE_PACKAGE_V1: runWebsiteProduceStep,
  WEBSITE_CARE_V1: runWebsiteCareProduceStep,
  GUEST_APP_SETUP_V1: runGuestAppSetupStep,
  GUEST_APP_V1: runGuestAppMonthStep,
  REVIEW_REPLIES_V1: runReviewRepliesProduceStep
};

async function runProduceStep(targetStep, env, deps = {}) {
  const producer = PRODUCERS[targetStep.workflow_key];
  if (!producer) throw new Error(`No producer for ${targetStep.workflow_key}`);
  return producer(targetStep, env, deps);
}

export { PRODUCERS, runProduceStep };
