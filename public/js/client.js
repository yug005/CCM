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

// UI animation state
let pendingDrawFlight = null; // { prevHandLength: number }
let lastRenderedHandLength = 0;
let hasRenderedInitialHand = false;

// Rematch voting UI state
gameState.rematch = { voted: false, votes: 0, total: 0 };

// Draw-then-play flow: if you draw a playable card, you may play ONLY that drawn card or pass.
gameState.canPassAfterDraw = false;
gameState.drawnCardIndex = null;

// DOM elements - initialized after DOM loads
let homeScreen, lobbyScreen, gameScreen, errorMessage;
let playerNameInput, roomCodeInput, createRoomBtn, joinRoomBtn;
let displayRoomCode, gameRoomCode, copyCodeBtn, playersList, startGameBtn, leaveLobbyBtn;
let otherPlayers, deckPile, discardPile, colorIndicator, turnIndicator, playerHand, deckCount, drawCardBtn, callClashBtn;
let colorPickerModal, gameOverModal, gameOverContent, playAgainBtn, leaveGameBtn;
let settingsToggle, settingsPanel, gameSettingsDisplay;
let gameModeSelect;
let gameModeHint;

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

  gameModeSelect = document.getElementById('gameMode');
  gameModeHint = document.getElementById('gameModeHint');
  
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
  callClashBtn = document.getElementById('callClashBtn');
  
  colorPickerModal = document.getElementById('colorPickerModal');
  gameOverModal = document.getElementById('gameOverModal');
  gameOverContent = document.getElementById('gameOverContent');
  playAgainBtn = document.getElementById('playAgainBtn');
  leaveGameBtn = document.getElementById('leaveGameBtn');
  
  // Load saved player name
  const savedName = localStorage.getItem('ccmPlayerName');
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

    // Prepare to animate deck -> new card in hand once the updated hand arrives.
    pendingDrawFlight = { prevHandLength: Array.isArray(gameState.currentHand) ? gameState.currentHand.length : 0 };

    socket.emit('drawCard');

    // Add draw animation
    drawCardBtn.classList.add('drawing');
    setTimeout(() => {
      drawCardBtn.classList.remove('drawing');
    }, 400);
  });
  
  // Call CLASH
  callClashBtn.addEventListener('click', () => {
    if (!canCallClashNow()) {
      showNotification('You can only call CLASH on your turn with exactly 2 cards', 'warning');
      return;
    }

    socket.emit('callClash');
  });

  // Play again
  playAgainBtn.addEventListener('click', () => {
    gameState.rematch.voted = true;
    updateRematchUI();
    socket.emit('playAgain');
  });

  // Leave game
  leaveGameBtn.addEventListener('click', () => {
    socket.emit('leaveRoom');
    // Reset a few local bits and go home
    pendingWildCard = null;
    gameState.currentHand = [];
    gameState.isMyTurn = false;
    showScreen('homeScreen');
  });

  // Color picker
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      if (pendingWildCard !== null) {
        const cardIndex = pendingWildCard;
        pendingWildCard = null;
        colorPickerModal.classList.remove('show');

        // Smoothly animate the selected wild card to the discard pile, then emit.
        const cardEl = playerHand && playerHand.children ? playerHand.children[cardIndex] : null;
        const card = Array.isArray(gameState.currentHand) ? gameState.currentHand[cardIndex] : null;

        animateCardFlight({
          fromEl: cardEl,
          toEl: discardPile,
          card,
          durationMs: 360,
          rotateDeg: 18,
          hideFromEl: true
        }).finally(() => {
          socket.emit('playCard', {
            cardIndex,
            chosenColor: color
          });
        });
      }
    });
  });
  
  // Save player name
  playerNameInput.addEventListener('blur', () => {
    localStorage.setItem('ccmPlayerName', playerNameInput.value.trim());
  });

  if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', () => {
      const isHidden = settingsPanel.style.display === 'none' || settingsPanel.style.display === '';
      settingsPanel.style.display = isHidden ? 'block' : 'none';
    });
  }

  // Game mode toggles whether variations are shown/used.
  if (gameModeSelect && settingsToggle && settingsPanel) {
    const applyModeUI = () => {
      const mode = gameModeSelect.value || 'classic';
      const isFlip = mode === 'flip';
      settingsToggle.style.display = isFlip ? 'none' : 'block';
      if (isFlip) {
        settingsPanel.style.display = 'none';
      }

      if (gameModeHint) {
        gameModeHint.textContent = isFlip
          ? 'Switch: two-sided deck • variations disabled'
          : 'Classic: standard rules • optional variations';
      }
    };
    gameModeSelect.addEventListener('change', applyModeUI);
    applyModeUI();
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

  const prevLen = lastRenderedHandLength;
  
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

  // Animate NEW cards entering the hand from the deck (draw 1/2/4/penalties).
  // Skip the initial deal so it doesn't spam 7 animations on game start.
  if (hasRenderedInitialHand && Array.isArray(hand) && hand.length > prevLen) {
    const fromEl = deckPile;
    const added = hand.length - prevLen;

    requestAnimationFrame(() => {
      for (let i = 0; i < added; i++) {
        const targetIndex = prevLen + i;
        const toEl = playerHand && playerHand.children ? playerHand.children[targetIndex] : null;
        const card = hand[targetIndex];
        setTimeout(() => {
          animateCardFlight({
            fromEl,
            toEl,
            card,
            durationMs: 420,
            rotateDeg: -10
          });
        }, i * 120);
      }
    });
  }

  pendingDrawFlight = null;
  lastRenderedHandLength = Array.isArray(hand) ? hand.length : 0;
  if (!hasRenderedInitialHand && Array.isArray(hand) && hand.length > 0) {
    hasRenderedInitialHand = true;
  }
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

socket.on('roundRestarted', () => {
  // Close game over modal + reset animation flags
  if (gameOverModal) gameOverModal.classList.remove('show');
  hasRenderedInitialHand = false;
  pendingDrawFlight = null;

  gameState.rematch = { voted: false, votes: 0, total: 0 };
  updateRematchUI();
});

socket.on('rematchVoteUpdate', ({ votes, total }) => {
  gameState.rematch.votes = typeof votes === 'number' ? votes : 0;
  gameState.rematch.total = typeof total === 'number' ? total : 0;
  updateRematchUI();
});

socket.on('cardPlayed', ({ playerId, playerName, card }) => {
  if (playerId === gameState.playerId) {
    showNotification(`You played ${formatCardName(card)}`, 'info');
  } else {
    showNotification(`${playerName || 'Someone'} played ${formatCardName(card)}`, 'info');
  }

  // Animate OTHER players' played cards flying into the discard pile.
  // (For me, we already animate on click before emitting.)
  if (playerId && playerId !== gameState.playerId) {
    const playerBox = document.querySelector(`.other-player[data-player-id="${playerId}"]`);
    const fromEl = (playerBox && playerBox.querySelector('.mini-card-back:last-child')) || playerBox || deckPile;
    animateCardFlight({
      fromEl,
      toEl: discardPile,
      card,
      durationMs: 420,
      rotateDeg: 10
    });
  }
});

// Prefer the richer event with draw counts; keep the old one as a no-op for compatibility.
socket.on('cardDrawn', () => {
  // no-op (server now emits cardsDrawn)
});

socket.on('cardsDrawn', ({ playerId, playerName, count, reason }) => {
  const drawCount = typeof count === 'number' && count > 0 ? count : 1;

  // Notifications
  if (playerId === gameState.playerId) {
    showNotification(drawCount === 1 ? 'You drew a card' : `You drew ${drawCount} cards`, 'info');
  } else {
    const who = playerName || 'Someone';
    showNotification(drawCount === 1 ? `${who} drew a card` : `${who} drew ${drawCount} cards`, 'info');
  }

  // Animate deck -> player's area (self uses playerHand diff animation; others use mini-hand)
  if (!playerId || playerId === gameState.playerId) return;

  const playerBox = document.querySelector(`.other-player[data-player-id="${playerId}"]`);
  const toEl = (playerBox && playerBox.querySelector('.mini-hand')) || playerBox;
  if (!toEl) return;

  if (playerBox) {
    playerBox.classList.add('draw-highlight');
    setTimeout(() => playerBox.classList.remove('draw-highlight'), 650);
  }

  for (let i = 0; i < drawCount; i++) {
    setTimeout(() => {
      animateCardFlight({
        fromEl: deckPile,
        toEl,
        card: null,
        durationMs: 380,
        rotateDeg: -8
      });
    }, i * 120);
  }
});

socket.on('clashCalled', ({ playerId, playerName }) => {
  if (playerId === gameState.playerId) {
    showNotification('You called CLASH!', 'success');
  } else {
    showNotification(`${playerName} called CLASH!`, 'info');
  }
});

socket.on('callChallenged', ({ challengerId, challengerName, targetId, targetName, penaltyCount }) => {
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
  const msg = message || 'Something went wrong';

  // In-game errors should be visible even when the home screen is not active.
  showNotification(msg, 'error');

  // Keep the home-screen error banner behavior for join/create validation.
  if (homeScreen && homeScreen.classList.contains('active')) {
    showError(msg);
  }
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
  // If the home-screen banner isn't visible (e.g. during gameplay), fall back to a toast.
  if (!homeScreen || !homeScreen.classList.contains('active')) {
    showNotification(message, 'error');
    return;
  }

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
    const wins = typeof player.wins === 'number' ? player.wins : 0;
    div.textContent = `${player.name}${hostLabel}  ★${wins}`;
    playersList.appendChild(div);
  });

  // Start button visible only for host and 2+ players before game starts
  if (startGameBtn) {
    const isHost = hostId && hostId === gameState.playerId;
    startGameBtn.style.display = isHost && state.players.length >= 2 && !state.hasStarted ? 'block' : 'none';
  }

  if (gameSettingsDisplay && state.settings) {
    const lines = [];
    const mode = state.settings.gameMode || 'classic';
    if (mode === 'flip') {
      gameSettingsDisplay.textContent = 'Mode: Switch';
    } else {
      lines.push('Mode: Classic');
      if (state.settings.stackPlusTwoFour) lines.push('Stacking +2/+4: ON');
      if (state.settings.sevenZeroRule) lines.push('7-0 Rule: ON');
      gameSettingsDisplay.textContent = lines.length ? lines.join(' • ') : 'Mode: Classic • Game variations: OFF';
    }
  }
}

