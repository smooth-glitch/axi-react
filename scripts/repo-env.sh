# Sourced by the helper scripts: works out WHICH repository (and GitHub server) we are in, so nothing is hard-coded and the
# repo can move to another owner/name/host without editing a single script.
#   REPO         owner/name            (override by exporting REPO)
#   SERVER       https://github.com    (or the Enterprise host)
#   REPO_URL     $SERVER/$REPO
#   DEFAULT_BRANCH  main               (override by exporting DEFAULT_BRANCH)
#   APP_ROOT     absolute path of this app's folder (the folder that contains scripts/)
#   APP_DIR      its path inside the repo ("" when the app is the repo root, "connectum" in the master repo)
#   APP_PREFIX   "$APP_DIR/" or ""  (git prints repo-root-relative paths; strip this to get app-relative ones)
# Inside GitHub Actions the standard variables win (GITHUB_REPOSITORY, GITHUB_SERVER_URL); elsewhere the `origin` remote is parsed.
APP_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
_top=$(git -C "$APP_ROOT" rev-parse --show-toplevel 2>/dev/null || echo "$APP_ROOT")
APP_DIR=${APP_ROOT#"$_top"}; APP_DIR=${APP_DIR#/}
APP_PREFIX=${APP_DIR:+$APP_DIR/}
_origin=$(git config --get remote.origin.url 2>/dev/null || true)
if [ -z "${REPO:-}" ]; then
  REPO=${GITHUB_REPOSITORY:-$(printf '%s' "$_origin" | sed -E 's#^(git@|ssh://git@|https?://)([^/:]+)[:/]##; s#\.git$##')}
fi
if [ -z "${SERVER:-}" ]; then
  if [ -n "${GITHUB_SERVER_URL:-}" ]; then SERVER=$GITHUB_SERVER_URL
  else
    _host=$(printf '%s' "$_origin" | sed -nE 's#^(git@|ssh://git@|https?://)([^/:]+)[:/].*#\2#p')
    SERVER=https://${_host:-github.com}
  fi
fi
REPO_URL=${REPO_URL:-$SERVER/$REPO}
DEFAULT_BRANCH=${DEFAULT_BRANCH:-main}
unset _origin _host _top
