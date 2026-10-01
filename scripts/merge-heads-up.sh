#!/usr/bin/env bash
# Builds ONE Teams card for a push to main: who merged what (stats + commits), a
# pull reminder, and a per-branch forecast of "merge main into this branch" (via
# `git merge-tree`, which never touches a working tree): which branches are clean,
# which would conflict, in which files, and who changed them on main.
# Branches already merged (including squash merges) are ignored; docs/STATUS.md is
# bot-generated and never counted as a conflict.
# Used by .github/workflows/merge-heads-up.yml; safe to run locally (writes $CARD_OUT).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE=${BASE_REF:-origin/main}
AFTER=${AFTER:-$(git rev-parse "$BASE")}
BEFORE=${BEFORE:-}
ACTOR=${ACTOR:-}
. "$(dirname "$0")/repo-env.sh"
MAX_AGE_DAYS=${MAX_AGE_DAYS:-21}
MAX_BRANCHES=${MAX_BRANCHES:-8}
MAX_COMMITS=${MAX_COMMITS:-6}
MAX_FILES=${MAX_FILES:-3}
CARD_OUT=${CARD_OUT:-card.json}
GENERATED='docs/STATUS.md'

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

# ---- What this push brought into main -------------------------------------
if [ -n "$BEFORE" ] && [ "$BEFORE" != "0000000000000000000000000000000000000000" ] && git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
  RANGE="$BEFORE..$AFTER"; COMPARE="$SERVER/$REPO/compare/${BEFORE:0:7}...${AFTER:0:7}"
else
  RANGE="-5 $AFTER"; COMPARE="$SERVER/$REPO/commits/$DEFAULT_BRANCH"
fi
HASHES=$(git rev-list --no-merges --reverse $RANGE)
TOTAL=$(echo "$HASHES" | grep -c . || true)
[ "$TOTAL" -eq 0 ] && { echo "No new non-merge commits on main; nothing to announce"; exit 0; }
SHOWN=$(echo "$HASHES" | tail -n "$MAX_COMMITS")

TOT_INS=0; TOT_DEL=0; ALL_FILES=$(mktemp); COMMITS_JSON='[]'
for H in $HASHES; do
  read -r I D <<< "$(git show --numstat --format= "$H" | awk '$1 ~ /^[0-9]+$/ {i+=$1; d+=$2} END {print i+0, d+0}')"
  TOT_INS=$((TOT_INS + I)); TOT_DEL=$((TOT_DEL + D))
  git show --name-only --format= "$H" >> "$ALL_FILES"
done
for H in $SHOWN; do
  NAME=$(git show -s --format=%an "$H")
  DATE=$(TZ=Asia/Kolkata git show -s --format=%ad --date=format-local:'%d %b, %H:%M IST' "$H")
  SUBJECT=$(git show -s --format=%s "$H")
  TYPE=$(echo "$SUBJECT" | sed -nE 's/^([a-z]+)(\([^)]*\))?!?:.*/\1/p')
  SCOPE=$(echo "$SUBJECT" | sed -nE 's/^[a-z]+\(([^)]*)\)!?:.*/\1/p')
  TITLE=$(echo "$SUBJECT" | sed -E 's/^[a-z]+(\([^)]*\))?!?: ?//' | cut -c1-120)
  case "$TYPE" in
    feat) ICON="✨" ;; fix) ICON="🐛" ;; docs) ICON="📚" ;; ci) ICON="⚙️" ;; refactor) ICON="♻️" ;;
    test) ICON="🧪" ;; perf) ICON="⚡" ;; chore) ICON="🧹" ;; style) ICON="🎨" ;; *) ICON="🔹" ;;
  esac
  BODY=$(git show -s --format=%b "$H" | grep -Evi '^(Co-Authored-By|Claude-Session|Signed-off-by|Reviewed-by):' | grep -v '^$' | head -n 2 | cut -c1-160 || true)
  read -r I D F <<< "$(git show --numstat --format= "$H" | awk '$1 ~ /^[0-9]+$/ {i+=$1; d+=$2} {f++} END {print i+0, d+0, f+0}')"
  AREAS_C=$(git show --name-only --format= "$H" | while read -r P; do [ -n "$P" ] && area "$P"; done | sort -u | paste -sd ',' - | sed 's/,/ · /g')
  COMMITS_JSON=$(echo "$COMMITS_JSON" | jq --arg h "${H:0:7}" --arg url "$SERVER/$REPO/commit/$H" --arg name "$NAME" --arg date "$DATE" \
    --arg title "$TITLE" --arg icon "$ICON" --arg scope "$SCOPE" --arg body "$BODY" --arg areas "$AREAS_C" \
    --argjson ins "$I" --argjson del "$D" --argjson files "$F" \
    '. + [{h:$h,url:$url,name:$name,date:$date,title:$title,icon:$icon,scope:$scope,body:$body,areas:$areas,ins:$ins,del:$del,files:$files}]')
