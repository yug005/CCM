const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const Game = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Admin token for developer-only controls (optional)
// Set on Render as an env var: ADMIN_TOKEN=some-long-secret
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();

function isAdminTokenValid(token) {
  if (!ADMIN_TOKEN) return false;
  if (!token || typeof token !== 'string') return false;
  return token.trim() === ADMIN_TOKEN;
}

function adminHttpGuard(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(404).send('Not found');
  const token = (req.query && req.query.token) || req.get('x-admin-token');
  if (!isAdminTokenValid(token)) return res.status(403).send('Forbidden');
  return next();
}

// Developer dashboard (served only when ADMIN_TOKEN is configured)
app.get('/admin', adminHttpGuard, (req, res) => {
  const token = (req.query && req.query.token) || '';
  const htmlPath = path.join(__dirname, 'admin', 'admin.html');
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(html.replaceAll('__ADMIN_TOKEN__', String(token)));
  } catch (e) {
    res.status(500).send('Admin UI failed to load');
  }
});
app.get('/admin/admin.js', adminHttpGuard, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.js'));
});
app.get('/admin/admin.css', adminHttpGuard, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.css'));
});

// Serve static files (game UI)
app.use(express.static('public'));

// In-memory storage
const rooms = new Map(); // roomCode -> Game instance
const players = new Map(); // socketId -> { roomCode, playerName }

function getAdminSnapshot() {
  const list = [];
  for (const [roomCode, game] of rooms.entries()) {
    const state = game.getGameState();
    list.push({
      roomCode,
      hostId: state.hostId || game.hostId || (game.players.length > 0 ? game.players[0].id : null),
      lobbyLocked: !!state.lobbyLocked,
      hasStarted: !!state.hasStarted,
      isGameOver: !!state.isGameOver,
      settings: state.settings || {},
      players: (state.players || []).map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        cardCount: p.cardCount,
        isSafe: p.isSafe,
        wins: p.wins
      }))
    });
  }

  // Stable order
  list.sort((a, b) => a.roomCode.localeCompare(b.roomCode));
  return { rooms: list, totalRooms: list.length };
}

let adminBroadcastScheduled = false;
function scheduleAdminBroadcast() {
  if (!ADMIN_TOKEN) return;
  if (adminBroadcastScheduled) return;
  adminBroadcastScheduled = true;
  setTimeout(() => {
    adminBroadcastScheduled = false;
    try {
      adminNamespace.emit('roomsList', getAdminSnapshot());
    } catch (_) {
      // ignore
    }
  }, 200);
}

function kickFromRoom({ roomCode, playerId, message, by }) {
  const game = rooms.get(roomCode);
  if (!game) return { ok: false, error: 'Room not found' };

  const target = game.players.find(p => p.id === playerId);
  if (!target) return { ok: false, error: 'Player not found' };

  // Remove from authoritative state
  game.removePlayer(playerId);
  if (game.rematchVotes instanceof Set) {
    game.rematchVotes.delete(playerId);
    io.to(roomCode).emit('rematchVoteUpdate', {
      votes: game.rematchVotes.size,
      total: game.players.length
    });
  }

  // Notify + disconnect target
  const targetSocket = io.sockets.sockets.get(playerId);
  if (targetSocket) {
    targetSocket.emit('kicked', {
      message: message || 'You were removed by an admin'
    });
    targetSocket.leave(roomCode);
    setTimeout(() => {
      try {
        targetSocket.disconnect(true);
      } catch (_) {
        // ignore
      }
    }, 100);
  }

  // Update player mapping
  players.delete(playerId);

  if (game.players.length === 0) {
    rooms.delete(roomCode);
  } else {
    io.to(roomCode).emit('playerLeft', {
      playerId,
      playerName: target.name,
      reason: by || 'kicked'
    });
    io.to(roomCode).emit('gameState', game.getGameState());
  }

  scheduleAdminBroadcast();
  return { ok: true };
}

