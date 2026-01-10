const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const Game = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    if (game.hasStarted) {
      socket.emit('error', { message: 'Game already started' });
      return;
    }
    
    if (game.players.length >= 6) {
      socket.emit('error', { message: 'Room is full' });
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
    console.log(`${playerName} joined room ${roomCode}`);
  });

  // Start game
  socket.on('startGame', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    if (game.players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players to start' });
      return;
    }
    
    try {
      game.startGame();
      io.to(playerData.roomCode).emit('gameStarted');
      io.to(playerData.roomCode).emit('gameState', game.getGameState());
      
      // Send initial hands to all players
      game.players.forEach(player => {
        io.to(player.id).emit('playerHand', game.getPlayerHand(player.id));
      });
      
      console.log(`Game started in room ${playerData.roomCode}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Play a card
  socket.on('playCard', ({ cardIndex, chosenColor }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    try {
      const result = game.playCard(socket.id, cardIndex, chosenColor);
      
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
      socket.emit('error', { message: error.message });
    }
  });

  // Draw a card
  socket.on('drawCard', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    try {
      game.drawCard(socket.id);
      io.to(playerData.roomCode).emit('gameState', game.getGameState());
      
      // Send updated hand to the player who drew
      socket.emit('playerHand', game.getPlayerHand(socket.id));
      
      io.to(playerData.roomCode).emit('cardDrawn', {
        playerId: socket.id,
        playerName: playerData.playerName
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Say UNO
  socket.on('sayUno', () => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    
    const game = rooms.get(playerData.roomCode);
    if (!game) return;
    
    game.sayUno(socket.id);
    io.to(playerData.roomCode).emit('unoSaid', {
      playerId: socket.id,
      playerName: playerData.playerName
    });
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
        io.to(playerData.roomCode).emit('unoChallenged', {
          challengerId: socket.id,
          challengerName: playerData.playerName,
          targetId: targetPlayerId
        });
        io.to(playerData.roomCode).emit('gameState', game.getGameState());
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    const playerData = players.get(socket.id);
    if (playerData) {
      const game = rooms.get(playerData.roomCode);
      if (game) {
        game.removePlayer(socket.id);
        
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