done
FILES_N=$(sort -u "$ALL_FILES" | grep -c . || true)
AUTHORS=$(for H in $HASHES; do git show -s --format=%an "$H"; done | sort | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ /,""); printf "%s (%s), ", $0, c}' | sed 's/, $//')
AREAS=$(sort -u "$ALL_FILES" | while read -r P; do [ -n "$P" ] && area "$P"; done | sort | uniq -c | sort -rn | awk '{c=$1; $1=""; sub(/^ /,""); printf "%s %s  ·  ", $0, c}' | sed 's/  ·  $//')

# ---- Branch forecast -----------------------------------------------------
MERGED_PRS='[]'
if command -v gh >/dev/null 2>&1; then
  MERGED_PRS=$(gh pr list --repo "$REPO" --state merged --limit 300 --json headRefName,headRefOid 2>/dev/null || echo '[]')
  echo "$MERGED_PRS" | jq -e . >/dev/null 2>&1 || MERGED_PRS='[]'
fi

# True when every file the branch changed already has identical content on main
# (what a squash merge of an unmodified branch looks like).
already_in_main() {
  local ref=$1 mb files f
  mb=$(git merge-base "$BASE" "$ref") || return 1
  files=$(git diff --name-only "$mb" "$ref")
  [ -z "$files" ] && return 0
  while IFS= read -r f; do
    [ "$(git rev-parse -q --verify "$ref:$f" 2>/dev/null)" = "$(git rev-parse -q --verify "$BASE:$f" 2>/dev/null)" ] || return 1
  done <<< "$files"
  return 0
}

NOW=$(date +%s); CUTOFF=$((NOW - MAX_AGE_DAYS * 86400))
CLEAN='[]'; CONFLICTS='[]'; ERRORS=0; CHECKED=0; MERGED_SKIPPED=0

