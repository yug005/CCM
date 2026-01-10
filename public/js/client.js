// Client-side Socket.IO logic
console.log('Client script loaded');

const socket = io();

socket.on('connect', () => {
  console.log('Connected to server:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});

// Game state
let gameState = {
  roomCode: null,
  playerId: null,
  playerName: null,
  currentHand: [],
  isMyTurn: false
};

let pendingWildCard = null;

// DOM elements - initialized after DOM loads
let homeScreen, lobbyScreen, gameScreen, errorMessage;
let playerNameInput, roomCodeInput, createRoomBtn, joinRoomBtn;
let displayRoomCode, gameRoomCode, copyCodeBtn, playersList, startGameBtn, leaveLobbyBtn;
let otherPlayers, deckPile, discardPile, colorIndicator, turnIndicator, playerHand, deckCount, drawCardBtn, sayUnoBtn;
let colorPickerModal, gameOverModal, gameOverContent, playAgainBtn, leaveGameBtn;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, initializing...');
  
  // Hide loading screen after a short delay
  setTimeout(() => {
    const loadingScreen = document.getElementById('loadingScreen');
    console.log('Loading screen element:', loadingScreen);
    if (loadingScreen) {
      console.log('Hiding loading screen...');
      loadingScreen.classList.add('hidden');
      setTimeout(() => {
        loadingScreen.remove();
        console.log('Loading screen removed');
      }, 500);
    } else {
      console.error('Loading screen element not found!');
    }
  }, 800);
  
  // Get all DOM elements
  homeScreen = document.getElementById('homeScreen');
  lobbyScreen = document.getElementById('lobbyScreen');
  gameScreen = document.getElementById('gameScreen');
  errorMessage = document.getElementById('errorMessage');
  
  playerNameInput = document.getElementById('playerName');
  roomCodeInput = document.getElementById('roomCode');
  createRoomBtn = document.getElementById('createRoomBtn');
  joinRoomBtn = document.getElementById('joinRoomBtn');
  
  displayRoomCode = document.getElementById('displayRoomCode');
  gameRoomCode = document.getElementById('gameRoomCode');
  copyCodeBtn = document.getElementById('copyCodeBtn');
  playersList = document.getElementById('playersList');
  startGameBtn = document.getElementById('startGameBtn');
  leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
  
  otherPlayers = document.getElementById('otherPlayers');
  deckPile = document.getElementById('deckPile');
  discardPile = document.getElementById('discardPile');
  colorIndicator = document.getElementById('colorIndicator');
  turnIndicator = document.getElementById('turnIndicator');
  playerHand = document.getElementById('playerHand');
  deckCount = document.getElementById('deckCount');
  drawCardBtn = document.getElementById('drawCardBtn');
  sayUnoBtn = document.getElementById('sayUnoBtn');
  
  colorPickerModal = document.getElementById('colorPickerModal');
  gameOverModal = document.getElementById('gameOverModal');
  gameOverContent = document.getElementById('gameOverContent');
  playAgainBtn = document.getElementById('playAgainBtn');
  leaveGameBtn = document.getElementById('leaveGameBtn');
  
  // Load saved player name
  const savedName = localStorage.getItem('unoPlayerName');
  if (savedName) {
    playerNameInput.value = savedName;
  }
  
  attachEventListeners();
});

function attachEventListeners() {
  // Create room
  createRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (!playerName) {
      showError('Please enter your name');
      return;
    }
    gameState.playerName = playerName;
    socket.emit('createRoom', { playerName });
  });
  
  // Join room
  joinRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (!playerName) {
      showError('Please enter your name');
      return;
    }
    if (!roomCode || roomCode.length !== 6) {
      showError('Please enter a valid 6-digit room code');
      return;
    }
    gameState.playerName = playerName;
    socket.emit('joinRoom', { roomCode, playerName });
  });
  
  // Copy room code
  copyCodeBtn.addEventListener('click', () => {
    const code = displayRoomCode.textContent;
    navigator.clipboard.writeText(code).then(() => {
      showNotification('Room code copied!', 'success');
    });
  });
  
  // Start game
  startGameBtn.addEventListener('click', () => {
    socket.emit('startGame');
  });
  
  // Leave lobby
  leaveLobbyBtn.addEventListener('click', () => {
    socket.emit('leaveRoom');
    showScreen('homeScreen');
  });
  
  // Draw card
  drawCardBtn.addEventListener('click', () => {
    socket.emit('drawCard');
    
    // Add draw animation
    drawCardBtn.classList.add('drawing');
    setTimeout(() => {
      drawCardBtn.classList.remove('drawing');
    }, 400);
  });
  
  // Say UNO
  sayUnoBtn.addEventListener('click', () => {
    socket.emit('sayUno');
    showNotification('You said UNO!', 'success');
  });

  // Play again
  playAgainBtn.addEventListener('click', () => {
    location.reload();
  });

  // Leave game
  leaveGameBtn.addEventListener('click', () => {
    location.reload();
  });

  // Color picker
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      if (pendingWildCard !== null) {
        // Animate the wild card being played
        const cardElement = playerHand.children[pendingWildCard];
        if (cardElement) {
          cardElement.classList.add('playing');
        }
        
        setTimeout(() => {
          socket.emit('playCard', { 
            cardIndex: pendingWildCard, 
            chosenColor: color 
          });
          pendingWildCard = null;
          colorPickerModal.classList.remove('show');
        }, 200);
      }
    });
  });
  
  // Save player name
  playerNameInput.addEventListener('blur', () => {
    localStorage.setItem('unoPlayerName', playerNameInput.value.trim());
  });
  
  console.log('All event listeners attached');
}

