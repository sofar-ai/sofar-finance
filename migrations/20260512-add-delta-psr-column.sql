-- Adds delta_psr to experiment_sandbox_validations per ADR-0026 design.
--
-- The graduation question is "does this signal add real edge OVER baseline?",
-- not "is the enhanced model's Sharpe genuinely positive?". With production
-- baselines already at Sharpe ~4.7, enhanced_psr saturates near 1.0 for all
-- reasonable candidates. delta_psr operates on the per-period contribution
-- (enhanced_pnls - base_pnls), which has much smaller scale and a Sharpe
-- close to 0 for signals with weak edge — so PSR(delta > 0) discriminates
-- where PSR(enhanced > 0) saturates.

ALTER TABLE experiment_sandbox_validations
  ADD COLUMN IF NOT EXISTS delta_psr NUMERIC(8,6);

COMMENT ON COLUMN experiment_sandbox_validations.delta_psr IS
  'PSR of the per-period delta_pnls (enhanced_pnls - base_pnls), tested '
  'against benchmark=0.0. Probability in [0,1] that the new signal adds '
  'genuinely positive risk-adjusted return over baseline. This is the '
  'right metric for graduation gating; enhanced_psr is informational only.';
