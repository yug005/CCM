// Color Clash Game Logic - Server-authoritative

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
    this.currentSide = 'light'; // for Switch mode
    this.hasStarted = false;
    this.isGameOver = false;
    this.loser = null;
    
    const resolvedMode = settings.gameMode || 'classic';

    // Game settings (configurable variations)
    // NOTE: Variations are not allowed in Switch mode.
    this.settings = {
      stackPlusTwoFour: resolvedMode === 'flip' ? false : (settings.stackPlusTwoFour || false),
      sevenZeroRule: resolvedMode === 'flip' ? false : (settings.sevenZeroRule || false),
      gameMode: resolvedMode,
      turnTimer: settings.turnTimer || 0, // 0 = no timer
      ...settings
    };

    // Draw stack state when stacking +2/+4 is enabled
    // { count: number, lastValue: '+2' | '+4' }
    this.drawStack = null;
    
    // Call tracking
    this.clashCalled = new Set(); // Players who properly called CLASH for their current 1-card state
    this.clashVulnerable = new Set(); // Players who ended a turn with 1 card and did NOT call CLASH

    // Draw-then-play flow: after drawing, you may play ONLY the drawn card (if playable) or pass.
    this.pendingDraw = null; // { playerId, cardIndex, canPlay }
  }

  playerCanRespondToDrawStack(player) {
    if (!player || !this.drawStack || !this.settings.stackPlusTwoFour) return false;
    const needed = this.drawStack.lastValue;
    if (!needed) return false;
    return player.hand.some(c => {
      const f = this.getActiveCardFace(c);
      return f && f.value === needed;
    });
  }

  // If a draw stack is pending and the current player cannot stack, auto-draw the penalty and
  // advance the turn. Returns an effect payload for UI animations.
  autoResolveDrawStackIfForced() {
    if (!this.drawStack || !this.settings.stackPlusTwoFour) return null;

    const current = this.getCurrentPlayer();
    if (!current) return null;

    if (this.playerCanRespondToDrawStack(current)) {
      // Player has a choice: stack or accept by drawing.
      return null;
    }

    const count = this.drawStack.count || 0;
    const lastValue = this.drawStack.lastValue;
    if (count <= 0) {
      this.drawStack = null;
      return null;
    }

    this.drawCardsForPlayer(current, count);
    this.drawStack = null;
    this.pendingDraw = null;

    // Taking the penalty ends the turn.
    this.nextPlayer();

    return {
      playerId: current.id,
      playerName: current.name,
      count,
      reason: lastValue || 'stack-penalty'
    };
  }

  updateCallStateForPlayer(player) {
    // Call state only matters while the player has exactly 1 card.
    if (!player) return;
    if (player.hand.length === 1) {
      if (this.clashCalled.has(player.id)) {
        this.clashVulnerable.delete(player.id);
      }
      return;
    }

    // Once hand is not 1, clear call-related state.
    this.clashCalled.delete(player.id);
    this.clashVulnerable.delete(player.id);
  }

  // Add player to game
  addPlayer(playerId, playerName) {
    if (this.hasStarted) throw new Error('Game already started');
    
    this.players.push({
      id: playerId,
      name: playerName,
      hand: [],
      isSafe: false,
      wins: 0
    });
  }

  // Start a new round while keeping the same room + players.
  restartRound() {
    if (this.players.length < 2) throw new Error('Need at least 2 players');

    // Reset round state (preserve players + wins)
    this.safePlayers = [];
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.currentColor = null;
    this.hasStarted = false;
    this.isGameOver = false;
    this.loser = null;

    this.clashCalled = new Set();
    this.clashVulnerable = new Set();
    this.pendingDraw = null;

    this.players.forEach(p => {
      p.hand = [];
      p.isSafe = false;
    });

    // Reuse normal start flow
    this.startGame();
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
    const mode = this.settings.gameMode || 'classic';
    const colors = ['red', 'blue', 'green', 'yellow'];

    // Switch mode: 112 two-sided cards with Light + Dark faces.
    if (mode === 'flip') {
      const darkColorMap = {
        red: 'pink',
        blue: 'teal',
        green: 'purple',
        yellow: 'orange'
      };

      const pushTwoSided = (lightCard, darkCard) => {
        this.deck.push({ light: lightCard, dark: darkCard });
      };

      // Numbers 1-9 in each color, 2 copies each.
      colors.forEach(color => {
        const darkColor = darkColorMap[color];
        for (let i = 1; i <= 9; i++) {
          for (let c = 0; c < 2; c++) {
            pushTwoSided(
              { color, value: i.toString(), type: 'number' },
              { color: darkColor, value: i.toString(), type: 'number' }
            );
          }
        }
      });

      // Action cards: 2 per color.
      // Light: draw1, reverse, skip, flip
      // Dark:  draw5, reverse, skipEveryone, flip
      colors.forEach(color => {
        const darkColor = darkColorMap[color];
        for (let i = 0; i < 2; i++) {
          pushTwoSided(
            { color, value: 'draw1', type: 'action' },
            { color: darkColor, value: 'draw5', type: 'action' }
          );
          pushTwoSided(
            { color, value: 'reverse', type: 'action' },
            { color: darkColor, value: 'reverse', type: 'action' }
          );
          pushTwoSided(
            { color, value: 'skip', type: 'action' },
            { color: darkColor, value: 'skipEveryone', type: 'action' }
          );
          pushTwoSided(
            { color, value: 'flip', type: 'action' },
            { color: darkColor, value: 'flip', type: 'action' }
          );
        }
      });

      // Wild cards
      for (let i = 0; i < 4; i++) {
        pushTwoSided(
          { color: 'wild', value: 'wild', type: 'wild' },
          { color: 'wild', value: 'wild', type: 'wild' }
        );
        pushTwoSided(
          { color: 'wild', value: 'wd2', type: 'wild' },
          { color: 'wild', value: 'wdc', type: 'wild' }
        );
      }

      this.shuffleDeck();
      return;
    }
    
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
    
    // Place first card on discard pile (avoid wilds which require color selection)
    let firstCard;
    do {
      firstCard = this.deck.pop();
    } while (this.getActiveCardFace(firstCard).type === 'wild');
    
    this.discardPile.push(firstCard);
    const firstFace = this.getActiveCardFace(firstCard);
    this.currentColor = firstFace.color === 'wild' ? 'red' : firstFace.color;
    
    // Handle first card effects as if played.
    const firstEffect = this.handleCardEffect(firstCard, this.getCurrentPlayer(), { isSetup: true });
    const steps = typeof firstEffect.advanceBy === 'number' ? firstEffect.advanceBy : 1;
    for (let i = 0; i < steps; i++) {
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
    
    // Call/vulnerability is tracked by hand-size transitions.
  }

  getActiveCardFace(card) {
    const mode = this.settings.gameMode || 'classic';
    if (mode !== 'flip') return card;
    if (!card) return card;
    return card[this.currentSide] || card.light || card.dark;
  }

  // Check if card can be played
  canPlayCard(card, currentCard) {
    const face = this.getActiveCardFace(card);
    const currentFace = this.getActiveCardFace(currentCard);
    if (!face || !currentFace) return false;

    // If stacking is active, only +2/+4 may be played to continue the stack.
    if ((this.settings.gameMode || 'classic') !== 'flip' && this.drawStack && this.settings.stackPlusTwoFour) {
      // Enforce same-type stacking: +2 stacks with +2, +4 stacks with +4.
      return face.value === this.drawStack.lastValue;
    }

    if (face.type === 'wild') return true;
    if (face.color === this.currentColor) return true;
    if (face.value === currentFace.value) return true;
    return false;
  }

  // Play a card
  playCard(playerId, cardIndex, chosenColor = null, extra = {}) {
    const currentPlayer = this.getCurrentPlayer();
    
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error('Not your turn');
    }
    
    const player = this.players.find(p => p.id === playerId);
    const card = player.hand[cardIndex];
    
    if (!card) throw new Error('Invalid card');
    
    const currentCard = this.discardPile[this.discardPile.length - 1];
    const cardFace = this.getActiveCardFace(card);
    const currentFace = this.getActiveCardFace(currentCard);

    // If the player drew this turn and the drawn card is playable, they may only play that drawn card (or pass).
    if (this.pendingDraw && this.pendingDraw.playerId === playerId) {
      if (cardIndex !== this.pendingDraw.cardIndex) {
        throw new Error('After drawing, you may only play the drawn card or pass');
      }
      // Consuming the draw restriction now.
      this.pendingDraw = null;
    }
    
    // If a draw stack is active, you may only respond with the same draw card.
    if ((this.settings.gameMode || 'classic') !== 'flip' && this.drawStack && this.settings.stackPlusTwoFour) {
      if (!(cardFace.value === '+2' || cardFace.value === '+4')) {
        throw new Error('You must stack the same draw card or draw the penalty');
      }
      if (this.drawStack.lastValue && cardFace.value !== this.drawStack.lastValue) {
        throw new Error(`You must stack ${this.drawStack.lastValue} or draw the penalty`);
      }
    }

    if (!this.canPlayCard(card, currentCard)) {
      throw new Error('Cannot play this card');
    }
    
    // Validate wild legality rules.
    // Classic +4: only if no other valid card (official).
    // Switch mode: Wild Draw Two / Wild Draw Color: only if no card of current color.
    if (cardFace.value === '+4') {
      // When stacking is active and we're responding to a +4 stack, allow +4 regardless
      // of whether other playable cards exist (house rule stacking behavior).
      const isRespondingToPlusFourStack =
        this.drawStack && this.settings.stackPlusTwoFour && this.drawStack.lastValue === '+4';
      if (isRespondingToPlusFourStack) {
        // no-op
      } else {
      const hasValidCard = player.hand.some((c, i) => {
        if (i === cardIndex) return false;
        const f = this.getActiveCardFace(c);
        return this.canPlayCard(c, currentCard) && f && f.value !== '+4';
      });
      if (hasValidCard) {
        throw new Error('Cannot play Wild +4 when you have a valid card');
      }
      }
    }

    if ((this.settings.gameMode || 'classic') === 'flip' && (cardFace.value === 'wd2' || cardFace.value === 'wdc')) {
      const hasCurrentColor = player.hand.some((c, i) => {
        if (i === cardIndex) return false;
        const f = this.getActiveCardFace(c);
        return f && f.color === this.currentColor;
      });
      if (hasCurrentColor) {
        throw new Error('Cannot play this Wild Draw card when you have a card of the current color');
      }
    }
    
    // Wild cards require color choice
    if (cardFace.type === 'wild' && !chosenColor) {
      throw new Error('Must choose a color for wild card');
    }
    
    // Remove card from hand
    player.hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    
    // Set current color
    if (cardFace.type === 'wild') {
      this.currentColor = chosenColor;
      // Persist chosen color on the physical card so it can be restored if it becomes top again.
      try { card._chosenColor = chosenColor; } catch (e) { /* ignore */ }
    } else {
      this.currentColor = cardFace.color;
    }
    
    // Handle card effects (and how many turns to advance)
    const effectResult = this.handleCardEffect(card, player, extra);
    let effect = effectResult.effect;
    const advanceBy = effectResult.advanceBy;

    // If the player now has exactly 1 card, they must have called earlier (at 2 cards)
    // or they become challengeable.
    if (player.hand.length === 1) {
      if (!this.clashCalled.has(player.id)) {
        this.clashVulnerable.add(player.id);
      } else {
        this.clashVulnerable.delete(player.id);
      }
    } else {
      // If they didn't land on 1 card, clear call state.
      this.updateCallStateForPlayer(player);
    }
    
    // Check if player is safe (finished all cards)
    let playerSafe = false;
    if (player.hand.length === 0) {
      player.isSafe = true;
      this.safePlayers.push({ id: player.id, name: player.name });
      playerSafe = true;
      this.updateCallStateForPlayer(player);
    }
    
    // Move to next player (some effects advance an extra step)
    const steps = typeof advanceBy === 'number' ? advanceBy : 1;
    for (let i = 0; i < steps; i++) {
      this.nextPlayer();
    }

    // If stacking is enabled and the next player cannot respond to the stack,
    // auto-apply the penalty draw and advance again.
    if ((this.settings.gameMode || 'classic') !== 'flip' && this.drawStack && this.settings.stackPlusTwoFour) {
      const autoDrawn = this.autoResolveDrawStackIfForced();
      if (autoDrawn) {
        // Ensure effect is always an object when we append.
        if (!effect || typeof effect !== 'object') effect = {};
        effect.autoDrawn = autoDrawn;
      }
    }
    
    // Check if game is over
    const gameStatus = this.checkGameStatus();
    
    return {
      cardPlayed: card,
      effect,
      playerSafe,
      gameOver: gameStatus.isGameOver,
      loser: gameStatus.loser,
      safePlayers: gameStatus.safePlayers
    };
  }

  // Handle card effects
  handleCardEffect(card, player, extra = {}) {
    const nextPlayer = this.getNextPlayer();
    const effect = {};
    let advanceBy = 1;
    const face = this.getActiveCardFace(card);
    const mode = this.settings.gameMode || 'classic';
    
    switch (face.value) {
      case 'skip':
        // Skip the next player (advance two turns total)
        advanceBy = 2;
        break;
        
      case 'reverse':
        if (this.players.filter(p => !p.isSafe).length === 2) {
          // With 2 players, reverse acts like skip
          advanceBy = 2;
        } else {
          this.direction *= -1;
        }
        break;
        
      case '+2':
        if (this.settings.stackPlusTwoFour) {
          const prev = this.drawStack && this.drawStack.lastValue === '+2' ? this.drawStack.count : 0;
          this.drawStack = { count: prev + 2, lastValue: '+2' };
          effect.drawStack = { count: this.drawStack.count };
          // Let next player respond to the stack
          advanceBy = 1;
        } else {
          this.drawCardsForPlayer(nextPlayer, 2);
          effect.drawn = { playerId: nextPlayer.id, playerName: nextPlayer.name, count: 2, reason: '+2' };
          // Next player loses turn
          advanceBy = 2;
        }
        break;
        
      case '+4':
        if (this.settings.stackPlusTwoFour) {
          const prev = this.drawStack && this.drawStack.lastValue === '+4' ? this.drawStack.count : 0;
          this.drawStack = { count: prev + 4, lastValue: '+4' };
          effect.drawStack = { count: this.drawStack.count };
          // Let next player respond to the stack
          advanceBy = 1;
        } else {
          this.drawCardsForPlayer(nextPlayer, 4);
          effect.drawn = { playerId: nextPlayer.id, playerName: nextPlayer.name, count: 4, reason: '+4' };
          // Next player loses turn
          advanceBy = 2;
        }
        break;

      case 'draw1':
        // Switch mode (Light): next player draws 1 and is skipped.
        this.drawCardsForPlayer(nextPlayer, 1);
        effect.drawn = { playerId: nextPlayer.id, playerName: nextPlayer.name, count: 1, reason: 'draw1' };
        advanceBy = 2;
        break;

      case 'draw5':
        // Switch mode (Dark): next player draws 5 and is skipped.
        this.drawCardsForPlayer(nextPlayer, 5);
        effect.drawn = { playerId: nextPlayer.id, playerName: nextPlayer.name, count: 5, reason: 'draw5' };
        advanceBy = 2;
        break;

      case 'skipEveryone':
        // Switch mode (Dark): all other players are skipped and the player plays again.
        advanceBy = 0;
        break;

      case 'wd2':
        // Switch mode (Light): choose color; next player draws 2 and is skipped.
        this.drawCardsForPlayer(nextPlayer, 2);
        effect.drawn = { playerId: nextPlayer.id, playerName: nextPlayer.name, count: 2, reason: 'wd2' };
        advanceBy = 2;
        break;

      case 'wdc': {
        // Switch mode (Dark): choose color; next player draws until they draw that color, then is skipped.
        const targetColor = this.currentColor;
        let drawnCount = 0;
        while (true) {
          if (this.deck.length === 0) {
            this.reshuffleDiscardPile();
          }
          if (this.deck.length === 0) break;

          const drawn = this.deck.pop();
          nextPlayer.hand.push(drawn);
          drawnCount += 1;

          const drawnFace = this.getActiveCardFace(drawn);
          if (drawnFace && drawnFace.color === targetColor) {
            break;
          }
        }
        this.updateCallStateForPlayer(nextPlayer);
        effect.drawn = { playerId: nextPlayer.id, playerName: nextPlayer.name, count: drawnCount, reason: 'wdc' };
        advanceBy = 2;
        break;
      }

      case 'flip':
        if (mode === 'flip') {
          this.flipAll();
          effect.flipped = { side: this.currentSide };
          // Continue to next player after flip.
          advanceBy = 1;
        }
        break;
        
      case '7':
        if (mode !== 'flip' && this.settings.sevenZeroRule) {
          // Simplified: swap hands with next active player
          const other = nextPlayer;
          const tmp = player.hand;
          player.hand = other.hand;
          other.hand = tmp;
          effect.swap = { a: player.id, b: other.id };
        }
        break;
        
      case '0':
        if (mode !== 'flip' && this.settings.sevenZeroRule) {
          // Rotate all active players' hands in the current direction
          const active = this.players.filter(p => !p.isSafe);
          if (active.length >= 2) {
            const hands = active.map(p => p.hand);
            if (this.direction === 1) {
              // clockwise: each gets previous player's hand
              for (let i = 0; i < active.length; i++) {
                active[(i + 1) % active.length].hand = hands[i];
              }
            } else {
              // counter-clockwise
              for (let i = 0; i < active.length; i++) {
                active[(i - 1 + active.length) % active.length].hand = hands[i];
              }
            }
            effect.rotate = true;
          }
        }
        break;
    }

    return {
      effect: Object.keys(effect).length ? effect : null,
      advanceBy
    };
  }

  // Switch mode: flip hands + draw pile + discard pile.
  // We model the physical flip by toggling the active side and reversing the piles
  // (top becomes bottom).
  flipAll() {
    this.currentSide = this.currentSide === 'light' ? 'dark' : 'light';

    // Flip piles (top becomes bottom)
    this.deck.reverse();
    this.discardPile.reverse();

    const topRaw = this.discardPile[this.discardPile.length - 1];
    const topFace = this.getActiveCardFace(topRaw);
    if (topFace) {
      if (topFace.type === 'wild') {
        // Restore chosen color if we have it; otherwise keep currentColor.
        const stored = topRaw && topRaw._chosenColor;
        if (stored) this.currentColor = stored;
      } else {
        this.currentColor = topFace.color;
      }
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

    this.updateCallStateForPlayer(player);
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

    const mode = this.settings.gameMode || 'classic';

    // If stacking is active, drawing means taking the full penalty.
    if (mode !== 'flip' && this.drawStack && this.settings.stackPlusTwoFour) {
      const count = this.drawStack.count || 0;
      if (count <= 0) {
        this.drawStack = null;
      } else {
        this.drawCardsForPlayer(player, count);
        this.drawStack = null;
        this.nextPlayer();
        return { drawnCount: count, reason: 'stack-penalty', turnContinues: false };
      }
    }

    // Switch mode: you may choose to draw even if you have a playable card.
    // Classic: keep existing house rule.
    if (mode !== 'flip') {
      const hasPlayableCard = player.hand.some(c => this.canPlayCard(c, currentCard));
      if (hasPlayableCard) {
        throw new Error('You have a playable card. You cannot draw');
      }
    }
    
    if (this.deck.length === 0) {
      this.reshuffleDiscardPile();
    }
    
    if (this.deck.length === 0) {
      throw new Error('No cards left to draw');
    }

    player.hand.push(this.deck.pop());
    this.updateCallStateForPlayer(player);

    const drawnCardIndex = player.hand.length - 1;
    const drawnCard = player.hand[drawnCardIndex];
    const canPlayDrawnCard = this.canPlayCard(drawnCard, currentCard);

    if (canPlayDrawnCard) {
      this.pendingDraw = { playerId, cardIndex: drawnCardIndex, canPlay: true };
      return { drawnCard, drawnCardIndex, drawnCount: 1, canPlayDrawnCard: true, turnContinues: true };
    }

    // If the drawn card cannot be played, the turn ends immediately.
    this.pendingDraw = null;
    this.nextPlayer();
    return { drawnCard, drawnCardIndex, drawnCount: 1, canPlayDrawnCard: false, turnContinues: false };
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

  // Call CLASH
  callClash(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // Support both common flows:
    // - "Early" call at 2 cards (on your turn)
    // - Standard call at 1 card (after you play down to 1), while you are vulnerable

    if (player.hand.length === 2) {
      const currentPlayer = this.getCurrentPlayer();
      if (!currentPlayer || currentPlayer.id !== playerId) {
        throw new Error('Not your turn');
      }

      this.clashCalled.add(playerId);
      this.clashVulnerable.delete(playerId);
      return;
    }

    if (player.hand.length === 1) {
      if (!this.clashVulnerable.has(playerId)) {
        throw new Error('You cannot call CLASH right now');
      }

      this.clashCalled.add(playerId);
      this.clashVulnerable.delete(playerId);
      return;
    }

    throw new Error('You can only call CLASH when you have 1 or 2 cards');
  }

  // Challenge call (penalize player who didn't call CLASH with 1 card)
  challengeCall(targetPlayerId) {
    const target = this.players.find(p => p.id === targetPlayerId);
    if (!target) return false;
    
    // If player has 1 card and didn't call CLASH
    if (
      target.hand.length === 1 &&
      this.clashVulnerable.has(targetPlayerId) &&
      !this.clashCalled.has(targetPlayerId)
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
      if (!this.isGameOver) {
        this.isGameOver = true;
        this.loser = {
          id: activePlayers[0].id,
          name: activePlayers[0].name
        };

        // Award wins to everyone except the loser (i.e., players who became safe).
        const winnerIds = new Set(this.safePlayers.map(p => p.id));
        this.players.forEach(p => {
          if (winnerIds.has(p.id)) {
            p.wins = (typeof p.wins === 'number' ? p.wins : 0) + 1;
          }
        });
      }
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
    const topCardRaw = this.discardPile[this.discardPile.length - 1];
    const topCard = this.getActiveCardFace(topCardRaw);
    
    return {
      roomCode: this.roomCode,
      hasStarted: this.hasStarted,
      isGameOver: this.isGameOver,
      loser: this.loser,
      currentPlayerId: currentPlayer ? currentPlayer.id : null,
      currentColor: this.currentColor,
      currentSide: this.currentSide,
      direction: this.direction,
      topCard: topCard,
      deckSize: this.deck.length,
      drawStackCount: this.drawStack && this.settings.stackPlusTwoFour ? this.drawStack.count : 0,
      drawStackType: this.drawStack && this.settings.stackPlusTwoFour ? this.drawStack.lastValue : null,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        isSafe: p.isSafe,
        hasCalledClash: this.clashCalled.has(p.id),
        wins: typeof p.wins === 'number' ? p.wins : 0
      })),
      safePlayers: this.safePlayers,
      settings: this.settings
    };
  }

  // Get player's hand (only for specific player)
  getPlayerHand(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return [];
    if ((this.settings.gameMode || 'classic') !== 'flip') return player.hand;
    return player.hand.map(c => this.getActiveCardFace(c));
  }
}

module.exports = Game;
