"""
SOFAR Finance — Schema Dump
Auto-generates SCHEMA.md from live database introspection.

Usage:
    python3 dump-schemas.py             # write to docs/SCHEMA.md
    python3 dump-schemas.py --stdout    # print to stdout (for testing)
    python3 dump-schemas.py --commit    # also git-commit + push the result

Cron: weekly Sunday 02:00 ET via crontab.

Sentinel: SCHEMA_DUMP_V1
Companion to SYSTEM-CHANGELOG.md and TABLE_DB_MAP routing in db.py.
"""
import sys
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
sys.path.insert(0, '/home/bot1/scripts')
import db
from db import execute_query

# Common timestamp column names, in priority order
TIMESTAMP_CANDIDATES = [
    'ingested_at', 'created_at', 'report_date', 'date',
    'session_date', 'archived_at', 'ts', 'timestamp',
    'published_date', 'last_refreshed_at', 'recorded_at'
]

DB_NAMES = ['market', 'production', 'research']


def list_tables(db_name):
    """Return list of public tables in given DB."""
    rows = execute_query("""
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public' AND tablename NOT LIKE 'pg_%'
        ORDER BY tablename
    """, db=db_name)
    return [r['tablename'] for r in rows]


def list_views(db_name):
    """Return list of public views in given DB."""
    rows = execute_query("""
        SELECT viewname FROM pg_views 
        WHERE schemaname = 'public'
        ORDER BY viewname
    """, db=db_name)
    return [r['viewname'] for r in rows]


def get_columns(db_name, table_name):
    """Return list of (column_name, data_type, is_nullable) for a table."""
    rows = execute_query("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
    """, (table_name,), db=db_name)
    return [(r['column_name'], r['data_type'], r['is_nullable']) for r in rows]


def get_row_count(db_name, table_name):
    """Estimate row count using pg_class.reltuples (fast for large tables)."""
    try:
        rows = execute_query("""
            SELECT reltuples::bigint AS estimate
            FROM pg_class WHERE relname = %s AND relkind = 'r'
        """, (table_name,), db=db_name)
        if rows and rows[0]['estimate'] >= 0:
            return rows[0]['estimate']
        # Fallback to exact count for small/empty tables
        rows = execute_query(f"SELECT COUNT(*) AS n FROM {table_name}", db=db_name)
        return rows[0]['n']
    except Exception as e:
        return f"err: {str(e)[:50]}"


def get_latest_timestamp(db_name, table_name, columns):
    """Find latest timestamp from common timestamp columns."""
    col_names = {c[0] for c in columns}
    for ts_col in TIMESTAMP_CANDIDATES:
        if ts_col in col_names:
            try:
                rows = execute_query(
                    f"SELECT MAX({ts_col}) AS latest FROM {table_name}",
                    db=db_name
                )
                if rows and rows[0]['latest'] is not None:
                    return ts_col, rows[0]['latest']
            except Exception:
                continue
    return None, None


def render_table_section(db_name, table_name):
    """Render markdown for one table."""
    columns = get_columns(db_name, table_name)
    if not columns:
        return f"### {table_name}\n*(no columns found — possibly view or permission issue)*\n\n"
    
    row_count = get_row_count(db_name, table_name)
    ts_col, latest = get_latest_timestamp(db_name, table_name, columns)
    
    if isinstance(row_count, int):
        count_str = f"{row_count:,} rows"
    else:
        count_str = str(row_count)
    
    if latest is not None:
        latest_str = f"latest `{ts_col}`: {latest}"
    else:
        latest_str = "no recognized timestamp column"
    
    out = f"### {table_name}\n"
    out += f"*{count_str}, {latest_str}*\n\n"
    out += "| Column | Type | Nullable |\n"
    out += "|---|---|---|\n"
    for col_name, data_type, is_nullable in columns:
        nullable_marker = "✓" if is_nullable == 'YES' else ""
        out += f"| `{col_name}` | {data_type} | {nullable_marker} |\n"
    out += "\n"
    return out


def render_db_section(db_name):
    """Render markdown for an entire database."""
    out = f"## {db_name.upper()} DB\n\n"
    
    tables = list_tables(db_name)
    views = list_views(db_name)
    
    out += f"*{len(tables)} tables, {len(views)} views*\n\n"
    
    if tables:
        out += "### Tables\n\n"
        for t in tables:
            out += render_table_section(db_name, t)
    
    if views:
        out += "### Views\n\n"
        for v in views:
            out += render_table_section(db_name, v)
    
    return out


def render_full(timestamp):
    """Render the complete SCHEMA.md."""
    out = "# SOFAR Finance — Database Schemas\n\n"
    out += f"*Auto-generated: {timestamp.strftime('%Y-%m-%d %H:%M:%S ET')}*\n\n"
    out += "Snapshot of all tables and views across the three Neon Postgres databases.\n"
    out += "Generated by `~/sofar-finance/tools/dump-schemas.py`. Re-run weekly via cron.\n\n"
    out += "**Routing:** Tables route to their canonical DB via `TABLE_DB_MAP` in `db.py` (DB_TABLE_ROUTING_V1).\n\n"
    out += "**Latest timestamp:** Best-effort — script tries common timestamp columns "
    out += "(ingested_at, created_at, report_date, date, ts, etc.) in priority order.\n\n"
    out += "---\n\n"
    
    for db_name in DB_NAMES:
        out += render_db_section(db_name)
        out += "\n---\n\n"
    
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stdout', action='store_true', help='Print to stdout, do not write file')
    parser.add_argument('--commit', action='store_true', help='Git commit + push the result')
    args = parser.parse_args()
    
    print(f"[{datetime.now()}] Generating schema dump...", file=sys.stderr)
    timestamp = datetime.now()
    content = render_full(timestamp)
    
    if args.stdout:
        print(content)
        return
    
    out_path = Path.home() / 'sofar-finance' / 'docs' / 'SCHEMA.md'
    out_path.write_text(content)
    print(f"Wrote {out_path} ({len(content):,} chars)", file=sys.stderr)
    
    if args.commit:
        repo_dir = Path.home() / 'sofar-finance'
        try:
            subprocess.run(['git', 'add', 'docs/SCHEMA.md'], cwd=repo_dir, check=True)
            # Check if there's actually a change
            r = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=repo_dir)
            if r.returncode == 0:
                print("No changes to commit.", file=sys.stderr)
                return
            subprocess.run([
                'git', 'commit', '-m', 
                f'chore: weekly schema dump {timestamp.strftime("%Y-%m-%d")}'
            ], cwd=repo_dir, check=True)
            subprocess.run(['git', 'push', 'origin', 'main'], cwd=repo_dir, check=True)
            print("Committed and pushed.", file=sys.stderr)
        except subprocess.CalledProcessError as e:
            print(f"Git operation failed: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
