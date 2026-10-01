#!/usr/bin/env bash
# Builds a Teams card telling devs that main moved, and, per open branch, whether
# merging main into it would conflict (via `git merge-tree`, which never touches a
# working tree), which files, and who changed them on main.
# Used by .github/workflows/merge-heads-up.yml; safe to run locally (writes $CARD_OUT).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE=${BASE_REF:-origin/main}
AFTER=${AFTER:-$(git rev-parse "$BASE")}
BEFORE=${BEFORE:-}
SERVER=${SERVER:-https://github.com}
REPO=${REPO:-smooth-glitch/axi-react}
MAX_AGE_DAYS=${MAX_AGE_DAYS:-21}
MAX_BRANCHES=${MAX_BRANCHES:-8}
MAX_FILES=${MAX_FILES:-5}
CARD_OUT=${CARD_OUT:-card.json}

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

# What this push brought into main.
if [ -n "$BEFORE" ] && [ "$BEFORE" != "0000000000000000000000000000000000000000" ] && git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
  RANGE="$BEFORE..$AFTER"; DIFFBASE="$BEFORE"
else
  RANGE="-5 $AFTER"; DIFFBASE="$AFTER~5"
fi
NEW_COMMITS=$(git rev-list --no-merges $RANGE | grep -c . || true)
[ "$NEW_COMMITS" -eq 0 ] && { echo "No new non-merge commits on main; nothing to announce"; exit 0; }
AUTHORS=$(git log --no-merges --format=%an $RANGE | sort -u | paste -sd ',' - | sed 's/,/, /g')
AREAS=$(git diff --name-only "$DIFFBASE" "$AFTER" 2>/dev/null | while read -r P; do [ -n "$P" ] && area "$P"; done | sort | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ /,""); printf "%s %s files  ·  ", $0, c}' | sed 's/  ·  $//')
HIGHLIGHTS=$(git log --no-merges --format='%s' -n 5 $RANGE | jq -R . | jq -s .)

NOW=$(date +%s); CUTOFF=$((NOW - MAX_AGE_DAYS * 86400))
CLEAN='[]'; CONFLICTS='[]'; ERRORS=0; CHECKED=0

