#!/usr/bin/env bash
# Builds a Connectum-styled Teams card (accent header + lines of text + buttons) and,
# with --post, sends it to the Teams Workflows webhook in $WEBHOOK (no-op if unset).
#
# Input (env):
#   CARD_STYLE    accent (default) | good | attention | warning | emphasis   header colour
#   CARD_ICON     emoji next to the header (default ⬡)
#   CARD_KICKER   small caps line, e.g. "CONNECTUM · DEPLOY"
#   CARD_TITLE    big line
#   CARD_SUB      small line under the title (markdown ok)
#   CARD_BODY     one block per line; "## Heading" makes a section heading; blank lines are skipped
#   CARD_ACTIONS  one button per line as "Title|https://url"
#   CARD_OUT      output file (default card.json)
# Usage: scripts/teams-card.sh [--post]
set -euo pipefail
OUT=${CARD_OUT:-card.json}

jq -n \
  --arg style "${CARD_STYLE:-accent}" --arg icon "${CARD_ICON:-⬡}" --arg kicker "${CARD_KICKER:-CONNECTUM}" \
  --arg title "${CARD_TITLE:-}" --arg sub "${CARD_SUB:-}" --arg body "${CARD_BODY:-}" --arg actions "${CARD_ACTIONS:-}" '
  def line:
    if startswith("## ") then
      {type:"TextBlock", text:(.[3:] | ascii_upcase), size:"Small", weight:"Bolder", isSubtle:true, separator:true, spacing:"Large"}
    else
      {type:"TextBlock", text:., wrap:true, spacing:"Small"}
    end;
  {type:"message", attachments:[{contentType:"application/vnd.microsoft.card.adaptive",
    content:{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json", type:"AdaptiveCard", version:"1.4", msteams:{width:"Full"},
      body:(
        [{type:"Container", style:$style, bleed:true, items:[{type:"ColumnSet", columns:[
            {type:"Column", width:"auto", verticalContentAlignment:"Center", items:[{type:"TextBlock", text:$icon, size:"ExtraLarge", weight:"Bolder"}]},
            {type:"Column", width:"stretch", items:(
              [{type:"TextBlock", text:$kicker, size:"Small", weight:"Bolder", isSubtle:true},
               {type:"TextBlock", text:$title, size:"Large", weight:"Bolder", spacing:"None", wrap:true}]
              + (if $sub != "" then [{type:"TextBlock", text:$sub, size:"Small", spacing:"None", wrap:true}] else [] end))}]}]}]
        + ($body | split("\n") | map(select(length > 0)) | map(line))),
      actions:($actions | split("\n") | map(select(contains("|")) | split("|") | {type:"Action.OpenUrl", title:.[0], url:(.[1:] | join("|"))}))}}]}' > "$OUT"

# Teams rejects cards over ~28 KB.
SIZE=$(wc -c < "$OUT")
[ "$SIZE" -gt 27000 ] && { echo "card is $SIZE bytes, too large for Teams" >&2; exit 1; }

if [ "${1:-}" = "--post" ]; then
  if [ -z "${WEBHOOK:-}" ]; then echo "WEBHOOK not set; card built at $OUT but not posted"; exit 0; fi
  curl -sS -f --retry 3 --retry-delay 5 --max-time 30 -X POST -H 'Content-Type: application/json' -d @"$OUT" "$WEBHOOK"
  echo "posted ($SIZE bytes)"
else
  echo "wrote $OUT ($SIZE bytes)"
fi
