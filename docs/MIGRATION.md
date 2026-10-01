# Moving the repo to the company GitHub

The repo is written to be location-independent: scripts derive owner/repo/server from
`scripts/repo-env.sh` (git remote or `GITHUB_REPOSITORY`), the backend service runs from
the stable path `/opt/axi/current` (re-pointed by every deploy), and nothing depends on a
paid action or license.

## What moves and what does not
| Item | Action |
|---|---|
| Code, history, branches, tags | `git push --mirror` to the new repo |
| Workflows (`.github/workflows`) | move with the repo, no edits needed |
| Secrets `TEAMS_WEBHOOK_URL`, `REDIS_PASSWORD` | re-create (secrets never export) |
| Self-hosted runner `axi-vm` | re-register against the new repo/org |
| Open PRs, issues | not carried by a mirror push; merge or re-open first |
| Teams webhook, VM, nginx, Redis | unchanged |

## Steps
1. **Freeze**: merge or close open PRs; let Deploy finish.
2. **Create** an empty repo in the company org (no README).
3. **Push everything**:
   `git remote add company <new-url> && git push company --mirror`
4. **Secrets**: `gh secret set TEAMS_WEBHOOK_URL -R <org/repo>` and the same for `REDIS_PASSWORD`
   (the value is in `/etc/axi-chat-backend.env` on the VM).
5. **Runner** (on the VM, token from Settings > Actions > Runners > New):
   `scripts/ops/move-runner.sh <repo-or-org-url> <token>`
   If the checkout folder name changes, nothing breaks: the next Deploy backend run
   re-points `/opt/axi/current`.
6. **Settings**: `scripts/gh-settings.sh` to audit, `--apply` to set read-only default token
   and branch protection. Org may need Actions enabled and allowed actions
   (`actions/*`, `erlef/setup-beam`).
7. **Verify**: run *Migration smoke test* (Actions tab). It checks secrets, runner, stable path
   and posts a Teams card. Then run *Deploy backend* manually.
8. **Repoint locals**: `git remote set-url origin <new-url>`; update `APP` links in any docs.
9. Archive the old repo and disable its workflows and runner registration so nothing
   runs twice.

## Gotchas
- `update-status.yml` pushes `docs/STATUS.md` to the default branch. With branch protection it
  only warns; allow `github-actions[bot]` to bypass if you want it updating.
- Scheduled workflows only run on the default branch, and GitHub pauses them after 60 days of
  repo inactivity.
- Enterprise orgs may restrict self-hosted runners per runner group: put `axi-vm` in a group
  that allows this repo.
- The VM reaches GitHub over the internet; the office VPN is only needed for users.
