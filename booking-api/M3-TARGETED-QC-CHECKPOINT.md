# M3 resume — October 9, 2026

Controlling source: Menu-Made_Automation_Handbook_Current.docx, v2.2, section 36 (latest overlay October 5). User directed return to the automation project after the website offer/upload and measurement work. This records the EC003 priority change back to M3.

- Active milestone: M3, first Menu + QR vertical slice. M2.5 complete, CP-1 GO, CP-2 not passed.
- Controlling requirements: AUT-001–004, OFR-003–004, TECH-001/003, EC-001/002/008/009/010.
- Verified: Handbook records successful PREPARE_INPUTS, GENERATE_MENU_DRAFT, and GENERATE_QR on run `6bcab908-a2d9-4320-a8e9-3208b9be1b66`. QC implementation is in the full Worker, including the October 9 user-deployed document intake. Live QC is not yet evidenced.
- Incomplete: live QC, packaging, secure delivery, semantic/visual review and QR scan verification, end-to-end proof and manual/cost evidence.
- Next authorized action: deploy exact-run targeting, preview the proof run and QUALITY_CHECK, then execute that matched step using existing authenticated runner access.
- Explicitly unauthorized next-phase work: M4 portal, M5 Nino, M6 recurring billing, M7 acquisition automation, and scale work before CP-2 passes unless JP changes priority.
- Known debt: original runner selects the oldest runnable step globally; laptop modular backend synchronization remains unverified. No successful assets or failed workflow records are reset.

## Targeted runner change

The existing POST `/api/production/run-next` accepts optional `workflow_run_id`, `step_key`, and `dry_run` JSON fields. Its existing authentication, prerequisite filters, queued-step claim, and default global behavior remain intact. A matching run and step are both required when supplied. No-match never falls back to another run. A dry run performs a selection read only. No new database schema, secret, binding, provider, pricing, or workflow phase is introduced.

Deployment: replace `menu-checkout` with the complete supplied Worker file, preserving existing bindings and secrets. The website does not need a further deployment. `run-proof-qc.py` prompts for the existing runner secret locally. Its default is preview-only; `--execute` previews and validates the exact queued proof QC before executing it. Do not paste the secret into chat. QC result output contains no secret and can be retained as evidence.

Validation: four selection/auth/preview tests and four draft/QR safeguard tests passed. No live workflow was claimed or modified during this session. Do not mark QC or CP-2 passed based on these tests. After live QC succeeds, continue with packaging and secure delivery under the same M3 milestone.
