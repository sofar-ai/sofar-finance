# Database Routing — Addendum (2026-04-20 evening)

This addendum supplements `database-routing.md` with hard-won lessons from the
condition-codes migration session.

---

## Confirmed Neon Endpoint Mapping

Each Neon DB lives on a different compute endpoint. All three DBs are *named*
`neondb` internally — only the endpoint distinguishes them.

| DB | Endpoint hostname | Env file |
|----|-------------------|----------|
| sofar-production | `ep-dry-tooth-ankd0chu` | `/etc/neon-production.env` |
| sofar-market-data | `ep-rough-star-an3dv074` | `/etc/neon-market.env` |
| sofar-research | `ep-old-shadow-amf6u6f6` | `/etc/neon-research.env` |

`/etc/neon.env` is a symlink to `neon-production.env` (legacy fallback).
`/etc/neon-market-reader.env` exists for read-only consumers.

**Critical: `current_database()` and `inet_server_addr()` will NOT distinguish
these three.** They all return `neondb` and pgbouncer addresses. Use the
endpoint hostname OR a unique-table EXISTS check:

- Market-only: `macro_signals`
- Production-only: `positions`
- Research-only: `hypotheses`

---

## Pre-Migration Assertion Pattern

Every DDL migration MUST begin with a target-DB assertion that aborts the
transaction if it lands in the wrong DB. Pattern:

```sql
BEGIN;

DO $assert$
DECLARE
    has_marker_table BOOLEAN;
    has_wrong_marker BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='macro_signals' AND table_schema='public') INTO has_marker_table;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name='positions' AND table_schema='public') INTO has_wrong_marker;

    IF NOT has_marker_table THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: not the expected DB. Aborting.';
    END IF;
    IF has_wrong_marker THEN
        RAISE EXCEPTION 'TARGET ASSERTION FAILED: hit wrong DB. Aborting.';
    END IF;
END
$assert$;

-- ... actual migration here ...

COMMIT;
```

Tonight this pattern would have caught my misroute before any DDL ran.

---

## Shell Pattern for Targeting Specific DB

`/etc/neon-*.env` files contain URLs with `&` characters that bash's job-control
will misinterpret if sourced naively (`source /etc/neon-market.env`). Use the
while-loop pattern that handles them safely:

```bash
unset DATABASE_URL DATABASE_URL_DIRECT
while IFS='=' read -r k v; do
    [[ "$k" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$k" ]] && continue
    export "$k=$v"
done < /etc/neon-market.env

# Verify endpoint visually before running anything
echo "Target host: $(echo "$DATABASE_URL_DIRECT" | sed 's|.*@||; s|/.*||')"

# ... commands using $DATABASE_URL or $DATABASE_URL_DIRECT ...

unset DATABASE_URL DATABASE_URL_DIRECT
```

For DDL/long transactions: use `$DATABASE_URL_DIRECT` (bypasses pgbouncer).
For short queries: use `$DATABASE_URL` (pooled).

---

## Silent Shim Bug — `from db import` Capture-Time Bug

**Found 2026-04-20 in `refresh-flow-aggregates.py`. Likely present in other
scripts.**

The multi-DB shim pattern looks like this:

```python
from db import execute_query                           # ← bug: captures ORIGINAL

import db as _db_module
_original = _db_module.execute_query
def _patched(*args, **kwargs):
    kwargs.setdefault('db', 'market')
    return _original(*args, **kwargs)
_db_module.execute_query = _patched                    # ← patches module
```

**The bug:** `from X import Y` copies the function reference at import time.
The local `execute_query` name in the script still points at the unpatched
original. Every call within the script uses production (the default).

External callers (other modules) using `from db import execute_query` AFTER the
shim runs get the patched version — so probes look correct while the script
itself silently routes wrong.

**Symptom:** queries against tables that exist only in the canonical DB fail
with "relation does not exist" or "column does not exist" errors. Until you
realize the script is talking to the shadow copy in production.

**Fix:** reorder so shim applies BEFORE the import:

```python
import db as _db_module                                # ← module ref only
_original = _db_module.execute_query
def _patched(*args, **kwargs):
    kwargs.setdefault('db', 'market')
    return _original(*args, **kwargs)
_db_module.execute_query = _patched

from db import execute_query                           # ← NOW captures patched
```

**Audit needed:** any script with this shim pattern likely has the bug. Grep:

```bash
grep -lE "_db_module\.execute_query\s*=\s*_patched" ~/scripts/*.py
```

For each match, verify `from db import` happens AFTER the patch assignment.

---

## CURRENT_DATE in Postgres Returns UTC

`SELECT CURRENT_DATE` on Neon returns UTC date. After 8 PM ET, this is
tomorrow's calendar date. Any script using `WHERE session_date = CURRENT_DATE`
after 8 PM ET silently asks about tomorrow.

**Workaround:** the function `fn_session_date(timestamptz)` exists in the
market DB and implements the CBOE GTH session boundary. Use it instead:

```sql
WHERE session_date = fn_session_date(NOW())
```

**TODO:** audit all scripts for `CURRENT_DATE` usage in flow/options queries.
The flow-tape-daemon may be inserting today's late-evening trades with
`session_date = CURRENT_DATE` (= tomorrow), creating data tagged with
phantom session_dates.
