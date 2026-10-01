#!/usr/bin/env bash
# Teams digest: what merged today (IST), open PRs, and PRs waiting >24h without a review.
# Needs gh (GH_TOKEN) and jq. Posts nothing if there is nothing to report.
set -euo pipefail
REPO=${REPO:-smooth-glitch/axi-react}
SERVER=${SERVER:-https://github.com}
TODAY=$(TZ=Asia/Kolkata date +%Y-%m-%d)
NOW=$(date +%s)

MERGED=$(gh pr list --repo "$REPO" --state merged --limit 50 --json number,title,author,mergedAt,url)
OPEN=$(gh pr list --repo "$REPO" --state open --limit 50 --json number,title,author,createdAt,reviewDecision,isDraft,url)

MERGED_TODAY=$(echo "$MERGED" | jq -r --arg today "$TODAY" '
  map(select((.mergedAt | fromdateiso8601 + 19800 | strftime("%Y-%m-%d")) == $today))
  | map("• [#\(.number)](\(.url)) \(.title) (\(.author.login))") | .[]')
OPEN_LINES=$(echo "$OPEN" | jq -r --argjson now "$NOW" '
  map(select(.isDraft | not)) | sort_by(.createdAt)
  | map((($now - (.createdAt | fromdateiso8601)) / 3600 | floor) as $h
    | "• [#\(.number)](\(.url)) \(.title) (\(.author.login)) · \(if $h >= 48 then "\($h / 24 | floor)d" else "\($h)h" end) open"
      + (if .reviewDecision == "APPROVED" then " · ✅ approved"
         elif .reviewDecision == "CHANGES_REQUESTED" then " · 🔁 changes requested"
         elif $h >= 24 then " · ⏰ waiting for review" else "" end)) | .[]')
N_MERGED=$(echo "$MERGED_TODAY" | grep -c . || true)
N_OPEN=$(echo "$OPEN_LINES" | grep -c . || true)
[ "$N_MERGED" -eq 0 ] && [ "$N_OPEN" -eq 0 ] && { echo "Nothing to report"; exit 0; }

BODY=""
if [ "$N_MERGED" -gt 0 ]; then BODY="## Merged today ($N_MERGED)
$(echo "$MERGED_TODAY" | head -n 10)
"; fi
if [ "$N_OPEN" -gt 0 ]; then BODY="$BODY## Open pull requests ($N_OPEN)
$(echo "$OPEN_LINES" | head -n 12)"; fi

export CARD_STYLE=accent CARD_ICON="📋" CARD_KICKER="CONNECTUM  ·  DAILY DIGEST" CARD_TITLE="$(TZ=Asia/Kolkata date +'%A, %d %b')" \
  CARD_SUB="$N_MERGED merged today  ·  $N_OPEN open" CARD_BODY="$BODY" \
  CARD_ACTIONS="Open pull requests|$SERVER/$REPO/pulls
Project status page|$SERVER/$REPO/blob/main/docs/STATUS.md"
bash "$(dirname "$0")/teams-card.sh" "$@"
