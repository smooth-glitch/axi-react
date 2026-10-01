# ⬡ Connectum · Live Status

> Auto-generated on every push to `main`. Do not edit by hand.
> Last updated: 01 Oct 2026, 18:01 IST · commit [`92e0e53`](https://github.com/smooth-glitch/axi-react/commit/92e0e53048cb4b5e7888f0cf853e7b72f4b690c3)

## New here? Start here

**Connectum** is the AXI chat platform: a React SPA frontend plus an Erlang/OTP real-time chat backend, in this one repo.

### Try the app

- **App:** <https://10.0.2.146> (reachable on the office network only)
- **Working remotely?** You need VPN access to reach it. New team members: contact **AXPERT SUPPORT** (on Teams) to get your VPN config.

### First steps

1. Read the [README](https://github.com/smooth-glitch/axi-react#readme), especially its *Start here, by role* table.
2. Skim the docs below, then clone the repo and follow the README's run instructions.
3. In the **Connectum dev group** on Teams, scroll up for the history of decisions. Ask whoever adds you to share chat history from the start.
4. Check [Recent changes](#recent-changes) to see what is moving right now, and [NEXT_STEPS](NEXT_STEPS.md) for what is planned.

### Who owns what

| Area | Owner |
|---|---|
| Erlang chat backend, DevOps | Arjun |
| Lite tstruct UI | Gunn |
| Rest of the UI and wiring it to the backend | Anish |

### Docs index

- [Redis backups on the VM](BACKUPS.md) · `docs/BACKUPS.md`
- [AXI Chat Backend — WebSocket Protocol](CHAT_PROTOCOL.md) · `docs/CHAT_PROTOCOL.md`
- [Connectum backend: frontend integration guide](CONNECTUM_FRONTEND_INTEGRATION.md) · `docs/CONNECTUM_FRONTEND_INTEGRATION.md`
- [Demo guide: set up Agile Labs from scratch, and the new admin features](DEMO_GUIDE.md) · `docs/DEMO_GUIDE.md`
- [Email (invitations and one-time codes)](EMAIL_SETUP.md) · `docs/EMAIL_SETUP.md`
- [Frontend hand-off: `#commands` changes](FRONTEND_HANDOFF_HASH_COMMANDS.md) · `docs/FRONTEND_HANDOFF_HASH_COMMANDS.md`
- [`#commands` — the chat prompt bar's action menu](HASH_COMMANDS.md) · `docs/HASH_COMMANDS.md`
- [Axpert Chat Plugin — Next Steps & Progress Tracker](NEXT_STEPS.md) · `docs/NEXT_STEPS.md`
- [Sandesh API — what the frontend builds against](SANDESH_API.md) · `docs/SANDESH_API.md`
- [AXI Chat Backend](../axi-chat-backend/README.md) · `axi-chat-backend/README.md`
- [Concurrency rules: nothing shared waits on Redis](../axi-chat-backend/docs/CONCURRENCY.md) · `axi-chat-backend/docs/CONCURRENCY.md`
- [Debugging & Handover Guide](../axi-chat-backend/docs/DEBUGGING.md) · `axi-chat-backend/docs/DEBUGGING.md`
- [Lite TStruct — how it works (backend owner's notes)](../axi-chat-backend/docs/LITE_TSTRUCT.md) · `axi-chat-backend/docs/LITE_TSTRUCT.md`
- [Login / Signup / Self-Register — integration steps (AxiChat backend)](../axi-chat-backend/docs/LOGIN_INTEGRATION.md) · `axi-chat-backend/docs/LOGIN_INTEGRATION.md`
- [Sandesh layer — backend notes](../axi-chat-backend/docs/SANDESH.md) · `axi-chat-backend/docs/SANDESH.md`

## Progress

`▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱` **0%** · 0 of 50 checklist items in [NEXT_STEPS](NEXT_STEPS.md) done

## Last 30 days

| Contributor | Commits |
|---|---|
| Arjun Sridhar | 77 |
| Anish-S-Agile | 36 |
| Arjun | 35 |
| Gunn | 26 |
| connectum-status-bot | 11 |
| Gunn Kataria | 1 |
| Backend Owner | 1 |

| Area | Files touched |
|---|---|
| Frontend | 233 |
| Other | 114 |
| Backend | 101 |
| CI / DevOps | 29 |
| Docs | 25 |
| Tests | 12 |

## Recent changes

| When | Who | Change | Diff |
|---|---|---|---|
| 01 Oct, 17:45 | Arjun Sridhar | [`3e95831`](https://github.com/smooth-glitch/axi-react/commit/3e9583121b62b9fdfe286bc010b1f1c882390f2b) feat(backend): durable mail queue, bigger accept queue (fixes the flaky connect burst), audit cap setting, docs | +325 / −35 |
| 01 Oct, 17:32 | connectum-status-bot | [`9f19559`](https://github.com/smooth-glitch/axi-react/commit/9f1955964031327cbd4d3d04b20d22b198f508a5) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 17:28 | connectum-status-bot | [`75bae4a`](https://github.com/smooth-glitch/axi-react/commit/75bae4aa65be9712220f4801918d93970592828d) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 17:22 | Arjun Sridhar | [`e473fd3`](https://github.com/smooth-glitch/axi-react/commit/e473fd337d76b3cef9bcdff20b7f74a593402db3) feat: honest invitation email, resend invite, mail retry, audit paging; page re-check header on the VM | +434 / −19 |
| 01 Oct, 17:09 | Arjun Sridhar | [`840cf45`](https://github.com/smooth-glitch/axi-react/commit/840cf451d27d327b75579b1f5b5a610266554c6c) feat(backend): hosts visible only to the people they are for, scoped DMs, complete submissions listing, profiles on connect | +393 / −46 |
| 01 Oct, 16:39 | connectum-status-bot | [`b0bf118`](https://github.com/smooth-glitch/axi-react/commit/b0bf11851cc54c6f3d12ced0ba6805223cc5af86) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 16:28 | Anish-S-Agile | [`7cc8a52`](https://github.com/smooth-glitch/axi-react/commit/7cc8a52f205caf76c700d93e9a0615280ecdbd9d) fix: update UI labels from Sandesh to Connectum in SandeshLoginScreen | +10 / −10 |
| 01 Oct, 16:24 | Anish-S-Agile | [`6a7cecb`](https://github.com/smooth-glitch/axi-react/commit/6a7cecb440b2235df7efb523e573cbaaab9c8d8f) Connectum Ui Updated | +10 / −27 |
| 01 Oct, 16:22 | Anish-S-Agile | [`bb15a76`](https://github.com/smooth-glitch/axi-react/commit/bb15a7601eade5652ca1b0d033789133bf7e7437) Connectum UI Updated | +72 / −72 |
| 01 Oct, 15:06 | connectum-status-bot | [`8974349`](https://github.com/smooth-glitch/axi-react/commit/897434998fef676a576c96bed7c2ac8e4192821e) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 14:34 | connectum-status-bot | [`e49a8aa`](https://github.com/smooth-glitch/axi-react/commit/e49a8aaf1bc2d0e1c14ed913782e92ee0320ec9c) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 14:27 | Arjun Sridhar | [`e8bd01b`](https://github.com/smooth-glitch/axi-react/commit/e8bd01bdce5ade61703fec919ac6c42c9e371120) docs: demo guide (set up from scratch, steps 1-7, and how to use the new admin features) | +90 / −0 |
| 01 Oct, 14:24 | Arjun Sridhar | [`dd42c36`](https://github.com/smooth-glitch/axi-react/commit/dd42c368126f7991fa654e98661348d448352194) docs: email setup guide; deploys can be run by hand (main only) | +58 / −0 |
| 01 Oct, 14:18 | connectum-status-bot | [`a71e89f`](https://github.com/smooth-glitch/axi-react/commit/a71e89fc5781df78dd12309f515d3eec0496cfe9) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 14:10 | Arjun Sridhar | [`1da41fc`](https://github.com/smooth-glitch/axi-react/commit/1da41fcab5dc16b6e8aaf1e74b5fcf0f8f8e5711) fix(frontend): hosts can open User Approvals (sign-ups are approved by the host who covers the person) | +35 / −30 |
| 01 Oct, 13:40 | Arjun Sridhar | [`f48c3cf`](https://github.com/smooth-glitch/axi-react/commit/f48c3cffb1d79c54852b5210932d334b95ea5313) feat(frontend): admin console wiring for reassignment, unlock screen, activity log, reporting manager on sign-up | +536 / −13 |
| 01 Oct, 13:27 | Arjun Sridhar | [`aad8748`](https://github.com/smooth-glitch/axi-react/commit/aad8748a0a604766259a9eb62e3a425862e81fa8) fix(backend): admin reassignment hardening, audit trail, bulk move, SMTP email | +829 / −101 |
| 01 Oct, 13:01 | Anish-S-Agile | [`a56c3e9`](https://github.com/smooth-glitch/axi-react/commit/a56c3e9186118c0755c5769ce69c0f54601101af) Green tick Updated | +135 / −14 |
| 01 Oct, 12:57 | connectum-status-bot | [`a9a5613`](https://github.com/smooth-glitch/axi-react/commit/a9a56137ce480b8ae3c0adef1574f930d01b04f7) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 12:50 | Arjun Sridhar | [`2cd669c`](https://github.com/smooth-glitch/axi-react/commit/2cd669c09835e53fdcac3cb7426dcabd66e6f12f) ci: automations bundle (deploy notifications, VM watchdog, PR checks, daily digest, branch housekeeping, secret scan, PR conflict warning, release notes, PR template) | +606 / −0 |
| 01 Oct, 12:44 | connectum-status-bot | [`fdb3085`](https://github.com/smooth-glitch/axi-react/commit/fdb30856a29f40967c7f89c1ba3b20c2e0ba0823) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 12:39 | Arjun Sridhar | [`fe13e11`](https://github.com/smooth-glitch/axi-react/commit/fe13e113c6ef58c430ac43a0979d1dd34ca994b3) docs: link the app and VPN instructions from the generated status page | +7 / −0 |
| 01 Oct, 12:35 | connectum-status-bot | [`0d23e7f`](https://github.com/smooth-glitch/axi-react/commit/0d23e7f033d6e57a04abf72a2a359fc9a8715db3) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 12:32 | Arjun Sridhar | [`e9d7da7`](https://github.com/smooth-glitch/axi-react/commit/e9d7da746300421ead4fc718ec40cac7b5aa7dea) ci: show Indian time (IST) on the Teams card and the status page | +4 / −4 |
| 01 Oct, 12:31 | connectum-status-bot | [`998b8ce`](https://github.com/smooth-glitch/axi-react/commit/998b8ce9f2d88c225b3ce76134d0c74c5a55ba84) docs: refresh STATUS.md [skip ci] | +0 / −0 |
