// Client-side Socket.IO logic
console.log('Client script loaded');

const socket = io(window.SOCKET_SERVER_URL || undefined);

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

// Draw-then-play flow: if you draw a playable card, you may play ONLY that drawn card or pass.
gameState.canPassAfterDraw = false;
gameState.drawnCardIndex = null;

// DOM elements - initialized after DOM loads
let homeScreen, lobbyScreen, gameScreen, errorMessage;
let playerNameInput, roomCodeInput, createRoomBtn, joinRoomBtn;
let displayRoomCode, gameRoomCode, copyCodeBtn, playersList, startGameBtn, leaveLobbyBtn;
let otherPlayers, deckPile, discardPile, colorIndicator, turnIndicator, playerHand, deckCount, drawCardBtn, sayUnoBtn;
let colorPickerModal, gameOverModal, gameOverContent, playAgainBtn, leaveGameBtn;
let settingsToggle, settingsPanel, gameSettingsDisplay;

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

  settingsToggle = document.getElementById('settingsToggle');
  settingsPanel = document.getElementById('settingsPanel');
  gameSettingsDisplay = document.getElementById('gameSettingsDisplay');
  
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

  // Hide deck remaining count display (per UX request)
  if (deckCount && deckCount.parentElement) {
    deckCount.parentElement.style.display = 'none';
  }
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

    const settings = getSelectedSettings();
    socket.emit('createRoom', { playerName, settings });
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
    if (gameState.canPassAfterDraw) {
      socket.emit('passTurn');
      return;
    }

    socket.emit('drawCard');

    // Add draw animation
    drawCardBtn.classList.add('drawing');
    setTimeout(() => {
      drawCardBtn.classList.remove('drawing');
    }, 400);
  });
  
  // Say UNO
  sayUnoBtn.addEventListener('click', () => {
    if (!canSayUnoNow()) {
      showNotification('You can only say UNO on your turn with exactly 2 cards', 'warning');
      return;
    }

    socket.emit('sayUno');
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

  if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', () => {
      const isHidden = settingsPanel.style.display === 'none' || settingsPanel.style.display === '';
      settingsPanel.style.display = isHidden ? 'block' : 'none';
    });
  }
  
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
  
  // FIX: Store hand and render immediately - no waiting for gameState
  gameState.currentHand = hand;

  // If we were in draw-then-play mode but the drawn card no longer exists (e.g. we played it), clear the state.
  if (
    gameState.canPassAfterDraw &&
    (typeof gameState.drawnCardIndex !== 'number' || gameState.drawnCardIndex >= gameState.currentHand.length)
  ) {
    gameState.canPassAfterDraw = false;
    gameState.drawnCardIndex = null;
  }

  updateActionButtons();
  
  // Build state object (may be incomplete on first render, that's OK)
  const state = { 
    topCard: gameState.lastTopCard, 
    currentColor: gameState.lastCurrentColor,
    currentPlayerId: gameState.lastCurrentPlayerId 
  };
  
  // ALWAYS render cards immediately when they arrive
  console.log('Rendering cards immediately...');
  renderPlayerHand(state);
});