while IFS='|' read -r REF TS; do
  B=${REF#origin/}
  case "$B" in HEAD|main|gh-pages|dependabot/*) continue ;; esac
  [ "$TS" -lt "$CUTOFF" ] && continue
  AHEAD=$(git rev-list --count "$BASE..$REF")
  [ "$AHEAD" -eq 0 ] && continue
  TIP=$(git rev-parse "$REF")
  if echo "$MERGED_PRS" | jq -e --arg b "$B" --arg s "$TIP" 'any(.[]; .headRefName==$b and .headRefOid==$s)' >/dev/null 2>&1; then
    MERGED_SKIPPED=$((MERGED_SKIPPED + 1)); continue
  fi
  BEHIND=$(git rev-list --count "$REF..$BASE")
  OWNER=$(git log --no-merges --format=%an "$BASE..$REF" | sort | uniq -c | sort -rn | head -1 | awk '{$1=""; sub(/^ /,""); print}')
  OUT=$(git merge-tree --write-tree --name-only --no-messages "$BASE" "$REF" 2>/dev/null); RC=$?
  if [ "$RC" -eq 1 ]; then
    CONFLICT_FILES=$(echo "$OUT" | tail -n +2 | grep -vxF "$GENERATED" | grep -v '^$' || true)
    if [ -z "$CONFLICT_FILES" ]; then RC=0
    elif already_in_main "$REF"; then MERGED_SKIPPED=$((MERGED_SKIPPED + 1)); continue
    fi
  fi
  CHECKED=$((CHECKED + 1))
  if [ "$RC" -eq 0 ]; then
    CLEAN=$(echo "$CLEAN" | jq --arg b "$B" --arg o "$OWNER" '. + [{branch:$b,owner:$o}]')
  elif [ "$RC" -eq 1 ]; then
    FILES_JSON='[]'; N=0
    while IFS= read -r F; do
      [ -z "$F" ] && continue
      N=$((N + 1)); [ "$N" -gt "$MAX_FILES" ] && continue
      BY=$(git log --no-merges --format='%h %s (%an)' -n 1 "$REF..$BASE" -- "$F" | cut -c1-90 | jq -R . | jq -s .)
      FILES_JSON=$(echo "$FILES_JSON" | jq --arg f "$F" --argjson by "$BY" '. + [{file:$f,by:$by}]')
    done <<< "$CONFLICT_FILES"
    CONFLICTS=$(echo "$CONFLICTS" | jq --arg b "$B" --arg o "$OWNER" --argjson behind "$BEHIND" --argjson ahead "$AHEAD" \
      --argjson n "$N" --argjson files "$FILES_JSON" '. + [{branch:$b,owner:$o,behind:$behind,ahead:$ahead,total:$n,files:$files}]')
  else
    ERRORS=$((ERRORS + 1))
  fi
done < <(git for-each-ref --sort=-committerdate --format='%(refname:short)|%(committerdate:unix)' refs/remotes/origin)

# ---- Card ----------------------------------------------------------------
build() {  # $1 = max conflict blocks, $2 = max commit blocks
  jq -n --argjson commits "$(echo "$COMMITS_JSON" | jq --argjson m "$2" '.[-$m:]')" \
    --argjson clean "$CLEAN" --argjson conflicts "$CONFLICTS" --argjson maxb "$1" \
    --arg total "$TOTAL" --arg files "$FILES_N" --arg ins "$TOT_INS" --arg del "$TOT_DEL" \
    --arg authors "$AUTHORS" --arg areas "$AREAS" --arg actor "$ACTOR" --arg actorUrl "$SERVER/$ACTOR" \
    --arg when "$(TZ=Asia/Kolkata date +'%d %b %Y · %H:%M IST')" --arg compare "$COMPARE" \
    --arg checked "$CHECKED" --arg errors "$ERRORS" --arg merged "$MERGED_SKIPPED" --arg days "$MAX_AGE_DAYS" \
    --arg sha "${AFTER:0:7}" --arg shaUrl "$SERVER/$REPO/commit/$AFTER" \
    --arg status "$SERVER/$REPO/blob/$DEFAULT_BRANCH/docs/STATUS.md" --arg mainUrl "$SERVER/$REPO/tree/$DEFAULT_BRANCH" '
    def tile($num; $label; $color): {type:"Column", width:"stretch", items:[{type:"Container", style:"emphasis", items:[
      {type:"TextBlock", text:$num, size:"ExtraLarge", weight:"Bolder", color:$color, horizontalAlignment:"Center"},
      {type:"TextBlock", text:$label, size:"Small", isSubtle:true, spacing:"None", horizontalAlignment:"Center"}]}]};
    def cmd($t): {type:"TextBlock", text:("`" + $t + "`"), wrap:true, size:"Small", spacing:"None"};
    def commitBlock: {type:"Container", style:"emphasis", spacing:"Small", items:[{type:"ColumnSet", columns:[
      {type:"Column", width:"auto", items:[{type:"TextBlock", text:.icon, size:"Large"}]},
      {type:"Column", width:"stretch", items:(
        [{type:"TextBlock", wrap:true, weight:"Bolder", text:((if .scope != "" then "`" + .scope + "`  " else "" end) + .title)},
         {type:"TextBlock", isSubtle:true, spacing:"None", wrap:true, size:"Small", text:("[`" + .h + "`](" + .url + ")  ·  **" + .name + "**  ·  " + .date)}]
        + (if .body != "" then [{type:"TextBlock", text:.body, wrap:true, spacing:"Small", size:"Small"}] else [] end)
        + [{type:"TextBlock", spacing:"Small", size:"Small", wrap:true,
            text:("🟢 +" + (.ins|tostring) + "   🔴 −" + (.del|tostring) + "   📄 " + (.files|tostring) + (if .files == 1 then " file" else " files" end) + (if .areas != "" then "   ·   " + .areas else "" end))}]
      )}]}]};
    def conflictBlock: {type:"Container", style:"attention", spacing:"Small", items:(
      [{type:"TextBlock", wrap:true, weight:"Bolder", text:("⚠️ `" + .branch + "`  ·  " + .owner)},
       {type:"TextBlock", wrap:true, size:"Small", isSubtle:true, spacing:"None",
        text:("behind main by " + (.behind|tostring) + ", ahead by " + (.ahead|tostring) + "  ·  " + (.total|tostring) + (if .total == 1 then " file" else " files" end) + " would conflict")}]
      + (.files | map({type:"TextBlock", wrap:true, size:"Small", spacing:"Small",
          text:("📄 **" + .file + "**" + (if (.by|length) > 0 then "\n\n↳ changed on main: " + (.by | join("; ")) else "" end))}))
      + (if .total > (.files|length) then [{type:"TextBlock", size:"Small", isSubtle:true, text:("+" + ((.total - (.files|length))|tostring) + " more files")}] else [] end)
      + [{type:"TextBlock", spacing:"Small", size:"Small", wrap:true, text:("Safe start:  `git switch " + .branch + " && git branch backup/" + .branch + " && git merge origin/main`")}])};
    {type:"message", attachments:[{contentType:"application/vnd.microsoft.card.adaptive",
      content:{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json", type:"AdaptiveCard", version:"1.4", msteams:{width:"Full"},
        body:(
          [
            {type:"Container", style:"accent", bleed:true, items:[{type:"ColumnSet", columns:[
              {type:"Column", width:"auto", verticalContentAlignment:"Center", items:[{type:"TextBlock", text:"⬡", size:"ExtraLarge", weight:"Bolder"}]},
              {type:"Column", width:"stretch", items:[
                {type:"TextBlock", text:"CONNECTUM  ·  MAIN UPDATED", size:"Small", weight:"Bolder", isSubtle:true},
                {type:"TextBlock", text:"Pull the latest before you continue", size:"Large", weight:"Bolder", spacing:"None", wrap:true},
                {type:"TextBlock", size:"Small", spacing:"None", wrap:true,
                 text:((if $actor != "" then "Pushed by [" + $actor + "](" + $actorUrl + ")  ·  " else "" end) + $when + "  ·  [`" + $sha + "`](" + $shaUrl + ")")}]}]}]},
            {type:"ColumnSet", spacing:"Medium", columns:[
              tile($total; "COMMITS"; "Accent"), tile($files; "FILES"; "Default"), tile("+" + $ins; "ADDED"; "Good"), tile("−" + $del; "REMOVED"; "Attention")]},
            {type:"TextBlock", spacing:"Medium", wrap:true, size:"Small", text:("**Areas** " + $areas)},
            {type:"TextBlock", wrap:true, size:"Small", spacing:"None", text:("**Contributors** " + $authors)},
            {type:"TextBlock", text:"WHAT CHANGED", size:"Small", weight:"Bolder", isSubtle:true, spacing:"Large", separator:true}
          ]
          + ($commits | map(commitBlock))
          + (if ($total | tonumber) > ($commits|length) then [{type:"TextBlock", isSubtle:true, wrap:true, size:"Small", text:("+" + ((($total | tonumber) - ($commits|length)) | tostring) + " earlier commits in this push, see the full list below.")}] else [] end)
          + [
            {type:"TextBlock", text:"UPDATE YOUR BRANCH", size:"Small", weight:"Bolder", isSubtle:true, separator:true, spacing:"Large"},
            cmd("git fetch origin"), cmd("git switch <your-branch>"), cmd("git branch backup/<your-branch>"), cmd("git merge origin/main"),
            {type:"TextBlock", wrap:true, size:"Small", isSubtle:true, text:"Merge, do not rebase: your commits stay exactly as they are. The backup branch is a full copy of your work from before the merge."},
            {type:"TextBlock", text:"BRANCH CHECK", size:"Small", weight:"Bolder", isSubtle:true, separator:true, spacing:"Large"},
            {type:"TextBlock", wrap:true, size:"Small",
             text:("Checked " + $checked + " active " + (if $checked == "1" then "branch" else "branches" end) + " (pushed in the last " + $days + " days, not yet merged): **" + (($clean|length)|tostring) + " clean**, **" + (($conflicts|length)|tostring) + " with conflicts**" + (if $errors != "0" then ", " + $errors + " could not be checked" else "" end) + (if $merged != "0" then ". Ignored " + $merged + " already-merged " + (if $merged == "1" then "branch" else "branches" end) + "." else "" end))}]
          + (if ($clean|length) > 0 then [{type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:("✅ **Clean:** " + ($clean | map("`" + .branch + "` (" + .owner + ")") | join(", ")))}] else [] end)
          + ($conflicts | .[0:$maxb] | map(conflictBlock))
          + (if ($conflicts|length) > $maxb then [{type:"TextBlock", size:"Small", wrap:true, spacing:"Small", text:("⚠️ **Also conflicting:** " + ($conflicts | .[$maxb:] | map("`" + .branch + "` (" + .owner + ", " + (.total|tostring) + (if .total == 1 then " file" else " files" end) + ")") | join(", ")))}] else [] end)
          + (if ($conflicts|length) > 0 then [
              {type:"TextBlock", text:"IF YOU GET CONFLICTS", size:"Small", weight:"Bolder", isSubtle:true, separator:true, spacing:"Large"},
              {type:"TextBlock", wrap:true, size:"Small", text:"1. Open each conflicted file. `<<<<<<<` to `=======` is YOUR version, `=======` to `>>>>>>>` is what is now on main. Keep both: main'"'"'s new code and your changes, edited so they work together."},
              {type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:"2. Do not resolve a whole file with `--ours` or `--theirs`, and do not `git reset --hard` or force-push: that silently throws away someone'"'"'s work. If unsure, ask the person named under the file."},
              {type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:"3. `git add <files>` then `git commit`, run the app, then push."},
              {type:"TextBlock", wrap:true, size:"Small", spacing:"Small", text:"4. Want out? `git merge --abort` returns you to exactly where you were. Your `backup/...` branch still holds everything."}] else [] end)
          + [{type:"TextBlock", wrap:true, size:"Small", isSubtle:true, spacing:"Medium", separator:true,
              text:"`docs/STATUS.md` is generated by a bot after each merge. Never edit it by hand; if it ever conflicts, take main'"'"'s copy: `git checkout origin/main -- docs/STATUS.md`."}]
        ),
        actions:[{type:"Action.OpenUrl", title:"View full changes", url:$compare},
                 {type:"Action.OpenUrl", title:"Project status page", url:$status},
                 {type:"Action.OpenUrl", title:"Open main", url:$mainUrl}]}}]}' > "$CARD_OUT"
}

# Teams rejects cards over ~28 KB: trim older commit blocks (down to 3) first, then conflict blocks, then commits.
MB=$MAX_BRANCHES; MC=$MAX_COMMITS
build "$MB" "$MC"
while [ "$(wc -c < "$CARD_OUT")" -gt 24000 ] && { [ "$MB" -gt 0 ] || [ "$MC" -gt 1 ]; }; do
  if [ "$MC" -gt 3 ]; then MC=$((MC - 1)); elif [ "$MB" -gt 0 ]; then MB=$((MB - 1)); else MC=$((MC - 1)); fi
  build "$MB" "$MC"
done
echo "wrote $CARD_OUT ($(wc -c < "$CARD_OUT") bytes, $MB conflict blocks, $MC commit blocks)"
