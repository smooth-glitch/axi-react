#!/usr/bin/env bash
# For every open, non-draft PR from this repo: dry-run "merge main into the PR branch" with
# `git merge-tree` (touches no working tree) and keep ONE sticky comment on the PR that lists
# the conflicting files and how to resolve safely. Clean PRs get their old warning removed.
# docs/STATUS.md is bot-generated and never counted. Needs gh (GH_TOKEN), jq, git >= 2.38.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
. "$(dirname "$0")/repo-env.sh"
BASE=${BASE_REF:-origin/main}
MARK='<!-- connectum-conflict-warning -->'
DRY=${DRY_RUN:-0}

gh pr list --repo "$REPO" --state open --limit 50 --json number,headRefName,isDraft,isCrossRepository \
  | jq -c '.[] | select(.isDraft | not) | select(.isCrossRepository | not)' | while read -r PR; do
  N=$(echo "$PR" | jq -r .number); B=$(echo "$PR" | jq -r .headRefName)
  REF="origin/$B"
  git rev-parse -q --verify "$REF" >/dev/null || { echo "#$N: $REF not fetched, skipping"; continue; }
  OUT=$(git merge-tree --write-tree --name-only --no-messages "$BASE" "$REF" 2>/dev/null); RC=$?
  FILES=""; [ "$RC" -eq 1 ] && FILES=$(echo "$OUT" | tail -n +2 | grep -vxF 'docs/STATUS.md' | grep -v '^$' || true)

  EXISTING=$(gh api "repos/$REPO/issues/$N/comments" --paginate --jq ".[] | select(.body | contains(\"$MARK\")) | .id" | head -1)
  if [ -z "$FILES" ]; then
    echo "#$N ($B): clean"
    [ -n "$EXISTING" ] && [ "$DRY" != 1 ] && gh api -X DELETE "repos/$REPO/issues/comments/$EXISTING" >/dev/null
    continue
  fi
  LIST=$(echo "$FILES" | head -n 15 | sed 's/^/- `/; s/$/`/')
  MORE=$(( $(echo "$FILES" | grep -c .) - 15 )); [ "$MORE" -gt 0 ] && LIST="$LIST
- ...and $MORE more"
  BODY="$MARK
### ⚠️ This PR would conflict with \`main\`

Merging \`main\` into \`$B\` today conflicts in:

$LIST

**Resolve it without losing anyone's work:**
1. \`git fetch origin && git switch $B && git branch backup/$B\` (a full copy of your work)
2. \`git merge origin/main\` (merge, not rebase: your commits stay as they are)
3. In each conflicted file keep **both** sides: main's new code and your changes, edited so they work together. Don't resolve a whole file with \`--ours\`/\`--theirs\`, and don't \`git reset --hard\` or force-push.
4. \`git add <files> && git commit\`, run the app, push.
5. Want out? \`git merge --abort\` returns you to where you were; \`backup/$B\` still has everything.

_Updated automatically whenever \`main\` or this PR changes._"
  echo "#$N ($B): conflicts in $(echo "$FILES" | grep -c .) file(s)"
  [ "$DRY" = 1 ] && { echo "$BODY"; continue; }
  if [ -n "$EXISTING" ]; then gh api -X PATCH "repos/$REPO/issues/comments/$EXISTING" -f body="$BODY" >/dev/null
  else gh api -X POST "repos/$REPO/issues/$N/comments" -f body="$BODY" >/dev/null; fi
done
