-- Online Menu + QR and Holiday Menu: the owner's "Request changes" redoes the menu from his note (owner, Nov 12, 2026).
-- The delivering step names the step to redo from; menu-qr/draft-step.js applies the note to the menu that was read.
UPDATE workflow_definitions
SET steps_json = '[{"key":"PREPARE_INPUTS","order":10},{"key":"GENERATE_MENU_DRAFT","order":20},{"key":"GENERATE_QR","order":30},{"key":"QUALITY_CHECK","order":40},{"key":"PACKAGE_DELIVERABLES","order":50,"regenerate_from":"GENERATE_MENU_DRAFT"}]',
    updated_at = '2026-11-12T19:45:00.000Z'
WHERE workflow_key = 'MENU_QR_V1' AND version = 1;
