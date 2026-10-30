-- Stage 12 coverage map (src/selftest/coverage.js): latest pass and latest run per self-test kind, read by index
-- instead of scanning self_tests. Apply to menu-made-db before pushing the code that uses it. Safe to apply twice.
CREATE INDEX IF NOT EXISTS idx_self_tests_kind_created ON self_tests (kind, created_at);
CREATE INDEX IF NOT EXISTS idx_self_tests_kind_passed ON self_tests (kind, finished_at) WHERE status = 'PASSED';