// Admin Socket.IO namespace (developer-only)
const adminNamespace = io.of('/admin');
adminNamespace.use((socket, next) => {
  if (!ADMIN_TOKEN) return next(new Error('Admin disabled'));
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!isAdminTokenValid(token)) return next(new Error('Unauthorized'));
  return next();
});

adminNamespace.on('connection', (socket) => {
  socket.emit('roomsList', getAdminSnapshot());

  socket.on('listRooms', () => {
    socket.emit('roomsList', getAdminSnapshot());
  });

  socket.on('kickPlayer', ({ playerId, message }) => {
    if (!playerId || typeof playerId !== 'string') return;

    const mapping = players.get(playerId);
    const roomCode = mapping && mapping.roomCode;
    if (!roomCode) {
      socket.emit('adminError', { message: 'Player not found (no room mapping)' });
      return;
    }

    const result = kickFromRoom({ roomCode, playerId, message, by: 'admin' });
    if (!result.ok) {
      socket.emit('adminError', { message: result.error || 'Kick failed' });
    }
  });
});

// Generate random room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  function isHost(game) {
    return !!game && !!game.hostId && game.hostId === socket.id;
  }

  function ensureHost(game, roomCodeForError) {
    if (!game || !isHost(game)) {
      socket.emit('gameError', { message: 'Only the host can do that' });
      if (roomCodeForError) {
        console.warn(`Non-host attempted host action in room ${roomCodeForError}:`, socket.id);
      }
      return false;
    }
    return true;
  }

  function reassignHostIfNeeded(game) {
    if (!game) return;
    const currentHostId = game.hostId || (game.players.length > 0 ? game.players[0].id : null);
    const hostStillPresent = !!currentHostId && game.players.some(p => p.id === currentHostId);
    if (!hostStillPresent) {
      game.hostId = game.players.length > 0 ? game.players[0].id : null;
    }
  }

  // Create a new room
  socket.on('createRoom', ({ playerName, settings }) => {
    const roomCode = generateRoomCode();
    const game = new Game(roomCode, settings);

    // Host/lobby controls
    game.hostId = socket.id;
    game.lobbyLocked = false;
    game.bannedNames = new Set();
    
    // Rematch voting state (server-side only)
    game.rematchVotes = new Set();
    
    rooms.set(roomCode, game);
    players.set(socket.id, { roomCode, playerName });
    
    socket.join(roomCode);
    game.addPlayer(socket.id, playerName);
    
    socket.emit('roomCreated', { 
      roomCode, 
      playerId: socket.id,
      playerName 
    });
    
    io.to(roomCode).emit('gameState', game.getGameState());
    scheduleAdminBroadcast();
    console.log(`Room ${roomCode} created by ${playerName}`);
  });

  // Join existing room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const game = rooms.get(roomCode);
    
    if (!game) {
      socket.emit('gameError', { message: 'Room not found' });
      return;
    }
    
    if (game.hasStarted) {
      socket.emit('gameError', { message: 'Game already started' });
      return;
    }

    if (game.lobbyLocked) {
      socket.emit('gameError', { message: 'Lobby is locked by the host' });
      return;
    }

    // Simple per-room ban list (by name, case-insensitive)
    const normalizedName = (playerName || '').trim().toLowerCase();
    if (normalizedName && game.bannedNames instanceof Set && game.bannedNames.has(normalizedName)) {
      socket.emit('gameError', { message: 'You are not allowed to join this room' });
      return;
    }
    
    if (game.players.length >= 6) {
      socket.emit('gameError', { message: 'Room is full' });
      return;
    }
    
    players.set(socket.id, { roomCode, playerName });
    socket.join(roomCode);
    game.addPlayer(socket.id, playerName);

    // Ensure host exists (in case of older rooms)
    if (!game.hostId) {
      game.hostId = game.players.length > 0 ? game.players[0].id : socket.id;
    }
    
    socket.emit('roomJoined', { 
      roomCode, 
      playerId: socket.id,
      playerName 
    });
    
    io.to(roomCode).emit('gameState', game.getGameState());

    scheduleAdminBroadcast();

    if (game.rematchVotes instanceof Set) {
      io.to(roomCode).emit('rematchVoteUpdate', {
        votes: game.rematchVotes.size,
        total: game.players.length
      });
    }
    console.log(`${playerName} joined room ${roomCode}`);
  });

  // Start game
  socket.on('startGame', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;

    if (!ensureHost(game, playerData.roomCode)) return;
    
    if (game.players.length < 2) {
      socket.emit('gameError', { message: 'Need at least 2 players to start' });
      return;
    }
    
    try {
      game.startGame();

      // Clear any rematch votes when a round starts
      if (game.rematchVotes instanceof Set) {
        game.rematchVotes.clear();
        io.to(playerData.roomCode).emit('rematchVoteUpdate', {
          votes: 0,
          total: game.players.length
        });
      }
      io.to(playerData.roomCode).emit('gameStarted');
      io.to(playerData.roomCode).emit('gameState', game.getGameState());
      scheduleAdminBroadcast();
      
      // Send initial hands to all players
      game.players.forEach(player => {
        io.to(player.id).emit('playerHand', game.getPlayerHand(player.id));
      });
      
      console.log(`Game started in room ${playerData.roomCode}`);
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Host: lock/unlock lobby
  socket.on('setLobbyLock', ({ locked }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;

    const game = rooms.get(playerData.roomCode);
    if (!game) return;

    if (!ensureHost(game, playerData.roomCode)) return;

    if (game.hasStarted) {
      socket.emit('gameError', { message: 'Cannot lock/unlock after the game starts' });
      return;
    }

    game.lobbyLocked = !!locked;
    io.to(playerData.roomCode).emit('gameState', game.getGameState());
  });

  // Host: kick a player from the room
  socket.on('kickPlayer', ({ playerId }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;

    const game = rooms.get(playerData.roomCode);
    if (!game) return;

    if (!ensureHost(game, playerData.roomCode)) return;

    if (!playerId || typeof playerId !== 'string') return;
    if (playerId === game.hostId) {
      socket.emit('gameError', { message: 'Host cannot kick themselves' });
      return;
    }

    const target = game.players.find(p => p.id === playerId);
    if (!target) {
      socket.emit('gameError', { message: 'Player not found' });
      return;
    }

    // Remove from server state first (authoritative)
    game.removePlayer(playerId);
    if (game.rematchVotes instanceof Set) {
      game.rematchVotes.delete(playerId);
      io.to(playerData.roomCode).emit('rematchVoteUpdate', {
        votes: game.rematchVotes.size,
        total: game.players.length
      });
    }

    players.delete(playerId);
    reassignHostIfNeeded(game);

    // Notify target client and disconnect them
    const targetSocket = io.sockets.sockets.get(playerId);
    if (targetSocket) {
      targetSocket.emit('kicked', { message: 'You were removed by the host' });
      targetSocket.leave(playerData.roomCode);
      setTimeout(() => {
        try {
          targetSocket.disconnect(true);
        } catch (_) {
          // ignore
        }
      }, 100);
    }

    io.to(playerData.roomCode).emit('playerLeft', {
      playerId,
      playerName: target.name
    });
    io.to(playerData.roomCode).emit('gameState', game.getGameState());
  });

  // Rematch / play again (keep same room)
  socket.on('playAgain', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;

    const game = rooms.get(playerData.roomCode);
    if (!game) return;

    if (!game.isGameOver) {
      socket.emit('gameError', { message: 'You can vote for rematch only after game over' });
      return;
    }

    if (!(game.rematchVotes instanceof Set)) {
      game.rematchVotes = new Set();
    }

    game.rematchVotes.add(socket.id);
    io.to(playerData.roomCode).emit('rematchVoteUpdate', {
      votes: game.rematchVotes.size,
      total: game.players.length
    });

    if (game.players.length < 2) {
      socket.emit('gameError', { message: 'Need at least 2 players to play again' });
      return;
    }

    // Start rematch only when ALL current players vote yes.
    const allVoted = game.players.every(p => game.rematchVotes.has(p.id));
    if (!allVoted) return;

    try {
      game.restartRound();

      game.rematchVotes.clear();

      io.to(playerData.roomCode).emit('roundRestarted');
      io.to(playerData.roomCode).emit('rematchVoteUpdate', {
        votes: 0,
        total: game.players.length
      });
      io.to(playerData.roomCode).emit('gameStarted');
      io.to(playerData.roomCode).emit('gameState', game.getGameState());
      scheduleAdminBroadcast();

      game.players.forEach(player => {
        io.to(player.id).emit('playerHand', game.getPlayerHand(player.id));
      });
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Leave room (without disconnect)
  socket.on('leaveRoom', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;

    const game = rooms.get(playerData.roomCode);
    if (game) {
      game.removePlayer(socket.id);

      if (socket.id === game.hostId) {
        reassignHostIfNeeded(game);
      }

      if (game.rematchVotes instanceof Set) {
        game.rematchVotes.delete(socket.id);
        io.to(playerData.roomCode).emit('rematchVoteUpdate', {
          votes: game.rematchVotes.size,
          total: game.players.length
        });
      }
      socket.leave(playerData.roomCode);

      if (game.players.length === 0) {
        rooms.delete(playerData.roomCode);
        console.log(`Room ${playerData.roomCode} closed`);
      } else {
        io.to(playerData.roomCode).emit('gameState', game.getGameState());
        io.to(playerData.roomCode).emit('playerLeft', {
          playerId: socket.id,
          playerName: playerData.playerName
        });
      }
    }

    players.delete(socket.id);
    scheduleAdminBroadcast();
  });

  // Play a card
  socket.on('playCard', ({ cardIndex, chosenColor }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    try {
      const result = game.playCard(socket.id, cardIndex, chosenColor, {});

      // Clear any pending draw/pass state on the acting client.
      socket.emit('drawOption', { canPlayDrawnCard: false, drawnCardIndex: null });
      
      // Send game state to all players
      io.to(playerData.roomCode).emit('gameState', game.getGameState());
      
      // Send individual hands to each player
      game.players.forEach(player => {
        io.to(player.id).emit('playerHand', game.getPlayerHand(player.id));
      });
      
      if (result.cardPlayed) {
        io.to(playerData.roomCode).emit('cardPlayed', {
          playerId: socket.id,
          playerName: playerData.playerName,
          card: result.cardPlayed
        });
      }

      // If the played card forced someone to draw (+2/+4), broadcast it for animations.
      if (result.effect && result.effect.drawn) {
        io.to(playerData.roomCode).emit('cardsDrawn', {
          playerId: result.effect.drawn.playerId,
          playerName: result.effect.drawn.playerName,
          count: result.effect.drawn.count,
          reason: result.effect.drawn.reason
        });
      }

      // If stacking is enabled and the next player couldn't respond, the server may auto-draw
      // the stack penalty; broadcast that too.
      if (result.effect && result.effect.autoDrawn) {
        io.to(playerData.roomCode).emit('cardsDrawn', {
          playerId: result.effect.autoDrawn.playerId,
          playerName: result.effect.autoDrawn.playerName,
          count: result.effect.autoDrawn.count,
          reason: result.effect.autoDrawn.reason
        });
      }
      
      // Check if player is safe (finished their cards)
      if (result.playerSafe) {
        io.to(playerData.roomCode).emit('playerSafe', {
          playerId: socket.id,
          playerName: playerData.playerName
        });
      }
      
      // Check if game is over (only one player left)
      if (result.gameOver) {
        io.to(playerData.roomCode).emit('gameOver', {
          loser: result.loser,
          safePlayers: result.safePlayers
        });
      }
      
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Draw a card
  socket.on('drawCard', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    try {
      const drawResult = game.drawCard(socket.id);

      io.to(playerData.roomCode).emit('gameState', game.getGameState());

      // Send updated hand + draw option to the player who drew
      socket.emit('playerHand', game.getPlayerHand(socket.id));
      socket.emit('drawOption', {
        canPlayDrawnCard: !!(drawResult && drawResult.canPlayDrawnCard),
        drawnCardIndex: drawResult && typeof drawResult.drawnCardIndex === 'number' ? drawResult.drawnCardIndex : null
      });
      
      const drawnCount = drawResult && typeof drawResult.drawnCount === 'number' ? drawResult.drawnCount : 1;
      io.to(playerData.roomCode).emit('cardsDrawn', {
        playerId: socket.id,
        playerName: playerData.playerName,
        count: drawnCount,
        reason: (drawResult && drawResult.reason) ? drawResult.reason : 'draw'
      });
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Pass turn after drawing a playable card
  socket.on('passTurn', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;

    const game = rooms.get(playerData.roomCode);
    if (!game) return;

    try {
      game.passTurnAfterDraw(socket.id);

      // Clear any pending draw/pass state on the acting client.
      socket.emit('drawOption', { canPlayDrawnCard: false, drawnCardIndex: null });

      io.to(playerData.roomCode).emit('gameState', game.getGameState());
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Call CLASH
  socket.on('callClash', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;

    try {
      game.callClash(socket.id);
      io.to(playerData.roomCode).emit('clashCalled', {
        playerId: socket.id,
        playerName: playerData.playerName
      });
      io.to(playerData.roomCode).emit('gameState', game.getGameState());
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Challenge call (when someone forgets to call CLASH)
  socket.on('challengeCall', ({ targetPlayerId }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    try {
      const penalized = game.challengeCall(targetPlayerId);
      if (penalized) {
        const targetPlayer = game.players.find(p => p.id === targetPlayerId);
        io.to(playerData.roomCode).emit('callChallenged', {
          challengerId: socket.id,
          challengerName: playerData.playerName,
          targetId: targetPlayerId,
          targetName: targetPlayer ? targetPlayer.name : undefined,
          penaltyCount: 4
        });

        io.to(playerData.roomCode).emit('cardsDrawn', {
          playerId: targetPlayerId,
          playerName: targetPlayer ? targetPlayer.name : undefined,
          count: 4,
          reason: 'call-penalty'
        });

        io.to(playerData.roomCode).emit('gameState', game.getGameState());

        // Send updated hands (penalty affects only target, but keep clients consistent)
        game.players.forEach(player => {
          io.to(player.id).emit('playerHand', game.getPlayerHand(player.id));
        });
      }
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    const playerData = players.get(socket.id);
    if (playerData) {
      const game = rooms.get(playerData.roomCode);
      if (game) {
        game.removePlayer(socket.id);

        if (socket.id === game.hostId) {
          reassignHostIfNeeded(game);
        }

        if (game.rematchVotes instanceof Set) {
          game.rematchVotes.delete(socket.id);
          io.to(playerData.roomCode).emit('rematchVoteUpdate', {
            votes: game.rematchVotes.size,
            total: game.players.length
          });
        }
        
        if (game.players.length === 0) {
          rooms.delete(playerData.roomCode);
          console.log(`Room ${playerData.roomCode} closed`);
        } else {
          io.to(playerData.roomCode).emit('gameState', game.getGameState());
          io.to(playerData.roomCode).emit('playerLeft', {
            playerId: socket.id,
            playerName: playerData.playerName
          });
        }
      }
      players.delete(socket.id);
    }
    console.log('Client disconnected:', socket.id);
    scheduleAdminBroadcast();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Color Clash Server running on port ${PORT}`);
});
