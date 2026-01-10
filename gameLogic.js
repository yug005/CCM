// UNO Game Logic - Server-authoritative

class Game {
  constructor(roomCode, settings = {}) {
    this.roomCode = roomCode;
    this.players = [];
    this.safePlayers = []; // Players who finished their cards
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1; // 1 = clockwise, -1 = counter-clockwise
    this.currentColor = null;
    this.hasStarted = false;
    this.isGameOver = false;
    this.loser = null;
    
    // Game settings (configurable variations)
    this.settings = {
      stackPlusTwoFour: settings.stackPlusTwoFour || false,
      sevenZeroRule: settings.sevenZeroRule || false,
      jumpInRule: settings.jumpInRule || false,
      turnTimer: settings.turnTimer || 0, // 0 = no timer
      ...settings
    };
    
    // UNO tracking
    this.unoCalled = new Set(); // Players who properly called UNO for their current 1-card state
    this.unoVulnerable = new Set(); // Players who ended a turn with 1 card and did NOT call UNO

    // Draw-then-play flow (UNO rule): after drawing, you may play ONLY the drawn card (if playable) or pass.
    this.pendingDraw = null; // { playerId, cardIndex, canPlay }
  }

  updateUnoStateForPlayer(player) {
    // UNO state only matters while the player has exactly 1 card.
    if (!player) return;
    if (player.hand.length === 1) {
      if (this.unoCalled.has(player.id)) {
        this.unoVulnerable.delete(player.id);
      }
      return;
    }

    // Once hand is not 1, clear UNO-related state.
    this.unoCalled.delete(player.id);
    this.unoVulnerable.delete(player.id);
  }

  // Add player to game
  addPlayer(playerId, playerName) {
    if (this.hasStarted) throw new Error('Game already started');
    
    this.players.push({
      id: playerId,
      name: playerName,
      hand: [],
      isSafe: false
    });
  }

  // Remove player from game
  removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
    this.safePlayers = this.safePlayers.filter(p => p.id !== playerId);
    
