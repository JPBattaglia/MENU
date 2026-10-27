// The PRODUCE step of the stage 6 workflows: one entry in the runner, one producer per workflow.
import { runAccessibilityProduceStep } from "./accessibility/access-step.js";
import { runConversionProduceStep } from "./conversion/conversion-step.js";
import { runMenuCareProduceStep } from "./menu-care/care-step.js";
import { runSocialPostsProduceStep } from "./social-posts/social-step.js";

const PRODUCERS = {
  MENU_CARE_V1: runMenuCareProduceStep,
  SOCIAL_POSTS_V1: runSocialPostsProduceStep,
  ACCESSIBILITY_MONITORING_V1: runAccessibilityProduceStep,
  CONVERSION_FIX_V1: runConversionProduceStep
};

async function runProduceStep(targetStep, env, deps = {}) {
  const producer = PRODUCERS[targetStep.workflow_key];
  if (!producer) throw new Error(`No producer for ${targetStep.workflow_key}`);
  return producer(targetStep, env, deps);
}

export { PRODUCERS, runProduceStep };
