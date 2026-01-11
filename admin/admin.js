/* global io */

(function () {
  const statusPill = document.getElementById('statusPill');
  const roomsContainer = document.getElementById('roomsContainer');
  const roomsSummary = document.getElementById('roomsSummary');
  const refreshBtn = document.getElementById('refreshBtn');

  function getToken() {
    const url = new URL(window.location.href);
    const tokenFromUrl = url.searchParams.get('token');
    if (tokenFromUrl) {
      localStorage.setItem('cc_admin_token', tokenFromUrl);
      return tokenFromUrl;
    }
    return localStorage.getItem('cc_admin_token') || '';
  }

  function setPill(text, ok) {
    if (!statusPill) return;
    statusPill.textContent = text;
    statusPill.classList.remove('ok', 'bad');
    statusPill.classList.add(ok ? 'ok' : 'bad');
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  const token = getToken();
  if (!token) {
    setPill('Missing token', false);
    if (roomsContainer) {
      roomsContainer.innerHTML = '<div class="muted">Open as <code>/admin?token=YOUR_ADMIN_TOKEN</code></div>';
    }
    return;
  }

  const adminSocket = io('/admin', {
    auth: { token }
  });

  adminSocket.on('connect', () => {
    setPill('Connected', true);
    adminSocket.emit('listRooms');
  });

  adminSocket.on('disconnect', () => {
    setPill('Disconnected', false);
  });

  adminSocket.on('connect_error', (err) => {
    setPill(err && err.message ? `Error: ${err.message}` : 'Error', false);
  });

  adminSocket.on('adminError', ({ message }) => {
    setPill(message || 'Admin error', false);
  });

  function roomTag(label, kind) {
    const cls = kind ? `tag ${kind}` : 'tag';
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }

  function render(snapshot) {
    const rooms = (snapshot && snapshot.rooms) || [];
    if (roomsSummary) {
      roomsSummary.textContent = `${rooms.length} room(s)`;
    }

    if (!roomsContainer) return;

    if (rooms.length === 0) {
      roomsContainer.innerHTML = '<div class="muted">No active rooms.</div>';
      return;
    }

    roomsContainer.innerHTML = rooms
      .map((room) => {
        const tags = [];
        tags.push(room.hasStarted ? roomTag('Started', 'ok') : roomTag('Lobby', 'warn'));
        if (room.isGameOver) tags.push(roomTag('Game Over', 'warn'));
        if (room.lobbyLocked) tags.push(roomTag('Locked', 'warn'));

        const playersHtml = (room.players || [])
          .map((p) => {
            const isHost = room.hostId && p.id === room.hostId;
            const status = p.status || (room.hasStarted ? 'playing' : 'lobby');
            const metaParts = [];
            metaParts.push(isHost ? 'host' : 'player');
            metaParts.push(`status=${status}`);
            if (typeof p.cardCount === 'number') metaParts.push(`cards=${p.cardCount}`);
            if (typeof p.wins === 'number') metaParts.push(`wins=${p.wins}`);

            return `
              <div class="player">
                <div class="playerLeft">
                  <div class="playerName">${escapeHtml(p.name)}${isHost ? ' (Host)' : ''}</div>
                  <div class="playerMeta">${escapeHtml(metaParts.join(' • '))}</div>
                </div>
                <div class="playerRight">
                  <button
                    class="btn danger"
                    data-action="kick"
                    data-room="${escapeHtml(room.roomCode)}"
                    data-player="${escapeHtml(p.id)}"
                    data-name="${escapeHtml(p.name)}"
                    title="Kick player"
                  >Kick</button>
                </div>
              </div>
            `;
          })
          .join('');

        return `
          <div class="room">
            <div class="roomTop">
              <div>
                <div class="roomCode">Room ${escapeHtml(room.roomCode)}</div>
                <div class="muted">Players: ${(room.players || []).length}</div>
              </div>
              <div class="tags">${tags.join('')}</div>
            </div>
            <div class="players">
              ${playersHtml}
            </div>
          </div>
        `;
      })
      .join('');
  }

  adminSocket.on('roomsList', (snapshot) => {
    render(snapshot);
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      adminSocket.emit('listRooms');
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="kick"]');
    if (!btn) return;

    const playerId = btn.getAttribute('data-player');
    const name = btn.getAttribute('data-name') || 'player';

    const message = window.prompt(`Kick ${name} with message:`, 'You were removed by the developer');
    if (message === null) return;

    adminSocket.emit('kickPlayer', {
      playerId,
      message: String(message)
    });
  });
})();
