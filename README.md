# 🎴 Color Clash — Multiplayer

Color Clash is a polished, real-time multiplayer card game that blends classic color-and-action mechanics with a modern, mobile-first UI. Built with Node.js and Socket.IO, it’s easy to self-host and fun to play with friends (2–6 players).

Live demo: https://ccm-xy1v.onrender.com/

---

🌟 Highlights

- Server-authoritative gameplay to prevent desync and cheating
- Lightweight frontend (vanilla JS) that works great on mobile and desktop
- Quick room-based matchmaking using short room codes
- Optional accounts and persistent stats (Postgres or file fallback)

---

## Features

- Real-time multiplayer with Socket.IO
# 🎴 Color Clash — Multiplayer

This repo contains a small, real-time multiplayer card game. It uses short room codes so you can quickly play with friends (2–6 players). The server enforces rules; the frontend is plain JavaScript and mobile-friendly.

Why this project?

- Quick to run locally. Great demo for realtime systems and Socket.IO.
- Server-authoritative game state — less cheating, fewer sync bugs.
- Optional user accounts and persistent stats when needed.

Quick demo tip: add a short GIF to `public/assets/demo.gif` and link it here.

Getting started (local)

```bash
npm install
npm start
# then open http://localhost:3000
```

For development:

```bash
npm run dev
```

Auth and persistence

By default the server stores users in `users.json`. To use Postgres, set `DATABASE_URL` before the first run. The server will create the `users` table automatically.

Recommended env vars:

```bash
DATABASE_URL="postgres://user:pass@host:5432/dbname"
JWT_SECRET="a-secure-secret"
ADMIN_TOKEN="optional-admin-token"
```

Note: switching to Postgres does not migrate `users.json`. Ask me to add a one-time import script if you want to keep existing accounts.

Deploy checklist

1. Commit & push your changes:

```bash
git add -A
git commit -m "Add optional auth and polish"
git push
```

2. On the server: `git pull && npm install --production`, set env vars, then restart your process manager.

3. Smoke test: register, login, play a match, and confirm stats via `/api/me`.

How to play (short)

1. Enter a name and create a room.
2. Share the room code with friends and wait in the lobby.
3. Start the game and play like usual — call `CLASH!` when you're down to one card.

Variation ideas (open to collaboration)

If you want to collaborate I’m happy to help. A few ideas:

- Ranked mode + leaderboards
- Fast mode with short timers
- Team mode (2v2)
- Draft/pick modes or custom card packs

If any of those sound interesting, I can prototype them and add UI toggles.

Developer notes — socket events

Client → Server: `createRoom`, `joinRoom`, `startGame`, `playCard`, `drawCard`, `playAgain`, `callClash`, `challengeCall`

Server → Client: `roomCreated`, `roomJoined`, `gameState`, `playerHand`, `gameStarted`, `cardPlayed`, `cardsDrawn`, `playerSafe`, `gameOver`, `error`

Project layout

```
.
├─ server.js        # server + Socket.IO
├─ gameLogic.js     # game rules + state
├─ public/          # frontend
└─ auth.js          # optional auth (pg or file fallback)
```

Want me to:

- add a demo GIF placeholder and wire it into the README, or
- create a one-time `scripts/import-users.js` to migrate `users.json` into Postgres

Tell me which and I’ll add it next.
### Game Variations (Configurable)
- ⚙️ Stack +2/+4 cards
- ⚙️ 7-0 Rule (swap/rotate hands)
- ⚙️ Turn timer (optional)

## 🚀 Quick Start

### Prerequisites
- Node.js 14+ installed
- npm or yarn

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Open your browser:**
   ```
   http://localhost:3000
   ```

### Development Mode
```bash
npm run dev
```
Uses nodemon for auto-reload on file changes.

## 📖 How to Play

### Creating a Game
1. Enter your name
2. Click "Create Room"
3. Share the 6-digit room code with friends
4. Wait for players to join
5. Click "Start Game" when ready

### Joining a Game
1. Enter your name
2. Enter the 6-digit room code
3. Click "Join Room"
4. Wait for the host to start

### Playing Cards
- **On your turn:** Click a playable card (highlighted)
- **Wild cards:** Choose a color after clicking
- **Can't play?** Click "Draw Card"
- **One card left?** Click "Call CLASH!" or risk penalty

### Winning
- **Players finish:** When you play your last card, you're safe! ✅
- **Game continues:** Remaining players keep playing
- **Last player standing:** The final player with cards is the loser 😅

### Environment Variables (Optional)
```bash
PORT=3000  # Server port (automatically set by most platforms)
```

### Optional: Postgres-backed Auth & Stats

- This project supports an optional Postgres database for user accounts and persistent stats. If `DATABASE_URL` is not set, the server will continue using a file-backed `users.json` store (no DB required).

- To enable Postgres persistence, set `DATABASE_URL` in your environment BEFORE first start. The server will automatically create a `users` table if needed.

- Important: enabling Postgres does NOT automatically migrate existing `users.json`. If you have existing users you want to keep, either:
   - Keep using the file-backed store (do not set `DATABASE_URL`), or
   - Export/import users.json into Postgres (see migration notes below).

