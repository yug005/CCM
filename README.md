# UNO — Minimal, production-feel multiplayer

Clean, compact UNO: a dependency-light Node.js game server, a vanilla‑JS browser client, JSON-based auth, and a small admin UI. Live demo: https://ccm-xy1v.onrender.com/

🌐 Live demo — https://ccm-xy1v.onrender.com/
---

## Badges

![status](https://img.shields.io/badge/status-active-brightgreen) ![node](https://img.shields.io/badge/node-%3E%3D14-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## 🚀 Features

- Lightweight Node.js game server with deterministic turn logic
- Vanilla-JS browser client (no frameworks) for fast code review
- Simple JSON-based auth and persistence for quick demos
- Admin UI for monitoring and control ([admin/admin.html](admin/admin.html))
- Deployable to low-cost hosts (Render, Heroku, etc.)

## 🧠 How it works

- Server: [server.js](server.js) handles HTTP, WebSocket signaling, and orchestrates game lifecycle.
- Game rules & state: [gameLogic.js](gameLogic.js) implements deck, turn flow, card effects, and validation.
- Auth: [auth.js](auth.js) and [users.json](users.json) provide a tiny credential store and session handling.
- Client: `public/` serves the UI and client-side event sync; the admin UI lives under `admin/`.

Flow: client ↔ server WebSocket events → server updates game state in memory → server broadcasts authoritative state → clients render UI.

## 🛠️ Tech Stack

- Runtime: Node.js
- Transport: WebSockets + HTTP
## Badges

![status](https://img.shields.io/badge/status-active-brightgreen) ![node](https://img.shields.io/badge/node-%3E%3D14-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## 🚀 Key features

- Authoritative, single-process Node.js server with deterministic turn rules
- Minimal, framework-free browser client for easy code review and demos
- JSON-backed auth (`users.json`) for fast onboarding and reproducible demos
- Admin UI ([admin/admin.html](admin/admin.html)) for inspection and fault injection
- Fast to deploy on Render, Heroku, or any Node host

## 🧠 Architecture (high level)

- server (`server.js`): HTTP + WebSocket endpoints, session handling, game lifecycle management.
- rules (`gameLogic.js`): deck, effects, validation, and deterministic state transitions.
- auth (`auth.js` + `users.json`): credentials and minimal session store.
- client (`public/`): UI, local rendering, WebSocket client syncing with server.

Runtime flow: client emits user action → server validates via `gameLogic.js` → server mutates authoritative state → server broadcasts deltas → clients reconcile and render.

## 🛠️ Tech stack

- Node.js (server)
- WebSockets (real-time sync)
- Vanilla HTML/CSS/JS (client)
- File-backed JSON persistence for demo data

## 📂 Project layout

```
.
├─ admin/             # admin UI and helpers
├─ public/            # browser client
├─ auth.js            # tiny auth adapter
├─ gameLogic.js       # rules & state transitions
├─ server.js          # HTTP + WebSocket server
├─ users.json         # demo user store
├─ package.json
└─ README.md
```

## ⚙️ Quickstart

Install and run locally:

```bash
npm install
npm start
# then open http://localhost:3000/ and /admin
```

Notes:
- `users.json` is intentionally simple for demos — replace with a real DB for production.
- To change the port, set `PORT` before starting.

## ▶️ Demo flow

1. Seed or register a user in `users.json`.
2. Open the client, create or join a room, then play — all actions are server-authoritative.
3. Use the admin UI to view active games, force card effects, or simulate disconnects.

## 📈 Engineering highlights

- Single source of truth: server enforces all rules and resolves conflicts.
- Modular rules: `gameLogic.js` isolates game behavior for easy unit testing and review.
- Observable admin surface: admin tools expose runtime state for demos and debugging.
- Minimal surface area: no front-end frameworks or heavy dependencies — ideal for interviews and quick audits.

Scaling notes (practical next steps):

- Persist snapshots to durable storage to enable rejoin and recovery.
- Add a pub/sub layer to coordinate state across multiple server instances.
- Harden auth, rate-limit actions, and add telemetry for production readiness.

## 🚧 Roadmap

- [ ] Unit test suite for `gameLogic.js` (high priority)
- [ ] Pluggable persistence (SQLite/Postgres adapter)
- [ ] Reconnect/rejoin flow for interrupted games
- [ ] CI with automated demo deploys

## 🤝 Contributing

Small, focused PRs are preferred. When contributing:

- Add tests for behavioral changes
- Keep APIs stable and document config changes
- Explain rationale in the PR description

Steps:

1. Fork
2. Branch (feature/concise-name)
3. Open a PR

Feel free to contribute game variations and house rules. Prefer adding variations as isolated, opt-in modules (or a clearly-named folder like `variants/`) with:

- a short README describing the rule set,
- unit tests exercising deterministic outcomes in `gameLogic.js`, and
- a small demo or instructions for toggling the variant in the client/admin UI.

This keeps the core rules stable while letting the community experiment safely.

## 📜 License 

MIT — see `LICENSE`.

## 👤 Author

- GitHub: [yug005](https://github.com/yug005)

---
