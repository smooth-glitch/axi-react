#!/usr/bin/env bash
# Regenerates docs/STATUS.md from git history and docs/NEXT_STEPS.md.
# Run by .github/workflows/update-status.yml on every push to main; safe to run locally.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
OUT=docs/STATUS.md
REPO_URL=${REPO_URL:-https://github.com/smooth-glitch/axi-react}

area() {
  case "$1" in
    axi-chat-backend/*) echo "Backend" ;;
    web/*|src/*|components/*|public/*|index.html) echo "Frontend" ;;
    docs/*|*.md) echo "Docs" ;;
    .github/*|ops/*|nginx/*|scripts/*) echo "CI / DevOps" ;;
    e2e/*|tests/*) echo "Tests" ;;
    *) echo "Other" ;;
  esac
}

DONE=$(grep -c '^\s*- \[x\]' docs/NEXT_STEPS.md 2>/dev/null || true)
OPEN=$(grep -c '^\s*- \[ \]' docs/NEXT_STEPS.md 2>/dev/null || true)
TOTAL=$((DONE + OPEN))
PCT=0; [ "$TOTAL" -gt 0 ] && PCT=$((DONE * 100 / TOTAL))
FILLED=$((PCT / 5)); BAR=""
for n in $(seq 1 20); do if [ "$n" -le "$FILLED" ]; then BAR="${BAR}▰"; else BAR="${BAR}▱"; fi; done

{
  echo "# ⬡ Connectum · Live Status"
  echo
  echo "> Auto-generated on every push to \`main\`. Do not edit by hand."
  echo "> Last updated: $(date -u +'%d %b %Y, %H:%M UTC') · commit [\`$(git rev-parse --short HEAD)\`]($REPO_URL/commit/$(git rev-parse HEAD))"
  echo
  echo "## New here? Start here"
  echo
  echo "**Connectum** is the AXI chat platform: a React SPA frontend plus an Erlang/OTP real-time chat backend, in this one repo."
  echo
  echo "1. Read the [README]($REPO_URL#readme), especially its *Start here, by role* table."
  echo "2. Skim the docs below, then clone the repo and follow the README's run instructions."
  echo "3. In the **Connectum dev group** on Teams, scroll up for the history of decisions. Ask whoever adds you to share chat history from the start."
  echo "4. Check [Recent changes](#recent-changes) to see what is moving right now, and [NEXT_STEPS](NEXT_STEPS.md) for what is planned."
  echo
  echo "### Who owns what"
  echo
  echo "| Area | Owner |"
  echo "|---|---|"
  echo "| Erlang chat backend, DevOps | Arjun |"
  echo "| Lite tstruct UI | Gunn |"
  echo "| Rest of the UI and wiring it to the backend | Anish |"
  echo
  echo "### Docs index"
  echo
  for f in docs/*.md axi-chat-backend/README.md axi-chat-backend/docs/*.md; do
    [ -f "$f" ] || continue
    case "$f" in docs/STATUS.md) continue ;; esac
    T=$(grep -m1 '^# ' "$f" | sed 's/^# *//'); T=${T:-$(basename "$f")}
    case "$f" in docs/*) L=$(basename "$f") ;; *) L="../$f" ;; esac
    echo "- [$T]($L) · \`$f\`"
  done
  echo
  echo "## Progress"
  echo
  echo "\`$BAR\` **$PCT%** · $DONE of $TOTAL checklist items in [NEXT_STEPS](NEXT_STEPS.md) done"
  echo
  echo "## Last 30 days"
  echo
  echo "| Contributor | Commits |"
  echo "|---|---|"
  git log --no-merges --since='30 days ago' --format=%an | sort | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ /,""); printf "| %s | %s |\n", $0, c}'
  echo
  echo "| Area | Files touched |"
  echo "|---|---|"
  git log --no-merges --since='30 days ago' --name-only --format= | sort -u | while read -r P; do [ -n "$P" ] && area "$P"; done | sort | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ /,""); printf "| %s | %s |\n", $0, c}'
  echo
  echo "## Recent changes"
  echo
  echo "| When | Who | Change | Diff |"
  echo "|---|---|---|---|"
  git log --no-merges -n 25 --format='%H|%an|%ad|%s' --date=format:'%d %b' | while IFS='|' read -r H N D S; do
    read -r I X <<< "$(git show --numstat --format= "$H" | awk '$1 ~ /^[0-9]+$/ {i+=$1; d+=$2} END {print i+0, d+0}')"
    S=${S//|/\\|}
    echo "| $D | $N | [\`${H:0:7}\`]($REPO_URL/commit/$H) $S | +$I / −$X |"
  done
} > "$OUT"
echo "wrote $OUT"
