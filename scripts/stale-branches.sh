#!/usr/bin/env bash
# Weekly Teams list of (a) branches already merged through a PR but never deleted and
# (b) branches with unmerged commits and no activity for 30+ days. Reports only: it never deletes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REPO=${REPO:-smooth-glitch/axi-react}
SERVER=${SERVER:-https://github.com}
STALE_DAYS=${STALE_DAYS:-30}
BASE=${BASE_REF:-origin/main}
NOW=$(date +%s)
MERGED_PRS=$(gh pr list --repo "$REPO" --state merged --limit 300 --json headRefName,headRefOid)
MERGED_LINES=""; STALE_LINES=""; NM=0; NS=0

while IFS='|' read -r REF TS AUTHOR; do
  B=${REF#origin/}
  case "$B" in HEAD|main|gh-pages) continue ;; esac
  AHEAD=$(git rev-list --count "$BASE..$REF")
  TIP=$(git rev-parse "$REF")
  if echo "$MERGED_PRS" | jq -e --arg b "$B" --arg s "$TIP" 'any(.[]; .headRefName==$b and .headRefOid==$s)' >/dev/null; then
    NM=$((NM + 1)); [ "$NM" -le 20 ] && MERGED_LINES="${MERGED_LINES}• \`$B\` ($AUTHOR)
"
    continue
  fi
  [ "$AHEAD" -eq 0 ] && continue
  DAYS=$(( (NOW - TS) / 86400 ))
  if [ "$DAYS" -ge "$STALE_DAYS" ]; then
    NS=$((NS + 1)); [ "$NS" -le 20 ] && STALE_LINES="${STALE_LINES}• \`$B\` ($AUTHOR) · $AHEAD unmerged commits · quiet for ${DAYS}d
"
  fi
done < <(git for-each-ref --sort=committerdate --format='%(refname:short)|%(committerdate:unix)|%(authorname)' refs/remotes/origin)

[ "$NM" -eq 0 ] && [ "$NS" -eq 0 ] && { echo "No stale or merged-but-undeleted branches"; exit 0; }
BODY=""
[ "$NM" -gt 0 ] && BODY="## Already merged, safe to delete ($NM)
${MERGED_LINES}Delete with: \`git push origin --delete <branch>\`
"
[ "$NS" -gt 0 ] && BODY="${BODY}## No activity for ${STALE_DAYS}+ days, unmerged work ($NS)
${STALE_LINES}Owners: merge it, or say if it can go."

export CARD_STYLE=warning CARD_ICON="🧹" CARD_KICKER="CONNECTUM  ·  BRANCH HOUSEKEEPING" CARD_TITLE="Branches that need a decision" \
  CARD_SUB="$NM merged but not deleted  ·  $NS stale" CARD_BODY="$BODY" CARD_ACTIONS="All branches|$SERVER/$REPO/branches"
bash "$(dirname "$0")/teams-card.sh" "$@"