// Socket event handlers

socket.on('roomCreated', ({ roomCode, playerId, playerName }) => {
  gameState.roomCode = roomCode;
  gameState.playerId = playerId;
  displayRoomCode.textContent = roomCode;
  gameRoomCode.textContent = roomCode;
  showScreen('lobbyScreen');
});

socket.on('roomJoined', ({ roomCode, playerId, playerName }) => {
  gameState.roomCode = roomCode;
  gameState.playerId = playerId;
  displayRoomCode.textContent = roomCode;
  gameRoomCode.textContent = roomCode;
  showScreen('lobbyScreen');
});

socket.on('gameState', (state) => {
  console.log('📊 Received game state:', state);
  updateGameState(state);
  
  // Re-render cards after game state update if we have cards
  if (gameState.currentHand && gameState.currentHand.length > 0) {
    console.log('Re-rendering cards after gameState update');
    renderPlayerHand(state);
  }
});

socket.on('playerHand', (hand) => {
  console.log('✅ Received player hand:', hand);
  console.log('Hand length:', hand ? hand.length : 0);
  console.log('Game screen active:', gameScreen ? gameScreen.classList.contains('active') : false);
  
  gameState.currentHand = hand;
  
  // Always try to render if we have the game state
  if (gameState.lastTopCard || gameState.lastCurrentColor) {
    const state = { 
      topCard: gameState.lastTopCard, 
      currentColor: gameState.lastCurrentColor,
      currentPlayerId: gameState.lastCurrentPlayerId 
    };
    console.log('Rendering with state:', state);
    renderPlayerHand(state);
  } else {
    console.log('⚠️ Waiting for gameState before rendering cards');
  }
});

socket.on('gameStarted', () => {
  console.log('🎮 Game started!');
  showScreen('gameScreen');
  
  // Trigger card render after screen shows if we already have cards
  setTimeout(() => {
    if (gameState.currentHand && gameState.currentHand.length > 0) {
      console.log('Rendering cards after game start');
      renderPlayerHand({
        topCard: gameState.lastTopCard,
        currentColor: gameState.lastCurrentColor,
        currentPlayerId: gameState.lastCurrentPlayerId
      });
    }
  }, 100);
});

socket.on('playersUpdate', (players) => {
  updatePlayersList(players);
});

socket.on('cardPlayed', ({ playerId, card }) => {
  showNotification(`${formatCardName(card)} played!`, 'info');
});

socket.on('cardDrawn', ({ playerId, count }) => {
  if (playerId === gameState.playerId) {
    showNotification(`You drew ${count} card${count > 1 ? 's' : ''}`, 'info');
  }
});

