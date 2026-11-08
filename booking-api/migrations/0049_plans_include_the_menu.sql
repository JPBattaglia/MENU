-- Nov 8, 2026 (owner, later the same day as 0048): Menu Care goes back into Starter, Growth and Pro, and every plan starts
-- with the menu (Online Menu + QR is added at checkout; its $144 setup is free with yearly billing, see
-- src/subscriptions/checkout.js). Prices stay as 0048 left them: Starter $79, Growth $169, Pro $279. Safe to apply twice.
UPDATE offer_versions SET scope_json = '{"kind":"BUNDLE","plan":"BUNDLE_STARTER","includes":["MENU_CARE","REVIEW_REPLIES","ACCESSIBILITY_MONITORING"]}'
  WHERE offer_id = 'offer_bundle_starter';
UPDATE offer_versions SET scope_json = '{"kind":"BUNDLE","plan":"BUNDLE_GROWTH","includes":["MENU_CARE","REVIEW_REPLIES","ACCESSIBILITY_MONITORING","GOOGLE_PROFILE_CARE"]}'
  WHERE offer_id = 'offer_bundle_growth';
UPDATE offer_versions SET scope_json = '{"kind":"BUNDLE","plan":"BUNDLE_PRO","includes":["MENU_CARE","REVIEW_REPLIES","ACCESSIBILITY_MONITORING","GOOGLE_PROFILE_CARE","SOCIAL_POSTS","WEBSITE_CARE"]}'
  WHERE offer_id = 'offer_bundle_pro';
