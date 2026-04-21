# SOFAR — Options Trade Condition Codes

**Purpose:** Document the OPRA condition codes that drive sweep detection and
flow typology in SOFAR. This is the reference any future agent (human or LLM)
should consult before adding new flow-derived signals.

**Last verified:** 2026-04-20 evening
**Authoritative source:** [ThetaData Trade Conditions](https://http-docs.thetadata.us/Articles/Data-And-Requests/Values/Trade-Conditions.html)
**Academic foundation:** Chakravarty, Jain, Upson, Wood (2012). "Clean Sweep:
Informed Trading through Intermarket Sweep Orders." *Journal of Financial and
Quantitative Analysis*. ISO trades have significantly larger information share;
informed institutions are primary users.

---

## Why This Matters

Every option trade has a **condition code** (an integer 0-148) that identifies
the execution mechanism. The code is set by the exchange and disseminated by
OPRA. ThetaData passes it through verbatim in the `condition` column of
`flow_trades`.

For most of SOFAR's history, this column was ignored. The flow-tape-daemon
attempted to detect sweeps via in-memory timing heuristics (clusters of
500ms-window trades on the same contract from multiple exchanges). That
approach:

1. Never persisted `sweep_id` to the DB → `flow_sweep_rollups` empty for 4 days
2. Misidentified non-sweep activity as sweeps (and vice versa)
3. Threw away the *structural* signal that condition codes encode

The OPRA condition code IS the signal the academic literature ranks as the
strongest institutional informed-flow indicator. This document explains how
SOFAR uses it.

---

## ISO (Intermarket Sweep Order) Codes

ISOs are the primary informed-institution signal. SOFAR treats six condition
codes as ISO:

| Code | Name | Mechanism |
|------|------|-----------|
| 95   | INTERMARKET_SWEEP        | Pure ISO — direct sweep across exchanges |
| 126  | SINGLE_LEG_AUCTION_ISO   | ISO via auction (AIM/SAM ISO) |
| 128  | SINGLE_LEG_CROSS_ISO     | ISO via customer-to-customer cross |
| 136  | ML_AUCTION_AGSL          | Multi-leg auction vs single legs (often ISO) |
| 141  | STK_OPT_AE_TRD_AGSL      | Stock-option multi-leg electronic vs SL, ISO variant |
| 142  | STK_OPT_AUCTION_AGSL     | Stock-option auction vs SL, ISO variant |

The ISO bypasses the Order Protection Rule: the participant attests they've
already swept the better quotes elsewhere. This makes ISOs the urgent,
size-taking, willing-to-pay-up trade type. Per the academic literature, the
average ISO is small in dollar size but has 2-3x the post-trade information
content of regular trades.

### Sweep Type Classification

The `flow_sweep_rollups.iso_type` field categorizes each detected sweep:

- **PURE** — all legs in the bucket have condition 95 (raw ISO)
- **AUCTION** — all legs have condition 126 (auction ISO)
- **CROSS** — all legs have condition 128 (cross ISO)
- **COMPLEX** — multi-leg ISO variants (136, 141, 142)
- **MIXED** — combination of ISO types in the same time bucket

A sweep can be a single-leg ISO (one institution hitting one exchange) or a
multi-leg ISO grouping (one institution sweeping multiple exchanges
simultaneously, recorded as separate trades sharing the same time bucket).

---

## Other Categories

The `option_trade_conditions` reference table classifies all 149 OPRA codes
into these categories:

| Category   | Description |
|------------|-------------|
| ISO        | Intermarket Sweep (informed flow signal) |
| MULTILEG   | Spread, condor, butterfly, etc. — institutional structure |
| CROSS      | Customer-to-customer crosses (QCC) — pre-arranged blocks |
| FLOOR      | Non-electronic floor trades — large institutional blocks |
| AUCTION    | Price-improvement auction trades (AIM, SAM) |
| STOCK_OPT  | Stock-tied options (covered calls, etc.) |
| REGULAR    | Standard electronic single-leg execution |
| CANCEL     | Trade cancellations |
| OTHER      | Reserved, unmapped, or rare codes |

The `is_iso`, `is_multileg`, `is_floor`, `is_auction`, `is_cross`,
`is_stock_tied`, `is_cancel` boolean flags allow rollups to count overlapping
properties (e.g., a single trade can be both `is_multileg` and `is_iso`).

---

## How SOFAR Uses This

### 1. flow_session_metrics enrichment

Per `(session_date, symbol)`, the table now stores per-category trade counts
and premium totals:

- `iso_trade_count`, `iso_premium`
- `multileg_trade_count`, `multileg_premium`
- `cross_trade_count`, `cross_premium`
- `floor_trade_count`, `floor_premium`
- `auction_trade_count`, `auction_premium`
- `stock_opt_trade_count`, `stock_opt_premium`
- `cancel_trade_count`

Computed by `refresh-flow-aggregates.py` via JOIN to `option_trade_conditions`.

### 2. flow_sweep_rollups (deterministic from condition codes)

Sweeps are computed by SQL, not in-memory daemon detection:

```sql
SELECT ... FROM flow_trades
WHERE condition IN (95, 126, 128, 136, 141, 142)
GROUP BY session_date, symbol, expiration, strike, right_type, side,
         (epoch_ms / 500) * 500   -- 500ms time bucket
```

Each group becomes one row in `flow_sweep_rollups` with:
- `sweep_id`: deterministic synthetic ID (`iso_YYYYMMDD_SYM_EXP_STRIKE_RS_BUCKET`)
- `iso_type`: PURE / AUCTION / CROSS / COMPLEX / MIXED
- `primary_condition`: dominant condition code in the group
- `exchanges`: array of exchanges hit
- `direction`: BUY / SELL / MIXED

### 3. Flow Structure Analyzer (S2)

The analyzer prompt receives a typology breakdown per analyzed symbol:

> SPX today: 10,831 trades. Of these, 3 ISO sweeps ($0.8M), 8,116 multi-leg
> ($9.7B), 8,485M floor traded, 79M in auction.

This lets Qwen3-235B reason about institutional structure rather than just
aggregate flow. "Heavy floor activity in DELL" tells the model something
different from "DELL premium $189M."

### 4. AI Synthesis (S1)

The evening synthesis's `options_flow_impact` block receives the same
typology data. Opus can flag:

- Days where ISO activity spikes (informed-money regime)
- Symbols where floor trades dominate (institutional positioning)
- Cross-heavy symbols (dealer facilitation, often pre-positioning)

---

## What ISOs Look Like in Practice

From 2026-04-20 backfill:

| Symbol | Total Sweep | Legs | Exchanges | Type | Direction |
|--------|-------------|------|-----------|------|-----------|
| SNDK   | $12.9M      | 31   | 16        | PURE | BUY  |
| SNDK   | $5.5M       | 9    | 5         | PURE | BUY  |
| AVGO   | $4.0M       | 2    | 1         | AUCTION | BUY |
| UBER   | $3.9M       | 2    | 1         | AUCTION | SELL |
| ASML   | $3.6M       | 23   | 11        | PURE | BUY  |
| MU     | $2.6M       | 22   | 13        | PURE | BUY  |
| CRWV   | $2.6M       | 18   | 9         | PURE | SELL |

The SNDK $12.9M sweep — one institutional buyer hit 16 different exchanges
simultaneously to take size. Textbook informed-money signature: aggressive,
multi-venue, single-direction, paid-up execution.

---

## Adding New Codes

If a new code appears in the wild that isn't in `option_trade_conditions`:

1. Look it up in the [ThetaData reference](https://http-docs.thetadata.us/Articles/Data-And-Requests/Values/Trade-Conditions.html)
2. INSERT into `option_trade_conditions` with the appropriate category and flags
3. The next `refresh-flow-aggregates.py` run will pick it up automatically

If a code appears as `UNKNOWN_<n>`, it's a filler row — replace it with the
real definition.

---

## References

- ThetaData condition mapping: https://http-docs.thetadata.us/Articles/Data-And-Requests/Values/Trade-Conditions.html
- OPRA Binary Participant Interface Specification (latest)
- Cboe-OPRA Trade Condition Harmonization (2020): https://cdn.cboe.com/resources/release_notes/2019/Harmonization-of-Cboe-and-OPRA-Trade-Condition-Field-Values.pdf
- Chakravarty et al. (2012): "Clean Sweep: Informed Trading through Intermarket Sweep Orders" — *JFQA*
