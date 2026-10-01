# ⬡ Connectum · Live Status

> Auto-generated on every push to `main`. Do not edit by hand.
> Last updated: 01 Oct 2026, 12:44 IST · commit [`f13353c`](https://github.com/smooth-glitch/axi-react/commit/f13353cc40740de08fead52ab4c1d13504b07f6f)

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
| Arjun Sridhar | 68 |
| Arjun | 35 |
| Anish-S-Agile | 27 |
| Gunn | 26 |
| connectum-status-bot | 3 |
| Gunn Kataria | 1 |
| Backend Owner | 1 |

| Area | Files touched |
|---|---|
| Frontend | 231 |
| Other | 114 |
| Backend | 93 |
| Docs | 22 |
| CI / DevOps | 15 |
| Tests | 11 |

## Recent changes

| When | Who | Change | Diff |
|---|---|---|---|
| 01 Oct, 12:39 | Arjun Sridhar | [`fe13e11`](https://github.com/smooth-glitch/axi-react/commit/fe13e113c6ef58c430ac43a0979d1dd34ca994b3) docs: link the app and VPN instructions from the generated status page | +7 / −0 |
| 01 Oct, 12:35 | connectum-status-bot | [`0d23e7f`](https://github.com/smooth-glitch/axi-react/commit/0d23e7f033d6e57a04abf72a2a359fc9a8715db3) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 12:32 | Arjun Sridhar | [`e9d7da7`](https://github.com/smooth-glitch/axi-react/commit/e9d7da746300421ead4fc718ec40cac7b5aa7dea) ci: show Indian time (IST) on the Teams card and the status page | +4 / −4 |
| 01 Oct, 12:31 | connectum-status-bot | [`998b8ce`](https://github.com/smooth-glitch/axi-react/commit/998b8ce9f2d88c225b3ce76134d0c74c5a55ba84) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 12:28 | Arjun Sridhar | [`24faec4`](https://github.com/smooth-glitch/axi-react/commit/24faec474791299fc00e92d23d8fb7ebc191e384) ci: one Teams card per merge to main; ignore already-merged branches; protect generated STATUS.md | +194 / −244 |
| 01 Oct, 12:24 | Arjun Sridhar | [`88325fb`](https://github.com/smooth-glitch/axi-react/commit/88325fb353324874af3d12dac8a5530e40689c5c) ci: on every merge to main, post a pull reminder with a per-branch conflict forecast and safe-resolution steps to Teams | +173 / −0 |
| 01 Oct, 12:22 | connectum-status-bot | [`9e30d9a`](https://github.com/smooth-glitch/axi-react/commit/9e30d9a968b925bf1c8d52757f1d4adac5f8dc7d) docs: refresh STATUS.md [skip ci] | +0 / −0 |
| 01 Oct, 12:20 | Arjun Sridhar | [`2dc93a1`](https://github.com/smooth-glitch/axi-react/commit/2dc93a143dfe3c2ccdce474841203277284ce5e7) ci: STATUS.md doubles as a new-developer onboarding page (start-here steps, owners, docs index) | +27 / −0 |
| 01 Oct, 12:17 | Arjun Sridhar | [`2c28026`](https://github.com/smooth-glitch/axi-react/commit/2c28026d7c014587b6e71f3b8150a18c52611b50) ci: Teams status card and self-updating STATUS.md, both on push to main | +252 / −0 |
| 01 Oct, 10:45 | Anish-S-Agile | [`62e8331`](https://github.com/smooth-glitch/axi-react/commit/62e8331e6c7b69738f068503094456492b8bd171) Docs Readable + Ui polish | +1923 / −473 |
| 30 Sep, 21:48 | Arjun Sridhar | [`1d284a8`](https://github.com/smooth-glitch/axi-react/commit/1d284a857f32cd6059d6517a3e50ab2c29b4be98) feat(backend): Connectum backend (codes/QR, wizards, data sources, payments, custom # commands, chat edit) (#86) | +5181 / −107 |
| 30 Sep, 18:32 | Arjun Sridhar | [`2a267e9`](https://github.com/smooth-glitch/axi-react/commit/2a267e9ed16af3da7d63c1e4fe95b7c4a19857bf) UI cleanup: remove the '#' hint, the green sync dot and the 'Live Sync' pill (#85) | +8 / −31 |
| 30 Sep, 17:54 | Gunn | [`cd67a90`](https://github.com/smooth-glitch/axi-react/commit/cd67a9040c87bae8e020e1461cddf6ec10248a1b) feat: Smart Prompts category list opens as an upward dropdown from the pill | +297 / −187 |
| 30 Sep, 17:35 | Gunn | [`7339f92`](https://github.com/smooth-glitch/axi-react/commit/7339f924f392fa202422b4124300d9b6c3c485b6) feat: Smart Prompts by category -- pills with counts + paged, searchable category popup | +217 / −14 |
| 30 Sep, 17:26 | Arjun Sridhar | [`4813eca`](https://github.com/smooth-glitch/axi-react/commit/4813eca7baef1b41fb9a3fd7a66a2b83484c6768) fix: shared chat servers never wait on Redis -- a Redis stall no longer crashes chat_room / chat_groups (#80) | +420 / −134 |
| 30 Sep, 17:26 | Arjun Sridhar | [`3bcf63d`](https://github.com/smooth-glitch/axi-react/commit/3bcf63d92498b280d94c5e58cd5ddeff116241e3) feat: Smart Prompts by category -- options.categories (pills + counts) and paged, searchable options.list (#81) | +398 / −6 |
| 30 Sep, 17:18 | Anish-S-Agile | [`38a5dd4`](https://github.com/smooth-glitch/axi-react/commit/38a5dd486d319afe4f20f13039c24627e16eceb0) Upload option UI Polish | +481 / −21 |
| 30 Sep, 16:14 | Arjun Sridhar | [`b102393`](https://github.com/smooth-glitch/axi-react/commit/b102393523dc2674775982af1eccd20afef7f5ed) chore: stop tracking dist/ (build output); CI builds it before every deploy (#79) | +5 / −48775 |
| 30 Sep, 16:04 | Arjun Sridhar | [`2c3db5a`](https://github.com/smooth-glitch/axi-react/commit/2c3db5a678b5fec933720a0d804d876e51538b18) fix: #notifications opens the notification panel; #remind confirms with a toast | +8 / −0 |
| 30 Sep, 16:03 | Arjun Sridhar | [`abc4f0f`](https://github.com/smooth-glitch/axi-react/commit/abc4f0f69093b2853a879dcbbc9c31a705f7ba9b) fix: associates list showed blank names (server sends {online, relation, user:{...}}); normalise once | +13 / −3 |
| 30 Sep, 15:58 | Arjun Sridhar | [`ca66964`](https://github.com/smooth-glitch/axi-react/commit/ca669648f1f71d94358cd1b525bb52c2af321176) fix: #connect toast said 'Connected with @user' for what is a pending invitation; composer ignores late suggestion replies after send | +11 / −1 |
| 30 Sep, 15:56 | Arjun Sridhar | [`a8413f5`](https://github.com/smooth-glitch/axi-react/commit/a8413f502d5d39ba5938d28cc85248edc2560021) fix: # commands were sent to the server twice (raw line + explicit call): duplicate errors, double history loads | +17 / −18 |
| 30 Sep, 15:54 | Arjun Sridhar | [`1ac1835`](https://github.com/smooth-glitch/axi-react/commit/1ac183594f1f94e79977b3813c87a7ecf494906f) fix: groups appear only when the server confirms (group_created); no optimistic 'created' toast | +9 / −40 |
| 30 Sep, 15:53 | Arjun Sridhar | [`adc738c`](https://github.com/smooth-glitch/axi-react/commit/adc738cd04fa157a3ad49a634491440f9270ec02) fix(composer): clear stale argument suggestions when the text changes (Enter chose a leftover item from a previous command) | +9 / −7 |
| 30 Sep, 15:49 | Arjun Sridhar | [`29151ab`](https://github.com/smooth-glitch/axi-react/commit/29151abd697b1029a2d24060f1ab1851a1cf78b8) fix: restore notifications, tstruct and tstruct-add in the # menu whitelist (dropped by a UI polish commit) | +2 / −1 |
