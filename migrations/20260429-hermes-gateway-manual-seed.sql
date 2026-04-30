-- 20260429-hermes-gateway-manual-seed.sql
-- Sentinel: HERMES_GATEWAY_MANUAL_SEED_V1
--
-- Manually seeds hermes-gateway.service@spark-cfbd as a systemd_unit entity.
-- extract_systemd_units.py only walks /etc/systemd/system/sofar-*.service —
-- so user-level units at ~/.config/systemd/user/ are invisible to the
-- automated extractor. This INSERT puts hermes-gateway substrate-canonical.
--
-- Real captured: this is a tactical fix. Real architectural fix is patching
-- extract_systemd_units.py to also walk user-level systemd dirs. Captured as
-- SUBSTRATE_SYSTEMD_UNIT_FILTER_TOO_NARROW_V1, deferred.
--
-- DEPLOY:
--   psql "$NEON_META_URL" -f migrations/20260429-hermes-gateway-manual-seed.sql

BEGIN;

INSERT INTO entities (type, name, attrs, tier, status, extractor, source_ref)
VALUES (
    'systemd_unit',
    'hermes-gateway.service@spark-cfbd',
    jsonb_build_object(
        'host', 'spark-cfbd',
        'scope', 'user',
        'user', 'bot1',
        'state', 'active',
        'enabled', true,
        'restart', 'on-failure',
        'restart_sec', 30,
        'basename', 'hermes-gateway.service',
        'description', 'Hermes Agent Gateway - Messaging Platform Integration',
        'exec_start', '/home/bot1/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run --replace',
        'working_directory', '/home/bot1/.hermes/hermes-agent',
        'standard_output', 'journal',
        'standard_error', 'journal',
        'last_modified', '2026-04-12T16:22:00+00:00',
        'environment_vars', jsonb_build_object(
            'HERMES_HOME', '/home/bot1/.hermes',
            'VIRTUAL_ENV', '/home/bot1/.hermes/hermes-agent/venv'
        ),
        'environment_files', jsonb_build_array(),
        'hardcoded_ips', jsonb_build_array(),
        'unit_changed_on_disk', false
    ),
    2,
    'active',
    'manual_seed',
    'spark-cfbd:/home/bot1/.config/systemd/user/hermes-gateway.service'
)
ON CONFLICT (type, name) DO UPDATE
SET attrs = EXCLUDED.attrs,
    updated_at = NOW();

COMMIT;