socket.on('unoSaid', ({ playerId, playerName }) => {
  if (playerId === gameState.playerId) {
    showNotification('You said UNO!', 'success');
  } else {
    showNotification(`${playerName} said UNO!`, 'info');
  }
});

socket.on('unoChallenged', ({ challengerId, targetId, targetName, success }) => {
  if (success) {
    showNotification(`${targetName} was challenged! Drew 2 cards.`, 'warning');
  } else {
    showNotification(`Challenge failed!`, 'info');
  }
});

socket.on('gameOver', ({ winner, loser, stats }) => {
  displayGameOver(loser, stats);
});

socket.on('playerLeft', ({ playerId, playerName }) => {
  showNotification(`${playerName} left the game`, 'warning');
});

socket.on('error', ({ message }) => {
  showError(message);
});

// UI Functions

function showScreen(screenId) {
  homeScreen.classList.remove('active');
  lobbyScreen.classList.remove('active');
  gameScreen.classList.remove('active');
  
  if (screenId === 'homeScreen') homeScreen.classList.add('active');
  if (screenId === 'lobbyScreen') lobbyScreen.classList.add('active');
  if (screenId === 'gameScreen') gameScreen.classList.add('active');
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 3000);
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => notification.classList.add('show'), 10);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

function updatePlayersList(players) {
  playersList.innerHTML = '';
  players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = `${player.name} ${player.isHost ? '(Host)' : ''}`;
    playersList.appendChild(li);
  });
  
  // Show start button only to host
  const currentPlayer = players.find(p => p.id === gameState.playerId);
  if (currentPlayer && currentPlayer.isHost && players.length >= 2) {
    startGameBtn.style.display = 'block';
  } else {
    startGameBtn.style.display = 'none';
  }
}

function updateGameState(state) {
  gameState.lastTopCard = state.topCard;
  gameState.lastCurrentColor = state.currentColor;
  gameState.lastCurrentPlayerId = state.currentPlayerId;
  
  // Update top card display
  if (discardPile && state.topCard) {
    const colorClass = state.topCard.color === 'wild' ? 'black' : state.topCard.color;
    discardPile.innerHTML = `
      <div class="uno-card ${colorClass}">
        <div class="card-value">${formatCardValue(state.topCard)}</div>
        <div class="card-symbol">${formatCardValue(state.topCard)}</div>
      </div>
    `;
    discardPile.style.animation = 'none';
    setTimeout(() => {
      discardPile.style.animation = 'card-flip 0.4s';
    }, 10);
  }
  
  // Update color indicator
  if (colorIndicator) {
    colorIndicator.textContent = state.currentColor;
    colorIndicator.className = 'color-indicator ' + state.currentColor;
  }
  
  // Update deck count
  if (deckCount) {
    deckCount.textContent = state.deckCount || 0;
  }
  
  // Update turn indicator
  const isMyTurn = state.currentPlayerId === gameState.playerId;
  gameState.isMyTurn = isMyTurn;
  
  if (turnIndicator) {
    if (isMyTurn) {
      turnIndicator.textContent = "YOUR TURN";
      turnIndicator.className = 'turn-indicator my-turn';
    } else {
      const currentPlayer = state.players.find(p => p.id === state.currentPlayerId);
      turnIndicator.textContent = currentPlayer ? `${currentPlayer.name}'s Turn` : "Waiting...";
      turnIndicator.className = 'turn-indicator';
    }
  }
  
  // Update other players
  if (otherPlayers) {
    otherPlayers.innerHTML = '';
    state.players.forEach(player => {
      if (player.id !== gameState.playerId) {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'other-player';
        if (player.id === state.currentPlayerId) {
          playerDiv.classList.add('active-player');
        }
        playerDiv.innerHTML = `
          <div class="player-name">${player.name}</div>
          <div class="player-cards">${player.handSize} cards</div>
        `;
        otherPlayers.appendChild(playerDiv);
      }
    });
  }🎴 renderPlayerHand called');
  console.log('  - Cards in hand:', gameState.currentHand ? gameState.currentHand.length : 0);
  console.log('  - State:', state);
  console.log('  - playerHand element:', playerHand ? 'exists' : 'NULL');
  
  if (!playerHand) {
    console.error('❌ playerHand element not found!');
    return;
  }
  
  if (!gameState.currentHand || gameState.currentHand.length === 0) {
    console.log('⚠️ No cards to render');
    playerHand.innerHTML = '<div style="color: white; text-align: center;">No cards</div>';
    return;
  }
  
  playerHand.innerHTML = '';
  console.log('Rendering', gameState.currentHand.length, 'cards...');
  
  gameState.currentHand.forEach((card, index) => {
    const cardDiv = document.createElement('div');
    const colorClass = card.color === 'wild' ? 'black' : card.color;
    cardDiv.className = `uno-card ${colorClass}`;
    
    console.log(`  Card ${index}:`, card.color, card.value);
    
    // Add card content
    cardDiv.innerHTML = `
      <div class="card-value">${formatCardValue(card)}</div>
      <div class="card-symbol">${formatCardValue(card)}</div>
    `;
    
    // Check if card is playable
    if (state && state.topCard) {
      const isPlayable = canPlayCard(card, state.topCard, state.currentColor);
      if (isPlayable && gameState.isMyTurn) {
        cardDiv.classList.add('playable');
        cardDiv.addEventListener('click', () => playCard(index, card));
      } else {
        cardDiv.classList.add('unplayable');
      }
    }
    
    playerHand.appendChild(cardDiv);
  });
  
  console.log('✅ Cards rendered! DOM
        cardDiv.classList.add('unplayable');
      }
    }
    
    playerHand.appendChild(cardDiv);
  });
  console.log('Cards rendered, playerHand children:', playerHand.children.length);
}