    // If current player left, skip to next
    if (this.hasStarted && !this.isGameOver) {
      this.checkGameStatus();
    }
  }

  // Initialize deck
  initializeDeck() {
    this.deck = [];
    const colors = ['red', 'blue', 'green', 'yellow'];
    
    // Number cards (0-9)
    colors.forEach(color => {
      this.deck.push({ color, value: '0', type: 'number' }); // One 0 per color
      for (let i = 1; i <= 9; i++) {
        this.deck.push({ color, value: i.toString(), type: 'number' });
        this.deck.push({ color, value: i.toString(), type: 'number' }); // Two of each 1-9
      }
    });
    
    // Action cards (Skip, Reverse, +2)
    colors.forEach(color => {
      for (let i = 0; i < 2; i++) {
        this.deck.push({ color, value: 'skip', type: 'action' });
        this.deck.push({ color, value: 'reverse', type: 'action' });
        this.deck.push({ color, value: '+2', type: 'action' });
      }
    });
    
    // Wild cards
    for (let i = 0; i < 4; i++) {
      this.deck.push({ color: 'wild', value: 'wild', type: 'wild' });
      this.deck.push({ color: 'wild', value: '+4', type: 'wild' });
    }
    
    this.shuffleDeck();
  }

  // Shuffle deck
  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  // Deal cards to all players
  dealCards() {
    this.players.forEach(player => {
      player.hand = [];
      for (let i = 0; i < 7; i++) {
        player.hand.push(this.deck.pop());
      }
    });
    
    // Place first card on discard pile (ensure it's not a wild +4)
    let firstCard;
    do {
      firstCard = this.deck.pop();
    } while (firstCard.value === '+4');
    
    this.discardPile.push(firstCard);
    this.currentColor = firstCard.color === 'wild' ? 'red' : firstCard.color;
    
    // Handle first card effects
    if (firstCard.value === 'skip') {
      this.nextPlayer();
    } else if (firstCard.value === 'reverse') {
      this.direction *= -1;
    } else if (firstCard.value === '+2') {
      const nextPlayer = this.getNextPlayer();
      this.drawCardsForPlayer(nextPlayer, 2);
      this.nextPlayer();
    }
  }

  // Start the game
  startGame() {
    if (this.players.length < 2) throw new Error('Need at least 2 players');
    if (this.hasStarted) throw new Error('Game already started');
    
    this.initializeDeck();
    this.dealCards();
    this.hasStarted = true;
  }

  // Get current player
  getCurrentPlayer() {
    const activePlayers = this.players.filter(p => !p.isSafe);
    if (activePlayers.length === 0) return null;
    
    // Adjust index if needed
    while (this.currentPlayerIndex >= this.players.length || 
           this.players[this.currentPlayerIndex].isSafe) {
      this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    }
    
    return this.players[this.currentPlayerIndex];
  }

  // Get next active player
  getNextPlayer() {
    let nextIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    
    // Skip safe players
    while (this.players[nextIndex].isSafe) {
      nextIndex = (nextIndex + this.direction + this.players.length) % this.players.length;
    }
    
    return this.players[nextIndex];
  }

  // Move to next player
  nextPlayer() {
    this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    
    // Skip safe players
    while (this.players[this.currentPlayerIndex].isSafe) {
      this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    }
    
    // UNO call/vulnerability is tracked by hand-size transitions.
  }

  // Check if card can be played
  canPlayCard(card, currentCard) {
    if (card.type === 'wild') return true;
    if (card.color === this.currentColor) return true;
    if (card.value === currentCard.value) return true;
    return false;
  }

  // Play a card
  playCard(playerId, cardIndex, chosenColor = null) {
    const currentPlayer = this.getCurrentPlayer();
    
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error('Not your turn');
    }
    
    const player = this.players.find(p => p.id === playerId);
    const card = player.hand[cardIndex];
    
    if (!card) throw new Error('Invalid card');
    
    const currentCard = this.discardPile[this.discardPile.length - 1];

    // If the player drew this turn and the drawn card is playable, they may only play that drawn card (or pass).
    if (this.pendingDraw && this.pendingDraw.playerId === playerId) {
      if (cardIndex !== this.pendingDraw.cardIndex) {
        throw new Error('After drawing, you may only play the drawn card or pass');
      }
      // Consuming the draw restriction now.
      this.pendingDraw = null;
    }
    
    if (!this.canPlayCard(card, currentCard)) {
      throw new Error('Cannot play this card');
    }
    
    // Validate Wild +4 (can only be played if no other valid card)
    if (card.value === '+4') {
      const hasValidCard = player.hand.some((c, i) => 
        i !== cardIndex && this.canPlayCard(c, currentCard) && c.value !== '+4'
      );
      if (hasValidCard) {
        throw new Error('Cannot play Wild +4 when you have a valid card');
      }
    }
    
    // Wild cards require color choice
    if (card.type === 'wild' && !chosenColor) {
      throw new Error('Must choose a color for wild card');
    }
    
    // Remove card from hand
    player.hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    
    // Set current color
    if (card.type === 'wild') {
      this.currentColor = chosenColor;
    } else {
      this.currentColor = card.color;
    }
    
    // Handle card effects
    this.handleCardEffect(card, player);

    // If the player now has exactly 1 card, they must have called UNO earlier (at 2 cards)
    // or they become challengeable.
    if (player.hand.length === 1) {
      if (!this.unoCalled.has(player.id)) {
        this.unoVulnerable.add(player.id);
      } else {
        this.unoVulnerable.delete(player.id);
      }
    } else {
      // If they didn't land on 1 card, clear UNO state.
      this.updateUnoStateForPlayer(player);
    }
    
    // Check if player is safe (finished all cards)
    let playerSafe = false;
    if (player.hand.length === 0) {
      player.isSafe = true;
      this.safePlayers.push({ id: player.id, name: player.name });
      playerSafe = true;
      this.updateUnoStateForPlayer(player);
    }
    
    // Move to next player
    this.nextPlayer();
    
    // Check if game is over
    const gameStatus = this.checkGameStatus();
    
    return {
      cardPlayed: card,
      playerSafe,
      gameOver: gameStatus.isGameOver,
      loser: gameStatus.loser,
      safePlayers: gameStatus.safePlayers
    };
  }

  // Handle card effects
  handleCardEffect(card, player) {
    const nextPlayer = this.getNextPlayer();
    
    switch (card.value) {
      case 'skip':
        this.nextPlayer(); // Skip the next player
        break;
        
      case 'reverse':
        if (this.players.filter(p => !p.isSafe).length === 2) {
          // With 2 players, reverse acts like skip
          this.nextPlayer();
        } else {
          this.direction *= -1;
        }
        break;
        
      case '+2':
        this.drawCardsForPlayer(nextPlayer, 2);
        this.nextPlayer(); // Next player loses turn
        break;
        
      case '+4':
        this.drawCardsForPlayer(nextPlayer, 4);
        this.nextPlayer(); // Next player loses turn
        break;
        
      case '7':
        if (this.settings.sevenZeroRule) {
          // TODO: Implement swap hands logic
        }
        break;
        
      case '0':
        if (this.settings.sevenZeroRule) {
          // TODO: Implement rotate hands logic
        }
        break;
    }
  }

  // Draw cards for a specific player
  drawCardsForPlayer(player, count) {
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) {
        this.reshuffleDiscardPile();
      }
      if (this.deck.length > 0) {
        player.hand.push(this.deck.pop());
      }
    }

    this.updateUnoStateForPlayer(player);
  }

  // Draw a card
  drawCard(playerId) {
    const currentPlayer = this.getCurrentPlayer();
    
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error('Not your turn');
    }

    if (this.pendingDraw && this.pendingDraw.playerId === playerId) {
      throw new Error('You already drew a card. Play it (if possible) or pass');
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');

    const currentCard = this.discardPile[this.discardPile.length - 1];

    // House rule requested: only draw if you have no playable card.
    const hasPlayableCard = player.hand.some(c => this.canPlayCard(c, currentCard));
    if (hasPlayableCard) {
      throw new Error('You have a playable card. You cannot draw');
    }
    
    if (this.deck.length === 0) {
      this.reshuffleDiscardPile();
    }
    
    if (this.deck.length === 0) {
      throw new Error('No cards left to draw');
    }

    player.hand.push(this.deck.pop());
    this.updateUnoStateForPlayer(player);

    const drawnCardIndex = player.hand.length - 1;
    const drawnCard = player.hand[drawnCardIndex];
    const canPlayDrawnCard = this.canPlayCard(drawnCard, currentCard);

    if (canPlayDrawnCard) {
      this.pendingDraw = { playerId, cardIndex: drawnCardIndex, canPlay: true };
      return { drawnCard, drawnCardIndex, canPlayDrawnCard: true, turnContinues: true };
    }

    // If the drawn card cannot be played, the turn ends immediately.
    this.pendingDraw = null;
    this.nextPlayer();
    return { drawnCard, drawnCardIndex, canPlayDrawnCard: false, turnContinues: false };
  }

  // Pass after drawing a playable card (keep it and end turn)
  passTurnAfterDraw(playerId) {
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error('Not your turn');
    }

    if (!this.pendingDraw || this.pendingDraw.playerId !== playerId) {
      throw new Error('Nothing to pass. Draw a card first');
    }

    this.pendingDraw = null;
    this.nextPlayer();
  }

  // Reshuffle discard pile into deck
  reshuffleDiscardPile() {
    if (this.discardPile.length <= 1) return;
    
    const topCard = this.discardPile.pop();
    this.deck = [...this.discardPile];
    this.discardPile = [topCard];
    this.shuffleDeck();
  }

  // Say UNO
  sayUno(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // Support both common flows:
    // - "Early" UNO at 2 cards (on your turn)
    // - Standard UNO at 1 card (after you play down to 1), while you are vulnerable

    if (player.hand.length === 2) {
      const currentPlayer = this.getCurrentPlayer();
      if (!currentPlayer || currentPlayer.id !== playerId) {
        throw new Error('Not your turn');
      }

      this.unoCalled.add(playerId);
      this.unoVulnerable.delete(playerId);
      return;
    }

    if (player.hand.length === 1) {
      if (!this.unoVulnerable.has(playerId)) {
        throw new Error('You cannot say UNO right now');
      }

      this.unoCalled.add(playerId);
      this.unoVulnerable.delete(playerId);
      return;
    }

    throw new Error('You can only say UNO when you have 1 or 2 cards');
  }

  // Challenge UNO (penalize player who didn't call UNO with 1 card)
  challengeUno(targetPlayerId) {
    const target = this.players.find(p => p.id === targetPlayerId);
    if (!target) return false;
    
    // If player has 1 card and didn't call UNO
    if (
      target.hand.length === 1 &&
      this.unoVulnerable.has(targetPlayerId) &&
      !this.unoCalled.has(targetPlayerId)
    ) {
      this.drawCardsForPlayer(target, 4); // Penalty: draw 4 cards
      return true;
    }
    return false;
  }

  // Check if game is over (only one player remaining)
  checkGameStatus() {
    const activePlayers = this.players.filter(p => !p.isSafe);
    
    if (activePlayers.length === 1) {
      this.isGameOver = true;
      this.loser = { 
        id: activePlayers[0].id, 
        name: activePlayers[0].name 
      };
      return {
        isGameOver: true,
        loser: this.loser,
        safePlayers: this.safePlayers
      };
    }
    
    return { isGameOver: false };
  }

  // Get game state (filtered per player)
  getGameState() {
    const currentPlayer = this.getCurrentPlayer();
    const topCard = this.discardPile[this.discardPile.length - 1];
    
    return {
      roomCode: this.roomCode,
      hasStarted: this.hasStarted,
      isGameOver: this.isGameOver,
      loser: this.loser,
      currentPlayerId: currentPlayer ? currentPlayer.id : null,
      currentColor: this.currentColor,
      direction: this.direction,
      topCard: topCard,
      deckSize: this.deck.length,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        isSafe: p.isSafe,
        hasCalledUno: this.unoCalled.has(p.id)
      })),
      safePlayers: this.safePlayers,
      settings: this.settings
    };
  }

  // Get player's hand (only for specific player)
  getPlayerHand(playerId) {
    const player = this.players.find(p => p.id === playerId);
    return player ? player.hand : [];
  }
}

module.exports = Game;
