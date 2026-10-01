#!/usr/bin/env bash
# Apply (or audit) the repo settings the automations rely on, in whatever repo
# the current checkout points at.  Usage: scripts/gh-settings.sh [--apply]
# Needs `gh` logged in with admin rights on the target repo.
set -euo pipefail
. "$(dirname "$0")/repo-env.sh"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
say() { printf '%s\n' "$*"; }

say "Repo: $REPO  (default branch: $DEFAULT_BRANCH)"

say; say "Secrets (set with: gh secret set NAME -R $REPO)"
have=$(gh secret list -R "$REPO" --json name -q '.[].name' 2>/dev/null || true)
for s in TEAMS_WEBHOOK_URL REDIS_PASSWORD; do
  if printf '%s\n' "$have" | grep -qx "$s"; then say "  ok       $s"; else say "  MISSING  $s"; fi
done

say; say "Self-hosted runner"
gh api "repos/$REPO/actions/runners" -q '.runners[] | "  \(.name)  \(.status)  \(.labels|map(.name)|join(","))"' 2>/dev/null \
  || say "  (cannot list runners; check admin rights)"

say; say "Workflow permissions"
if [ $APPLY = 1 ]; then
  gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
    -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
  say "  default token = read-only (workflows request what they need)"
else
  gh api "repos/$REPO/actions/permissions/workflow" -q '"  default=\(.default_workflow_permissions)"' || true
fi

say; say "Branch protection on $DEFAULT_BRANCH"
if [ $APPLY = 1 ]; then
  gh api -X PUT "repos/$REPO/branches/$DEFAULT_BRANCH/protection" --input - >/dev/null <<JSON
{"required_status_checks":null,"enforce_admins":false,
 "required_pull_request_reviews":{"required_approving_review_count":0},
 "restrictions":null,"allow_force_pushes":false,"allow_deletions":false}
JSON
  say "  applied: PR required, no force push/delete."
  say "  NOTE: update-status.yml pushes STATUS.md straight to $DEFAULT_BRANCH; if org rules block that"
  say "  the workflow only warns. Allow github-actions[bot] to bypass, or accept the warning."
else
  gh api "repos/$REPO/branches/$DEFAULT_BRANCH/protection" -q '"  protected, PR reviews required: \(.required_pull_request_reviews != null)"' 2>/dev/null || say "  not protected"
fi
say; say "Re-run with --apply to change settings."