function createCardHTML(card) {
  const colorClass = card.color === 'wild' ? 'black' : card.color;
  return `
    <div class="card-value">${formatCardValue(card)}</div>
    <div class="card-symbol">${formatCardValue(card)}</div>
  `;
}

function formatCardValue(card) {
  if (card.value === 'wild') return '🎨';
  if (card.value === 'wild_draw_four') return '+4';
  if (card.value === 'draw_two') return '+2';
  if (card.value === 'skip') return '⊘';
  if (card.value === 'reverse') return '⇄';
  return card.value;
}

function formatCardName(card) {
  const color = card.color === 'wild' ? 'Wild' : card.color.charAt(0).toUpperCase() + card.color.slice(1);
  const value = formatCardValue(card);
  return `${color} ${value}`;
}

function canPlayCard(card, topCard, currentColor) {
  if (!topCard) return false;
  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function playCard(index, card) {
  if (!gameState.isMyTurn) {
    showNotification("It's not your turn!", 'warning');
    return;
  }
  
  // Add playing animation
  const cardElement = playerHand.children[index];
  if (cardElement) {
    cardElement.classList.add('playing');
  }
  
  // If it's a wild card, show color picker
  if (card.color === 'wild') {
    pendingWildCard = index;
    colorPickerModal.classList.add('show');
    return;
  }
  
  // Play the card with animation delay
  setTimeout(() => {
    socket.emit('playCard', { cardIndex: index });
  }, 200);
}

function displayGameOver(loser, stats) {
  const loserName = loser.name;
  
  gameOverContent.innerHTML = `
    <h2>🎉 Game Over! 🎉</h2>
    <div class="game-over-stats">
      <p class="loser-announcement">${loserName} is the LOSER! 😅</p>
      <p class="winner-announcement">Everyone else WINS! 🏆</p>
      ${stats ? `
        <div class="stats">
          <h3>Game Statistics:</h3>
          <p>Total turns: ${stats.totalTurns || 'N/A'}</p>
          <p>Cards played: ${stats.cardsPlayed || 'N/A'}</p>
        </div>
      ` : ''}
    </div>
  `;
  
  gameOverModal.classList.add('show');
  
  // Create confetti effect
  createConfetti();
}

function createConfetti() {
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#a29bfe'];
  const confettiContainer = document.createElement('div');
  confettiContainer.className = 'confetti-container';
  document.body.appendChild(confettiContainer);
  
  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 3 + 's';
    confetti.style.animationDuration = (Math.random() * 3 + 2) + 's';
    confettiContainer.appendChild(confetti);
  }
  
  setTimeout(() => {
    confettiContainer.remove();
  }, 5000);
}
