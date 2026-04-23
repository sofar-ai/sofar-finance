#!/bin/bash
# changelog-add.sh — append a line to SYSTEM-CHANGELOG.md under today's section
#
# Matches sections by date prefix (## YYYY-MM-DD ...) so existing sections
# named "Wednesday session" or "Wednesday evening session" or anything starting
# with today's date are matched and appended to.
#
# Usage:
#   changelog-add.sh "[TAG] description"
#   changelog-add.sh "[TAG] description" --commit

set -e

SCL=~/sofar-finance/SYSTEM-CHANGELOG.md
ENTRY="$1"
COMMIT="$2"

if [ -z "$ENTRY" ]; then
    echo "Usage: $0 \"[TAG] description\" [--commit]"
    exit 1
fi

if [ ! -f "$SCL" ]; then
    echo "ERROR: $SCL does not exist."
    exit 1
fi

TODAY=$(date +%Y-%m-%d)
DOW=$(date +%A)
NEW_SECTION_HEADER="## $TODAY ($DOW session)"
LINE="- $ENTRY"

# Check if any section starts with today's date
if grep -qE "^## $TODAY" "$SCL"; then
    # Section exists for today — find its exact header and insert after it
    EXISTING_HEADER=$(grep -E "^## $TODAY" "$SCL" | head -1)
    awk -v hdr="$EXISTING_HEADER" -v line="$LINE" '
        $0 == hdr { print; print ""; print line; getline; if ($0 != "") print $0; next }
        { print }
    ' "$SCL" > "$SCL.tmp" && mv "$SCL.tmp" "$SCL"
    echo "Appended to existing today section ($EXISTING_HEADER):"
    echo "  $LINE"
else
    # No section for today — create one
    awk -v hdr="$NEW_SECTION_HEADER" -v line="$LINE" '
        BEGIN { inserted = 0 }
        /^---$/ && !inserted { print; print ""; print hdr; print ""; print line; print ""; print "---"; inserted = 1; next }
        { print }
    ' "$SCL" > "$SCL.tmp" && mv "$SCL.tmp" "$SCL"
    echo "Created new today section:"
    echo "  $NEW_SECTION_HEADER"
    echo "  $LINE"
fi

if [ "$COMMIT" = "--commit" ]; then
    cd ~/sofar-finance
    git add SYSTEM-CHANGELOG.md
    git commit -m "system-changelog: $ENTRY" --quiet
    git push origin main --quiet 2>&1 | tail -3
    echo "Committed and pushed."
fi