Required production env vars when enabling DB or auth features:
```bash
DATABASE_URL=postgres://user:pass@host:5432/dbname
JWT_SECRET=some_long_random_secret
ADMIN_TOKEN=optional_admin_token
```

Deployment checklist when using Postgres:
- Add the env vars above in your hosting provider (Render, Railway, Heroku, Docker, etc.).
- Deploy the code (commit & push) and restart the service. On first run the `users` table will be created automatically.

Migration note (optional):
- If you want to migrate `users.json` into Postgres, I can add a one-time import script that reads `users.json` and inserts rows into the `users` table while preserving password hashes. Without doing that, existing users remain only in `users.json` and are not visible to the DB-backed mode.

## 🔁 Deploy Steps (quick)

1) Commit & push your changes:
```bash
git add -A
git commit -m "Optional auth + DB support and UI fixes"
git push origin main
```

2) On your production host, pull & install:
```bash
git pull
npm install --production
```

3) Ensure required env vars are set (see above), then restart your process manager (systemd, pm2, Docker container, etc.).

4) Verify logs and test register/login flow and a completed match to see stats increment.


## 📁 Project Structure

```
/
├── server.js              # Main server with Socket.IO
├── gameLogic.js           # Game rules and state management
├── package.json           # Dependencies and scripts
├── public/
│   ├── index.html         # Frontend UI
│   ├── css/
│   │   └── styles.css     # Responsive styling
│   └── js/
│       └── client.js      # Socket.IO client logic
└── README.md              # This file
```

## 🎮 Game Architecture

### Server (Node.js + Socket.IO)
- Room management (create/join/leave)
- Game state synchronization
- Turn validation
- Card play validation
- Event broadcasting

### Game Logic (gameLogic.js)
- Deck initialization and shuffling
- Card dealing
- Turn management
- Rule enforcement
- Win/lose detection

### Client (Vanilla JS)
- Socket.IO connection
- Real-time UI updates
- Card rendering
- Player interaction
- Notifications

## 🔧 Technical Details

### Socket.IO Events

**Client → Server:**
- `createRoom` - Create new game room
- `joinRoom` - Join existing room
- `startGame` - Start the game
- `playAgain` - Vote for rematch (starts when all players vote)
- `playCard` - Play a card
- `drawCard` - Draw from deck
- `callClash` - Call CLASH
- `challengeCall` - Challenge missed call

**Server → Client:**
- `roomCreated` - Room creation confirmation
- `roomJoined` - Join confirmation
- `gameState` - Full game state update
- `playerHand` - Player's cards (private)
- `gameStarted` - Game has begun
- `roundRestarted` - New round started in same room
- `cardPlayed` - Card was played
- `cardsDrawn` - Cards were drawn (count included)
- `rematchVoteUpdate` - Rematch vote count update
- `playerSafe` - Player finished their cards
- `gameOver` - Game ended
- `error` - Error message

## 📜 License

This repository is licensed under the MIT License (see LICENSE).

### Game State Schema
```javascript
{
  roomCode: String,
  hasStarted: Boolean,
  isGameOver: Boolean,
  loser: { id, name },
  currentPlayerId: String,
  currentColor: String,
  direction: Number,  // 1 or -1
  topCard: Card,
  deckSize: Number,
  players: [
    {
      id: String,
      name: String,
      cardCount: Number,
      isSafe: Boolean,
      hasCalledClash: Boolean
    }
  ],
  safePlayers: [{ id, name }],
  settings: { ... }
}
```

## 🎨 Customization

### Adding New Card Types
1. Modify `initializeDeck()` in [gameLogic.js](gameLogic.js)
2. Add card effect in `handleCardEffect()`
3. Update card rendering in [client.js](public/js/client.js)

### Changing Colors
Edit CSS variables in [styles.css](public/css/styles.css):
```css
:root {
  --color-red: #e74c3c;
  --color-blue: #3498db;
  --color-green: #2ecc71;
  --color-yellow: #f39c12;
}
```

### Adding Game Variations
1. Add setting to game constructor in [gameLogic.js](gameLogic.js)
2. Add checkbox in [index.html](public/index.html)
3. Implement logic in `handleCardEffect()`

## 🐛 Known Issues & Limitations

- **In-memory storage:** Games reset on server restart
- **No persistence:** No user accounts or game history
- **Small scale:** Designed for friend groups, not massive multiplayer
- **Limited variations:** Some house rules not yet implemented

## 🚧 Future Enhancements

- [ ] Game replay system
- [ ] Spectator mode
- [ ] Chat functionality
- [ ] Sound effects and animations
- [ ] Progressive Web App (PWA)
- [ ] Database persistence
- [ ] User accounts and stats
- [ ] Switch mode
- [ ] Tournament brackets

## 📝 License

MIT License - feel free to use and modify!

## 🤝 Contributing

Found a bug? Want to add a feature? Pull requests welcome!

## 🎉 Have Fun!

Enjoy playing with your friends! Share your feedback and suggestions.

---

**Built with ❤️ using Node.js, Socket.IO, and JavaScript**
