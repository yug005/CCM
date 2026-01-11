const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const Game = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Serve static files
app.use(express.static('public'));

// In-memory storage
const rooms = new Map(); // roomCode -> Game instance
const players = new Map(); // socketId -> { roomCode, playerName }

// Generate random room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Create a new room
  socket.on('createRoom', ({ playerName, settings }) => {
    const roomCode = generateRoomCode();
    const game = new Game(roomCode, settings);
    
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
    
    if (game.players.length >= 6) {
      socket.emit('gameError', { message: 'Room is full' });
      return;
    }
    
    players.set(socket.id, { roomCode, playerName });
    socket.join(roomCode);
    game.addPlayer(socket.id, playerName);
    
    socket.emit('roomJoined', { 
      roomCode, 
      playerId: socket.id,
      playerName 
    });
    
    io.to(roomCode).emit('gameState', game.getGameState());

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
      
      // Send initial hands to all players
      game.players.forEach(player => {
        io.to(player.id).emit('playerHand', game.getPlayerHand(player.id));
      });
      
      console.log(`Game started in room ${playerData.roomCode}`);
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
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

  // Say UNO
  socket.on('sayUno', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;

    try {
      game.sayUno(socket.id);
      io.to(playerData.roomCode).emit('unoSaid', {
        playerId: socket.id,
        playerName: playerData.playerName
      });
      io.to(playerData.roomCode).emit('gameState', game.getGameState());
    } catch (error) {
      socket.emit('gameError', { message: error.message });
    }
  });

  // Challenge UNO (when someone forgets to say UNO)
  socket.on('challengeUno', ({ targetPlayerId }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    try {
      const penalized = game.challengeUno(targetPlayerId);
      if (penalized) {
        const targetPlayer = game.players.find(p => p.id === targetPlayerId);
        io.to(playerData.roomCode).emit('unoChallenged', {
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
          reason: 'uno-penalty'
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
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`UNO Server running on port ${PORT}`);
});
