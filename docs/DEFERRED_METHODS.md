# Unusual Flow Detection — Deferred Methods & Research Context

**Last updated:** 2026-04-21
**Purpose:** Canonical reference for unusual-flow detection methods. Methods shipped live are documented here with their literature backing. Methods deferred are tracked here with their prerequisites so future sessions pick them up without re-discovering the research.

## Design principle

Per the academic literature ([Strong 2024 — Wayne State](https://ilitchbusiness.wayne.edu/news/unusual-options-activity-revealed-as-a-potential-return-signal-in-new-finance-research-67679)):

> "Large option trades are in general NOT predictive — but certain types of UOAs are."

The method IS the signal. Different detectors catch different informed-flow signatures with different predictive horizons. SOFAR's approach:

1. Run multiple orthogonal detectors in parallel
2. Persist every detection with a signal_id
3. Measure forward returns at literature-backed horizons per method
4. Let empirical per-method-per-regime alpha selection happen over time — do not pre-commit to "the best" method

## Methods — Phase 1 (shipped 2026-04-21)

### Method 4: Intraday Burst Rate
**Definition:** Rolling 15-minute premium > 3× today's session average 15-minute premium per symbol.
**Baseline required:** None (uses same-day rolling).
**Forward-return windows:** Intraday close, 1d.
**Literature:** Jiang & Strong (2020) on intraday option trading score predicting rest-of-day returns. Strongest for smaller stocks and high-idio-vol names.
**Link:** https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3618427

### Method 5: ISO Concentration (Chakravarty signal)
**Definition:** `iso_premium / total_premium > 0.60` with minimum $ threshold.
**Baseline required:** None.
**Forward-return windows:** 1d, 5d, 20d, 40d.
**Literature:** Chakravarty, Jain, Upson, Wood (2012). ISO trades have significantly larger information share despite smaller size; informed institutions are primary users. Cox (2021) shows ISO order imbalances predict CAR up to 2 months, strongest in small caps.
**Links:**
- Chakravarty 2012: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1460865
- Cox 2021: https://ideas.repec.org/a/bla/jfnres/v44y2021i1p5-23.html

### Method 6: Direction Concentration
**Definition:** `buy_premium / (buy_premium + sell_premium) > 0.75 OR < 0.25` with $ minimum.
**Baseline required:** None.
**Forward-return windows:** 1d, 5d.
**Literature:** Derivative of signed-volume work (Easley & O'Hara 1987, subsequent). One-sided conviction flow.

### Method 7: Sweep Cluster Density
**Definition:** ISO sweep rollup count > 3× hourly session average, or > N absolute.
**Baseline required:** None.
**Forward-return windows:** 1d, 5d, 20d.
**Literature:** Derived from Chakravarty framework. Cluster density implies coordinated institutional execution.

## Methods — Deferred (shipped when prerequisites met)

### Method 1: Premium vs 20-Day Baseline
**Definition:** Today's total_premium > (mean_20d + N × std_20d), where N=2 is meaningful, N=3 is strong signal.
**Baseline required:** flow_baselines populated with 20 trading days of history.
**Status:** BLOCKED on `flow_baselines` being empty (0 rows as of 2026-04-21). Unblocks once backfill from flow_trades completes (if depth allows) or forward-populates ~20 trading sessions.
**Forward-return windows:** 1d, 5d, 20d.
**Literature:** Classic unusual-activity screening. See academia.edu scoring study.

### Method 2: Volume vs Open Interest Ratio (OIR Spike)
**Definition:** `today_volume / open_interest > 3` — fresh positioning vs closing.
**Baseline required:** None per se, but requires `options_eod` OI join at contract level.
**Status:** DEFERRED. Implementation needs join to options_eod per contract (not just session aggregates), which is a larger query cost. Schedule for after Phase 1 validates.
**Forward-return windows:** 1d, 5d, 20d.
**Literature:** Yuan (2025), Review of Quantitative Finance and Accounting — combining monetary OI/volume change with probability-OTM produces 60%+ annual raw returns in long-short portfolios.
**Link:** https://link.springer.com/article/10.1007/s11156-025-01427-z

### Method 3: Rank Anomaly
**Definition:** Today's rank in premium (across all symbols) vs median rank over 20 days — large jumps flagged.
**Baseline required:** 20 trading days of daily rankings.
**Status:** BLOCKED on 20d of daily symbol-rank history.
**Forward-return windows:** 1d, 5d, 20d.
**Literature:** Cross-sectional ranking approach common in quant equity factor research.

### Method 8: OTM-Near-Expiry with Size (Strong 2024)
**Definition:** Large trades (top N% by $) in OTM contracts within 30 DTE.
**Baseline required:** None. Requires contract-level DTE + moneyness join.
**Status:** DEFERRED. Implementation needs `options_eod` IV/Greeks for OTM classification and proper DTE computation. Higher-complexity join than Phase 1 methods. Literature suggests this is specifically the UOA type that carries predictive power.
**Forward-return windows:** DTE-adjusted (up to expiration).
**Literature:** Strong (2024), dissertation-based finding at Wayne State.

### Method 9: Composite Options Trading Score (OTS) — First 30 Minutes
**Definition:** Signed option-to-stock volume ratio in first 30 min post-open.
**Baseline required:** Historical signed volume distribution.
**Status:** DEFERRED. Requires reliable buy/sell signing on individual option trades, which is nontrivial (bid/ask inference).
**Forward-return windows:** Rest-of-trading-day.
**Literature:** Jiang & Strong (2020). Predictability strongest for smaller stocks and higher idiosyncratic volatility names.

### Method 10: Machine Learning Composite
**Definition:** XGBoost / LightGBM ensemble of all detector features (premium, ISO%, direction, burst, sweep density, rank anomaly) → predicted forward return.
**Baseline required:** 100+ detected signals with measured forward returns (min viable dataset).
**Status:** DEFERRED UNTIL DATA ACCRUES. Cannot train a classifier without ~100+ labeled examples of "detection fires → forward return realized." Estimated 2-3 months of Phase 1 detections before enough data exists.
**Literature:** Bali, Beckmeyer, Mörke, Weigert (2023), Review of Financial Studies. Nonlinear ML with big options data produces statistically sizable profits in long-short after costs.
**Link:** https://academic.oup.com/rfs/article-abstract/36/9/3548/7056660

## Measurement approach (all methods)

Every detected signal gets forward returns measured per literature-backed horizon. After ~100 detections per method, compute:

- Mean/median forward return
- Hit rate (direction correct)
- Sharpe of per-signal return distribution
- Regime-stratified breakdown (low_vol_uptrend vs pinned vs explosive)

Method with best Sharpe in a given regime becomes the primary alert; others become confirming signals.

## References

- Chakravarty et al. (2012) "Clean Sweep: Informed Trading through Intermarket Sweep Orders." JFQA.
- Cox (2021) "ISO order imbalances and individual stock returns." Journal of Financial Research.
- Strong (2024) UOA types and abnormal returns. Wayne State dissertation research.
- Jiang & Strong (2020) "Unusual Option Activity: Is it Smart to Follow 'Smart Money'?" SSRN.
- Yuan (2025) OI-weighted probability-OTM measure. Rev Quant Fin Acc.
- Bali et al. (2023) "Option Return Predictability with Machine Learning and Big Data." RFS.

## How to use this doc

When a future session adds a new detector, append it here with:
1. Definition
2. Baseline/data prerequisites
3. Literature backing (with links)
4. Forward-return windows
5. Status (SHIPPED / DEFERRED — why)

When a deferred method's prerequisite is met, move it to the active list and add it to `unusual-flow-detector.py`.