function updateGameState(state) {
  gameState.lastTopCard = state.topCard;
  gameState.lastCurrentColor = state.currentColor;
  gameState.lastCurrentPlayerId = state.currentPlayerId;
  gameState.lastPlayers = state.players;
  gameState.lastSettings = state.settings;
  gameState.drawStackCount = state.drawStackCount || 0;
  gameState.drawStackType = state.drawStackType || null;

  // Update lobby UI from game state
  updateLobbyFromGameState(state);
  
  // Update top card display
  if (discardPile && state.topCard) {
    const colorClass = state.topCard.color === 'wild' ? 'black' : state.topCard.color;
    const display = getCardDisplay(state.topCard);
    discardPile.innerHTML = `
      <div class="discard-top">
        <div class="cc-card ${colorClass}">
          <div class="card-corner top-left">${display.corner}</div>
          <div class="card-corner bottom-right">${display.corner}</div>
          <div class="card-center">
            <div class="card-value">${display.main}</div>
            <div class="card-symbol">${display.sub}</div>
          </div>
        </div>
      </div>
    `;

    // Flip animation (apply to the wrapper so it doesn't fight the pile spin)
    const discardTop = discardPile.querySelector('.discard-top');
    if (discardTop) {
      discardTop.style.animation = 'none';
      setTimeout(() => {
        discardTop.style.animation = 'card-flip 0.4s';
      }, 10);
    }
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
    playerDiv.dataset.playerId = player.id;

    if (player.id === state.currentPlayerId) {
      playerDiv.classList.add('active-turn');
    }

    if (player.isSafe) {
      playerDiv.classList.add('safe');
    }

    if (player.id === gameState.playerId) {
      playerDiv.classList.add('me');
    }

    const wins = typeof player.wins === 'number' ? player.wins : 0;
    const displayName = player.id === gameState.playerId ? `${player.name} (You)` : player.name;
    playerDiv.innerHTML = `
      <div class="player-name">${displayName} <span class="wins-badge">★${wins}</span></div>
    `;

    // Face-down cards (visual representation of their hand size)
    const miniHand = createMiniHandEl(Number(player.cardCount) || 0);
    playerDiv.appendChild(miniHand);

    // Call status (no numeric card counts)
    if (player.cardCount === 1) {
      if (player.hasCalledClash) {
        const badge = document.createElement('div');
        badge.className = 'call-badge call-ok';
        badge.textContent = 'CC';
        playerDiv.appendChild(badge);
      } else {
        if (player.id !== gameState.playerId) {
          const catchBtn = document.createElement('button');
          catchBtn.className = 'catch-btn';
          catchBtn.type = 'button';
          catchBtn.textContent = 'CATCH';
          catchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('challengeCall', { targetPlayerId: player.id });
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

function createMiniHandEl(cardCount) {
  const miniHand = document.createElement('div');
  miniHand.className = 'mini-hand';

  const safeCount = Number.isFinite(cardCount) && cardCount > 0 ? cardCount : 0;
  const maxVisible = 10;
  const visible = Math.min(safeCount, maxVisible);
  miniHand.style.setProperty('--count', String(visible));

  for (let i = 0; i < visible; i++) {
    const back = document.createElement('div');
    back.className = 'mini-card-back';
    back.style.setProperty('--i', String(i));
    miniHand.appendChild(back);
  }

  if (safeCount > maxVisible) {
    const more = document.createElement('div');
    more.className = 'mini-more';
    more.textContent = `+${safeCount - maxVisible}`;
    miniHand.appendChild(more);
  }

  return miniHand;
}

function canCallClashNow() {
  if (!Array.isArray(gameState.currentHand)) return false;
  if (gameState.currentHand.length === 1) return true;
  return !!(gameState.isMyTurn && gameState.currentHand.length === 2);
}

function updateActionButtons() {
  if (callClashBtn) {
    callClashBtn.disabled = !canCallClashNow();
  }

  if (drawCardBtn) {
    drawCardBtn.disabled = !gameState.isMyTurn;
    if (gameState.canPassAfterDraw) {
      drawCardBtn.textContent = 'Pass';
    } else if (gameState.isMyTurn && gameState.drawStackCount && gameState.drawStackCount > 0) {
      // Only show the explicit "End Turn" wording when the player actually has a choice
      // to stack (+2/+4). If they can't stack, it's just a forced penalty draw.
      const hand = Array.isArray(gameState.currentHand) ? gameState.currentHand : [];
      const t = gameState.drawStackType;
      const canStack = t
        ? hand.some(c => c && c.value === t)
        : hand.some(c => c && (c.value === '+2' || c.value === '+4'));

      drawCardBtn.textContent = canStack
        ? `End Turn (Draw ${gameState.drawStackCount})`
        : `Draw ${gameState.drawStackCount}`;
    } else {
      drawCardBtn.textContent = 'Draw Card';
    }
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
    cardDiv.className = `cc-card ${colorClass}`;
    
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

      // If there is a draw stack pending, you may only respond with the SAME draw card type.
      if (gameState.isMyTurn && state && state.drawStackCount && state.drawStackCount > 0) {
        if (state.drawStackType) {
          isPlayable = card && card.value === state.drawStackType;
        } else {
          isPlayable = card && (card.value === '+2' || card.value === '+4');
        }
      }

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
    case 'wd2':
      return { main: 'WD2', sub: '+2', corner: 'WD2' };
    case 'wdc':
      return { main: 'WDC', sub: '🎨', corner: 'WDC' };
    case '+4':
      return { main: '+4', sub: '+4', corner: '+4' };
    case '+2':
      return { main: '+2', sub: '+2', corner: '+2' };
    case 'draw1':
      return { main: 'DRAW 1', sub: '+1', corner: '+1' };
    case 'draw5':
      return { main: 'DRAW 5', sub: '+5', corner: '+5' };
    case 'skip':
      return { main: 'SKIP', sub: '⊘', corner: '⊘' };
    case 'skipEveryone':
      return { main: 'SKIP ALL', sub: '⟲', corner: 'ALL' };
    case 'reverse':
      return { main: 'REV', sub: '⇄', corner: '⇄' };
    case 'flip':
      return { main: 'FLIP', sub: '↻', corner: '↻' };
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

  const cardElement = playerHand && playerHand.children ? playerHand.children[index] : null;
  
  // If it's a wild card, show color picker
  if (card.color === 'wild') {
    pendingWildCard = index;
    colorPickerModal.classList.add('show');
    return;
  }

  // Smoothly animate hand -> discard pile, then emit.
  animateCardFlight({
    fromEl: cardElement,
    toEl: discardPile,
    card,
    durationMs: 360,
    rotateDeg: 12,
    hideFromEl: true
  }).finally(() => {
    socket.emit('playCard', { cardIndex: index });
  });
}

function animateCardFlight({ fromEl, toEl, card, durationMs = 380, rotateDeg = 0, hideFromEl = false }) {
  try {
    if (!fromEl || !toEl || !document.body) return Promise.resolve();

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    if (!fromRect || !toRect) return Promise.resolve();

    // Build a flying element:
    // - If we know the card, show its face.
    // - If we don't (other players drawing), show a generic CC back.
    let flight;
    if (card) {
      flight = document.createElement('div');
      const colorClass = card.color === 'wild' ? 'black' : (card.color || 'black');
      flight.className = `cc-card ${colorClass} card-flight`;
      flight.innerHTML = createCardHTML(card);
    } else {
      flight = document.createElement('div');
      flight.className = 'card-back card-flight';
      flight.textContent = 'CC';
    }

    flight.style.width = `${fromRect.width}px`;
    flight.style.height = `${fromRect.height}px`;
    flight.style.left = `${fromRect.left}px`;
    flight.style.top = `${fromRect.top}px`;

    document.body.appendChild(flight);

    // Hide the original element during the flight so it doesn't look duplicated.
    const prevVisibility = fromEl.style.visibility;
    if (hideFromEl) {
      fromEl.style.visibility = 'hidden';
    }

    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;
    const sx = toRect.width / fromRect.width;
    const sy = toRect.height / fromRect.height;

    const animation = flight.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(${rotateDeg}deg)`, opacity: 1 }
      ],
      {
        duration: durationMs,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards'
      }
    );

    return animation.finished
      .catch(() => {})
      .finally(() => {
        flight.remove();
        if (hideFromEl) {
          fromEl.style.visibility = prevVisibility;
        }
      });
  } catch (e) {
    return Promise.resolve();
  }
}

function displayGameOver(loser, stats) {
  const loserName = loser.name;
  
  gameOverContent.innerHTML = `
    <div class="game-over-stats">
      <p class="loser-announcement">${loserName} loses but we all know tanisha is the real looser 😅</p>
      <p class="winner-announcement">Everyone else WINS! 🏆</p>
      ${Array.isArray(stats) ? `<p>Safe players: ${stats.map(p => p.name).join(', ')}</p>` : ''}
      <p id="rematchVoteStatus" style="opacity:0.85; margin-top:10px;">Rematch votes: --/--</p>
    </div>
  `;
  
  gameOverModal.classList.add('show');

  // Reset local vote state for this game-over screen
  gameState.rematch.voted = false;
  updateRematchUI();
  
  // Create confetti effect
  createConfetti();
}

function updateRematchUI() {
  if (!playAgainBtn) return;

  // Button label
  playAgainBtn.textContent = gameState.rematch.voted ? 'Voted ✅' : 'Vote Rematch';
  playAgainBtn.disabled = !!gameState.rematch.voted;

  // Status text inside modal (if present)
  const statusEl = document.getElementById('rematchVoteStatus');
  if (statusEl) {
    const v = typeof gameState.rematch.votes === 'number' ? gameState.rematch.votes : 0;
    const t = typeof gameState.rematch.total === 'number' ? gameState.rematch.total : 0;
    statusEl.textContent = t > 0 ? `Rematch votes: ${v}/${t}` : 'Rematch votes: --/--';
  }
}

function getSelectedSettings() {
  const stackPlusTwoFour = document.getElementById('stackPlusTwoFour');
  const sevenZeroRule = document.getElementById('sevenZeroRule');
  const gameMode = document.getElementById('gameMode');
  return {
    gameMode: gameMode ? (gameMode.value || 'classic') : 'classic',
    stackPlusTwoFour: !!(stackPlusTwoFour && stackPlusTwoFour.checked),
    sevenZeroRule: !!(sevenZeroRule && sevenZeroRule.checked),
    // jump-in removed
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