// After drawing, server tells us whether we can play the drawn card or should pass.
socket.on('drawOption', ({ canPlayDrawnCard, drawnCardIndex }) => {
  gameState.canPassAfterDraw = !!canPlayDrawnCard;
  gameState.drawnCardIndex = (typeof drawnCardIndex === 'number') ? drawnCardIndex : null;

  if (gameState.canPassAfterDraw) {
    showNotification('You drew a playable card — play it or press Pass', 'info');
  }

  updateActionButtons();
  // Re-render to highlight only the drawn card as playable.
  renderPlayerHand({
    topCard: gameState.lastTopCard,
    currentColor: gameState.lastCurrentColor,
    currentPlayerId: gameState.lastCurrentPlayerId
  });
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

socket.on('cardPlayed', ({ playerId, playerName, card }) => {
  if (playerId === gameState.playerId) {
    showNotification(`You played ${formatCardName(card)}`, 'info');
  } else {
    showNotification(`${playerName || 'Someone'} played ${formatCardName(card)}`, 'info');
  }
});

socket.on('cardDrawn', ({ playerId, playerName }) => {
  if (playerId === gameState.playerId) {
    showNotification('You drew a card', 'info');
  } else {
    showNotification(`${playerName || 'Someone'} drew a card`, 'info');
  }
});

socket.on('unoSaid', ({ playerId, playerName }) => {
  if (playerId === gameState.playerId) {
    showNotification('You said UNO!', 'success');
  } else {
    showNotification(`${playerName} said UNO!`, 'info');
  }
});

socket.on('unoChallenged', ({ challengerId, challengerName, targetId, targetName, penaltyCount }) => {
  const resolvedTargetName = targetName || getPlayerNameById(targetId) || 'a player';
  const penalty = penaltyCount || 4;

  if (challengerId === gameState.playerId) {
    showNotification(`${resolvedTargetName} drew ${penalty} cards (caught!)`, 'warning');
  } else {
    showNotification(`${challengerName || 'Someone'} caught ${resolvedTargetName}: +${penalty} cards`, 'warning');
  }
});

socket.on('playerSafe', ({ playerId, playerName }) => {
  if (playerId === gameState.playerId) {
    showNotification('You are SAFE! (No cards left)', 'success');
  } else {
    showNotification(`${playerName || 'Someone'} is SAFE!`, 'success');
  }
});

socket.on('gameOver', ({ loser, safePlayers }) => {
  displayGameOver(loser, safePlayers);
});

socket.on('playerLeft', ({ playerId, playerName }) => {
  showNotification(`${playerName} left the game`, 'warning');
});

socket.on('gameError', ({ message }) => {
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

function updateLobbyFromGameState(state) {
  if (!playersList || !state || !Array.isArray(state.players)) return;

  const hostId = state.players.length > 0 ? state.players[0].id : null;
  playersList.innerHTML = '';
  state.players.forEach(player => {
    const div = document.createElement('div');
    div.className = 'player-item';
    const hostLabel = player.id === hostId ? ' (Host)' : '';
    div.textContent = `${player.name}${hostLabel}`;
    playersList.appendChild(div);
  });

  // Start button visible only for host and 2+ players before game starts
  if (startGameBtn) {
    const isHost = hostId && hostId === gameState.playerId;
    startGameBtn.style.display = isHost && state.players.length >= 2 && !state.hasStarted ? 'block' : 'none';
  }

  if (gameSettingsDisplay && state.settings) {
    const lines = [];
    if (state.settings.stackPlusTwoFour) lines.push('Stacking +2/+4: ON');
    if (state.settings.sevenZeroRule) lines.push('7-0 Rule: ON');
    if (state.settings.jumpInRule) lines.push('Jump-in: ON');
    gameSettingsDisplay.textContent = lines.length ? lines.join(' • ') : 'Game variations: OFF';
  }
}

function updateGameState(state) {
  gameState.lastTopCard = state.topCard;
  gameState.lastCurrentColor = state.currentColor;
  gameState.lastCurrentPlayerId = state.currentPlayerId;
  gameState.lastPlayers = state.players;

  // Update lobby UI from game state
  updateLobbyFromGameState(state);
  
  // Update top card display
  if (discardPile && state.topCard) {
    const colorClass = state.topCard.color === 'wild' ? 'black' : state.topCard.color;
    const display = getCardDisplay(state.topCard);
    discardPile.innerHTML = `
      <div class="uno-card ${colorClass}">
        <div class="card-corner top-left">${display.corner}</div>
        <div class="card-corner bottom-right">${display.corner}</div>
        <div class="card-center">
          <div class="card-value">${display.main}</div>
          <div class="card-symbol">${display.sub}</div>
        </div>
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
  // User preference: do not show remaining deck size
  if (deckCount) {
    deckCount.textContent = '';
  }
  
  // Update turn indicator
  const isMyTurn = state.currentPlayerId === gameState.playerId;
  gameState.isMyTurn = isMyTurn;

  // If the turn moved away from me, clear any pending draw/pass state.
  if (!isMyTurn) {
    gameState.canPassAfterDraw = false;
    gameState.drawnCardIndex = null;
  }
  
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
    renderTurnOrder(state);
  }
  
  // Render player hand
  renderPlayerHand(state);

  updateActionButtons();
}

function renderTurnOrder(state) {
  if (!otherPlayers || !state || !Array.isArray(state.players)) return;

  const orderRow = document.createElement('div');
  orderRow.className = 'turn-order';

  const arrow = state.direction === -1 ? '←' : '→';

  state.players.forEach((player, idx) => {
    const playerDiv = document.createElement('div');
    playerDiv.className = 'other-player';

    if (player.id === state.currentPlayerId) {
      playerDiv.classList.add('active-turn');
    }

    if (player.isSafe) {
      playerDiv.classList.add('safe');
    }

    if (player.id === gameState.playerId) {
      playerDiv.classList.add('me');
    }

    const displayName = player.id === gameState.playerId ? `${player.name} (You)` : player.name;
    playerDiv.innerHTML = `
      <div class="player-name">${displayName}</div>
      <div class="card-count">${player.cardCount}</div>
    `;

    // UNO status (no numeric card counts)
    if (player.cardCount === 1) {
      if (player.hasCalledUno) {
        const badge = document.createElement('div');
        badge.className = 'uno-badge uno-ok';
        badge.textContent = 'UNO';
        playerDiv.appendChild(badge);
      } else {
        if (player.id !== gameState.playerId) {
          const catchBtn = document.createElement('button');
          catchBtn.className = 'catch-btn';
          catchBtn.type = 'button';
          catchBtn.textContent = 'CATCH';
          catchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('challengeUno', { targetPlayerId: player.id });
          });
          playerDiv.appendChild(catchBtn);
        }
      }
    }

    orderRow.appendChild(playerDiv);

    if (idx < state.players.length - 1) {
      const arrowDiv = document.createElement('div');
      arrowDiv.className = 'turn-arrow';
      arrowDiv.textContent = arrow;
      orderRow.appendChild(arrowDiv);
    }
  });

  otherPlayers.appendChild(orderRow);
}

function canSayUnoNow() {
  if (!Array.isArray(gameState.currentHand)) return false;
  if (gameState.currentHand.length === 1) return true;
  return !!(gameState.isMyTurn && gameState.currentHand.length === 2);
}

function updateActionButtons() {
  if (sayUnoBtn) {
    sayUnoBtn.disabled = !canSayUnoNow();
  }

  if (drawCardBtn) {
    drawCardBtn.disabled = !gameState.isMyTurn;
    drawCardBtn.textContent = gameState.canPassAfterDraw ? 'Pass' : 'Draw Card';
  }
}

function renderPlayerHand(state) {
  console.log('🎴 renderPlayerHand called');
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
    
    const display = getCardDisplay(card);
    cardDiv.innerHTML = `
      <div class="card-corner top-left">${display.corner}</div>
      <div class="card-corner bottom-right">${display.corner}</div>
      <div class="card-center">
        <div class="card-value">${display.main}</div>
        <div class="card-symbol">${display.sub}</div>
      </div>
    `;
    
    // Check if card is playable
    if (state && state.topCard) {
      let isPlayable = canPlayCard(card, state.topCard, state.currentColor);

      // If we drew a playable card this turn, only the drawn card may be played.
      if (gameState.canPassAfterDraw && typeof gameState.drawnCardIndex === 'number') {
        isPlayable = isPlayable && index === gameState.drawnCardIndex;
      }

      if (isPlayable && gameState.isMyTurn) {
        cardDiv.classList.add('playable');
        cardDiv.addEventListener('click', () => playCard(index, card));
      } else {
        cardDiv.classList.add('unplayable');
      }
    } else {
      // No game state yet - just show cards without click handlers
      cardDiv.classList.add('unplayable');
    }
    
    playerHand.appendChild(cardDiv);
  });

  console.log('✅ Cards rendered. playerHand children:', playerHand.children.length);
}

function createCardHTML(card) {
  const colorClass = card.color === 'wild' ? 'black' : card.color;
  const display = getCardDisplay(card);
  return `
    <div class="card-corner top-left">${display.corner}</div>
    <div class="card-corner bottom-right">${display.corner}</div>
    <div class="card-center">
      <div class="card-value">${display.main}</div>
      <div class="card-symbol">${display.sub}</div>
    </div>
  `;
}

function getCardDisplay(card) {
  // main: big center text, sub: smaller symbol, corner: corner label
  switch (card.value) {
    case 'wild':
      return { main: 'WILD', sub: '🎨', corner: 'W' };
    case '+4':
      return { main: '+4', sub: '+4', corner: '+4' };
    case '+2':
      return { main: '+2', sub: '+2', corner: '+2' };
    case 'skip':
      return { main: 'SKIP', sub: '⊘', corner: '⊘' };
    case 'reverse':
      return { main: 'REV', sub: '⇄', corner: '⇄' };
    default:
      return { main: String(card.value), sub: String(card.value), corner: String(card.value) };
  }
}

function formatCardName(card) {
  const color = card.color === 'wild' ? 'Wild' : card.color.charAt(0).toUpperCase() + card.color.slice(1);
  const display = getCardDisplay(card);
  return `${color} ${display.main}`;
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
      ${Array.isArray(stats) ? `<p>Safe players: ${stats.map(p => p.name).join(', ')}</p>` : ''}
    </div>
  `;
  
  gameOverModal.classList.add('show');
  
  // Create confetti effect
  createConfetti();
}

function getSelectedSettings() {
  const stackPlusTwoFour = document.getElementById('stackPlusTwoFour');
  const sevenZeroRule = document.getElementById('sevenZeroRule');
  const jumpInRule = document.getElementById('jumpInRule');
  return {
    stackPlusTwoFour: !!(stackPlusTwoFour && stackPlusTwoFour.checked),
    sevenZeroRule: !!(sevenZeroRule && sevenZeroRule.checked),
    jumpInRule: !!(jumpInRule && jumpInRule.checked)
  };
}

function getPlayerNameById(playerId) {
  const lastStatePlayers = gameState.lastPlayers;
  if (Array.isArray(lastStatePlayers)) {
    const p = lastStatePlayers.find(x => x.id === playerId);
    return p ? p.name : null;
  }
  return null;
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