while IFS='|' read -r REF TS; do
  B=${REF#origin/}
  case "$B" in HEAD|main|gh-pages|dependabot/*) continue ;; esac
  [ "$TS" -lt "$CUTOFF" ] && continue
  AHEAD=$(git rev-list --count "$BASE..$REF")
  [ "$AHEAD" -eq 0 ] && continue          # fully merged already
  BEHIND=$(git rev-list --count "$REF..$BASE")
  OWNER=$(git log --no-merges --format=%an "$BASE..$REF" | sort | uniq -c | sort -rn | head -1 | awk '{$1=""; sub(/^ /,""); print}')
  CHECKED=$((CHECKED + 1))
  OUT=$(git merge-tree --write-tree --name-only --no-messages "$BASE" "$REF" 2>/dev/null); RC=$?
  if [ "$RC" -eq 0 ]; then
    CLEAN=$(echo "$CLEAN" | jq --arg b "$B" --arg o "$OWNER" --argjson behind "$BEHIND" '. + [{branch:$b,owner:$o,behind:$behind}]')
  elif [ "$RC" -eq 1 ]; then
    FILES_JSON='[]'; N=0
    while IFS= read -r F; do
      [ -z "$F" ] && continue
      N=$((N + 1)); [ "$N" -gt "$MAX_FILES" ] && continue
      BY=$(git log --no-merges --format='%h %s (%an)' -n 1 "$REF..$BASE" -- "$F" | cut -c1-90 | jq -R . | jq -s .)
      FILES_JSON=$(echo "$FILES_JSON" | jq --arg f "$F" --argjson by "$BY" '. + [{file:$f,by:$by}]')
    done < <(echo "$OUT" | tail -n +2)
    CONFLICTS=$(echo "$CONFLICTS" | jq --arg b "$B" --arg o "$OWNER" --argjson behind "$BEHIND" --argjson ahead "$AHEAD" \
      --argjson n "$N" --argjson files "$FILES_JSON" '. + [{branch:$b,owner:$o,behind:$behind,ahead:$ahead,total:$n,files:$files}]')
  else
    ERRORS=$((ERRORS + 1))
  fi
done < <(git for-each-ref --sort=-committerdate --format='%(refname:short)|%(committerdate:unix)' refs/remotes/origin)

build() { jq -n --argjson highlights "$HIGHLIGHTS" --argjson clean "$CLEAN" --argjson conflicts "$CONFLICTS" \
  --arg n "$NEW_COMMITS" --arg authors "$AUTHORS" --arg areas "$AREAS" \
  --arg checked "$CHECKED" --arg errors "$ERRORS" --argjson maxb "$1" \
  --arg sha "${AFTER:0:7}" --arg shaUrl "$SERVER/$REPO/commit/$AFTER" \
  --arg status "$SERVER/$REPO/blob/main/docs/STATUS.md" --arg mainUrl "$SERVER/$REPO/tree/main" '
  def cmd($t): {type:"TextBlock", text:("`" + $t + "`"), wrap:true, size:"Small", spacing:"None"};
  def conflictBlock: {
    type:"Container", style:"attention", spacing:"Small", items:(
      [
        {type:"TextBlock", wrap:true, weight:"Bolder", text:("⚠️ `" + .branch + "`  ·  " + .owner)},
        {type:"TextBlock", wrap:true, size:"Small", isSubtle:true, spacing:"None",
         text:("behind main by " + (.behind|tostring) + ", ahead by " + (.ahead|tostring) + "  ·  " + (.total|tostring) + (if .total == 1 then " file" else " files" end) + " would conflict")}
      ]
      + (.files | map({type:"TextBlock", wrap:true, size:"Small", spacing:"Small",
          text:("📄 **" + .file + "**" + (if (.by|length) > 0 then "\n\n↳ changed on main: " + (.by | join("; ")) else "" end))}))
      + (if .total > (.files|length) then [{type:"TextBlock", size:"Small", isSubtle:true, text:("+" + ((.total - (.files|length))|tostring) + " more files")}] else [] end)
      + [{type:"TextBlock", spacing:"Small", size:"Small", wrap:true, text:("Safe start:  `git switch " + .branch + " && git branch backup/" + .branch + " && git merge origin/main`")}]
    )};
  {type:"message", attachments:[{contentType:"application/vnd.microsoft.card.adaptive",
    content:{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json", type:"AdaptiveCard", version:"1.4",
      msteams:{width:"Full"},
      body:(
        [
          {type:"Container", style:"accent", bleed:true, items:[
            {type:"TextBlock", text:"CONNECTUM  ·  MAIN UPDATED", size:"Small", weight:"Bolder", isSubtle:true},
            {type:"TextBlock", text:"Pull the latest before you continue", size:"Large", weight:"Bolder", spacing:"None", wrap:true},
            {type:"TextBlock", size:"Small", spacing:"None", wrap:true,
             text:($n + (if $n == "1" then " new commit" else " new commits" end) + " by " + $authors + "  ·  [`" + $sha + "`](" + $shaUrl + ")")}
          ]},
          {type:"TextBlock", wrap:true, spacing:"Medium", text:("**What landed** " + ($highlights | map("• " + .) | join("\n\n")))},
          {type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:("**Touched**  " + $areas)},
          {type:"TextBlock", text:"UPDATE YOUR BRANCH", size:"Small", weight:"Bolder", isSubtle:true, separator:true, spacing:"Large"},
          cmd("git fetch origin"),
          cmd("git switch <your-branch>"),
          cmd("git branch backup/<your-branch>"),
          cmd("git merge origin/main"),
          {type:"TextBlock", wrap:true, size:"Small", isSubtle:true, text:"Merge, do not rebase: your commits stay exactly as they are. The backup branch is a full copy of your work from before the merge."},
          {type:"TextBlock", text:"BRANCH CHECK", size:"Small", weight:"Bolder", isSubtle:true, separator:true, spacing:"Large"},
          {type:"TextBlock", wrap:true, size:"Small",
           text:("Checked " + $checked + " active " + (if $checked == "1" then "branch" else "branches" end) + " (pushed in the last 21 days, not yet merged): **" + (($clean|length)|tostring) + " clean**, **" + (($conflicts|length)|tostring) + " with conflicts**" + (if $errors != "0" then ", " + $errors + " could not be checked" else "" end))}
        ]
        + (if ($clean|length) > 0 then [{type:"TextBlock", wrap:true, size:"Small", spacing:"Small",
            text:("✅ **Clean:** " + ($clean | map("`" + .branch + "` (" + .owner + ")") | join(", ")))}] else [] end)
        + ($conflicts | .[0:$maxb] | map(conflictBlock))
        + (if ($conflicts|length) > $maxb then [{type:"TextBlock", size:"Small", isSubtle:true, text:("+" + ((($conflicts|length) - $maxb)|tostring) + " more branches with conflicts")}] else [] end)
        + (if ($conflicts|length) > 0 then [
            {type:"TextBlock", text:"IF YOU GET CONFLICTS", size:"Small", weight:"Bolder", isSubtle:true, separator:true, spacing:"Large"},
            {type:"TextBlock", wrap:true, size:"Small", text:"1. Open each conflicted file. `<<<<<<<` to `=======` is YOUR version, `=======` to `>>>>>>>` is what is now on main. Keep both: main'"'"'s new code and your changes, edited so they work together."},
            {type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:"2. Do not resolve a whole file with `--ours` or `--theirs`, and do not `git reset --hard` or force-push: that silently throws away someone'"'"'s work. If unsure, ask the person named under the file."},
            {type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:"3. `git add <files>` then `git commit`, run the app, then push."},
            {type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:"4. Want out? `git merge --abort` returns you to exactly where you were. Your `backup/...` branch still holds everything."}
          ] else [] end)
      ),
      actions:[
        {type:"Action.OpenUrl", title:"Project status page", url:$status},
        {type:"Action.OpenUrl", title:"Open main", url:$mainUrl}
      ]}}]}' > "$CARD_OUT"; }

# Teams rejects cards over ~28 KB: shrink the number of conflict blocks until it fits.
MB=$MAX_BRANCHES
build "$MB"
while [ "$(wc -c < "$CARD_OUT")" -gt 24000 ] && [ "$MB" -gt 0 ]; do MB=$((MB - 1)); build "$MB"; done
echo "wrote $CARD_OUT ($(wc -c < "$CARD_OUT") bytes, $MB conflict blocks)"
