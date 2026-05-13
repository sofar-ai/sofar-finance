-- Adds PSR (Probabilistic Sharpe Ratio) columns to experiment_sandbox_validations
-- per ADR-0026 design. PSR is computed from per-period enhanced_pnls now
-- exposed by overnight-research-daemon.py:validate_signal as of 2026-05-12.
--
-- Pnls themselves are persisted in full_results_json (JSONB, already exists);
-- this migration only adds the scalar PSR result + the benchmark it tested
-- against. Re-running validation at a higher validator_version recomputes PSR
-- with potentially different parameters; old rows preserve their PSR values.

ALTER TABLE experiment_sandbox_validations
  ADD COLUMN IF NOT EXISTS enhanced_psr NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS enhanced_psr_benchmark NUMERIC(8,4) DEFAULT 0.0;

COMMENT ON COLUMN experiment_sandbox_validations.enhanced_psr IS
  'Probabilistic Sharpe Ratio per Bailey & Lopez de Prado 2012. Probability '
  'in [0,1] that the true annualized Sharpe of the enhanced model exceeds '
  'enhanced_psr_benchmark. Corrects for non-normality (skew + kurtosis) and '
  'sample size. Does NOT correct for multiple-testing selection bias.';

COMMENT ON COLUMN experiment_sandbox_validations.enhanced_psr_benchmark IS
  'The annualized Sharpe value against which enhanced_psr was tested. '
  'Default 0.0 (i.e. PSR tests "is the Sharpe genuinely positive"). '
  'Operators may rerun at higher benchmarks to test "Sharpe > some_target".';
