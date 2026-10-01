#!/usr/bin/env bash
# Prints release notes (Markdown) for the commits between two refs, grouped by conventional-commit type.
# Usage: release-notes.sh <to-ref> [from-ref]   (from-ref defaults to the previous tag, else the first commit)
set -euo pipefail
TO=${1:?usage: release-notes.sh <to-ref> [from-ref]}
FROM=${2:-$(git describe --tags --abbrev=0 "$TO^" 2>/dev/null || true)}
RANGE=${FROM:+$FROM..}$TO
REPO_URL=${REPO_URL:-https://github.com/smooth-glitch/axi-react}

section() {  # $1 heading  $2 egrep of types
  local rows
  rows=$(git log --no-merges --invert-grep --grep='docs: refresh STATUS.md' --format='%h|%an|%s' "$RANGE" | grep -E "^[0-9a-f]+\|[^|]*\|($2)(\([^)]*\))?!?:" || true)
  [ -z "$rows" ] && return 0
  echo "### $1"; echo
  echo "$rows" | while IFS='|' read -r H A S; do
    echo "- ${S#*: } ([\`$H\`]($REPO_URL/commit/$H), $A)"
  done
  echo
}
echo "## What's changed${FROM:+ since $FROM}"; echo
section "✨ Features" "feat"
section "🐛 Fixes" "fix"
section "⚡ Performance" "perf"
section "♻️ Refactors" "refactor"
section "📚 Docs" "docs"
section "⚙️ CI & chores" "ci|chore|build|style|test"
OTHER=$(git log --no-merges --invert-grep --grep='docs: refresh STATUS.md' --format='%h|%an|%s' "$RANGE" | grep -vE "^[0-9a-f]+\|[^|]*\|(feat|fix|perf|refactor|docs|ci|chore|build|style|test)(\([^)]*\))?!?:" || true)
if [ -n "$OTHER" ]; then echo "### Other"; echo; echo "$OTHER" | while IFS='|' read -r H A S; do echo "- $S ([\`$H\`]($REPO_URL/commit/$H), $A)"; done; echo; fi
echo "**Full changelog:** $REPO_URL/compare/${FROM:-$(git rev-list --max-parents=0 "$TO" | tail -1)}...$TO"
