-- 20260502-network-topology-seed.sql
-- Closes: SUBSTRATE_NO_NETWORK_TOPOLOGY_V1
--
-- Seeds the new `network` entity type and node ↔ network relationships,
-- capturing the post-Firewalla-cutover topology.
--
-- Networks captured:
--   home-net@192.168.50.0/24    — ASUS-managed, gateway = 192.168.50.1 (ASUS primary)
--   cluster-net@192.168.51.0/24 — Firewalla-managed, gateway = 192.168.51.1 (Firewalla)
--
-- Relationships:
--   spark-cfbd, spark-73ff, mac1, mac2 → on_network → cluster-net
--   cluster-net → upstream → home-net (cluster routes through Firewalla into home-net)
--
-- Future: when extract_systems_state.py probes nodes, the discovered IP
-- can be matched against network CIDRs to auto-create on_network relationships
-- without manual seeding. Deferred.
--
-- DEPLOY:
--   psql "$NEON_META_URL" -f migrations/20260502-network-topology-seed.sql

BEGIN;

-- ─── Network entities ─────────────────────────────────────────────────

INSERT INTO entities (type, name, attrs, tier, status, extractor, source_ref)
VALUES (
    'network',
    'home-net',
    jsonb_build_object(
        'cidr', '192.168.50.0/24',
        'gateway', '192.168.50.1',
        'gateway_device', 'asus-primary-mesh',
        'dhcp_server', 'asus-primary-mesh',
        'role', 'upstream',
        'description', 'ASUS mesh network — laptops, phones, IoT, anything not in cluster',
        'isolation_boundary', false,
        'managed_by', 'asus_mesh'
    ),
    2,
    'active',
    'manual_seed',
    'manual_seed:2026-05-02-network-topology'
)
ON CONFLICT (type, name) DO UPDATE
SET attrs = EXCLUDED.attrs,
    updated_at = NOW();

INSERT INTO entities (type, name, attrs, tier, status, extractor, source_ref)
VALUES (
    'network',
    'cluster-net',
    jsonb_build_object(
        'cidr', '192.168.51.0/24',
        'gateway', '192.168.51.1',
        'gateway_device', 'firewalla-purple-plus',
        'dhcp_server', 'firewalla-purple-plus',
        'role', 'isolated_cluster',
        'description', 'Firewalla-isolated SOFAR cluster network — 4 hosts, no inbound from home-net without explicit rules',
        'isolation_boundary', true,
        'managed_by', 'firewalla',
        'reserved_ips', jsonb_build_object(
            'spark-cfbd', '192.168.51.137',
            'spark-73ff', '192.168.51.164',
            'mac1', '192.168.51.174',
            'mac2', '192.168.51.132'
        )
    ),
    2,
    'active',
    'manual_seed',
    'manual_seed:2026-05-02-network-topology'
)
ON CONFLICT (type, name) DO UPDATE
SET attrs = EXCLUDED.attrs,
    updated_at = NOW();

-- ─── Network → upstream → network ────────────────────────────────────

INSERT INTO relationships (src_id, dst_id, type, attrs, extractor, source_ref)
SELECT
    src.id, dst.id, 'upstream',
    jsonb_build_object('via', 'firewalla WAN port', 'nat', true),
    'manual_seed',
    'manual_seed:2026-05-02-network-topology'
FROM entities src, entities dst
WHERE src.type = 'network' AND src.name = 'cluster-net'
  AND dst.type = 'network' AND dst.name = 'home-net'
ON CONFLICT (src_id, dst_id, type) DO NOTHING;

-- ─── Node → on_network → cluster-net ─────────────────────────────────

INSERT INTO relationships (src_id, dst_id, type, attrs, extractor, source_ref)
SELECT
    n.id, net.id, 'on_network',
    jsonb_build_object(
        'reserved_ip', net.attrs->'reserved_ips'->>n.name,
        'as_of', '2026-05-02'
    ),
    'manual_seed',
    'manual_seed:2026-05-02-network-topology'
FROM entities n, entities net
WHERE n.type = 'node'
  AND n.name IN ('spark-cfbd', 'spark-73ff', 'mac1', 'mac2')
  AND net.type = 'network' AND net.name = 'cluster-net'
ON CONFLICT (src_id, dst_id, type) DO NOTHING;

COMMIT;
