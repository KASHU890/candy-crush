(() => {
  'use strict';

  const ROWS = 8;
  const COLS = 8;
  const CANDIES = [
    { emoji: '🍎', color: '#ff5a5a' },
    { emoji: '🍇', color: '#9b5afe' },
    { emoji: '🍩', color: '#ffb347' },
    { emoji: '🍓', color: '#ff8fab' },
    { emoji: '🍊', color: '#ff914d' },
    { emoji: '🍒', color: '#e63946' },
  ];
  const COLORS = CANDIES.map(c => c.color);

  const state = {
    board: [],
    selected: null,
    score: 0,
    moves: 30,
    level: 1,
    target: 1000,
    busy: false,
    running: false,
    firstMatch: true,
  };

  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const movesEl = document.getElementById('moves');
  const levelEl = document.getElementById('level');
  const targetEl = document.getElementById('target');
  const progressEl = document.getElementById('progressFill');
  const overlayEl = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const overlayBtn = document.getElementById('overlayBtn');
  const restartBtn = document.getElementById('restartBtn');

  // ---------- Audio (Web Audio API, no files needed) ----------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function blipTone(freq, dur = 0.08, type = 'sine', vol = 0.15) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  }

  const sounds = {
    select: () => blipTone(620, 0.06, 'triangle', 0.1),
    swap: () => blipTone(380, 0.07, 'sine', 0.1),
    bad: () => { blipTone(160, 0.12, 'sawtooth', 0.08); },
    match: (n) => blipTone(520 + n * 90, 0.1, 'square', 0.09),
    combo: (n) => blipTone(400 + n * 120, 0.12, 'triangle', 0.12),
    win: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blipTone(f, 0.18, 'triangle', 0.14), i * 130)); },
    lose: () => { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => blipTone(f, 0.2, 'sawtooth', 0.1), i * 160)); },
  };

  // ---------- Board creation ----------
  function randomCandy() {
    return Math.floor(Math.random() * CANDIES.length);
  }

  function createBoard() {
    const grid = [];
    for (let r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (let c = 0; c < COLS; c++) {
        do { grid[r][c] = randomCandy(); }
        while (isPartOfMatch(grid, r, c));
      }
    }
    return grid;
  }

  function isPartOfMatch(grid, r, c) {
    const v = grid[r][c];
    if (v === undefined) return false;
    if (c >= 2 && grid[r][c - 1] === v && grid[r][c - 2] === v) return true;
    if (r >= 2 && grid[r - 1][c] === v && grid[r - 2][c] === v) return true;
    return false;
  }

  // ---------- Rendering ----------
  function render() {
    boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.textContent = CANDIES[state.board[r][c]].emoji;
        cell.style.backgroundColor = COLORS[state.board[r][c]];
        boardEl.appendChild(cell);
      }
    }
  }

  function cellEl(r, c) {
    return boardEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  }

  function updateHud() {
    scoreEl.textContent = state.score.toLocaleString();
    movesEl.textContent = state.moves;
    levelEl.textContent = state.level;
    targetEl.textContent = state.target.toLocaleString();
    const pct = Math.min(100, Math.round((state.score / state.target) * 100));
    progressEl.style.width = pct + '%';
  }

  // ---------- Matching ----------
  function findAllMatches() {
    const matches = new Set();
    // horizontal
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 2; c++) {
        const v = state.board[r][c];
        if (v === null) continue;
        let len = 1;
        while (c + len < COLS && state.board[r][c + len] === v) len++;
        if (len >= 3) {
          for (let c2 = c; c2 < c + len; c2++) matches.add(`${r},${c2}`);
        }
        c += len - 1;
      }
    }
    // vertical
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS - 2; r++) {
        const v = state.board[r][c];
        if (v === null) continue;
        let len = 1;
        while (r + len < ROWS && state.board[r + len][c] === v) len++;
        if (len >= 3) {
          for (let r2 = r; r2 < r + len; r2++) matches.add(`${r2},${c}`);
        }
        r += len - 1;
      }
    }
    return [...matches].map(s => {
      const [r, c] = s.split(',').map(Number);
      return { r, c };
    });
  }

  function anyMovesLeft() {
    const b = state.board;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // try right
        if (c + 1 < COLS) {
          [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]];
          if (findAllMatches().length) { [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]]; return true; }
          [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]];
        }
        // try down
        if (r + 1 < ROWS) {
          [b[r][c], b[r + 1][c]] = [b[r + 1][c], b[r][c]];
          if (findAllMatches().length) { [b[r][c], b[r + 1][c]] = [b[r + 1][c], b[r][c]]; return true; }
          [b[r][c], b[r + 1][c]] = [b[r + 1][c], b[r][c]];
        }
      }
    }
    return false;
  }

  // ---------- Swap & flow ----------
  async function trySwap(r1, c1, r2, c2) {
    if (state.busy || !state.running) return;
    const b = state.board;
    [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]];

    const matches = findAllMatches();
    if (!matches.length) {
      // invalid swap, reverse
      [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]];
      sounds.bad();
      animateInvalid(r1, c1, r2, c2);
      return;
    }

    state.busy = true;
    state.selected = null;
    state.moves--;
    sounds.swap();

    // visually swap
    const el1 = cellEl(r1, c1);
    const el2 = cellEl(r2, c2);
    el1.classList.add('swap-anim');
    el2.classList.add('swap-anim');
    updateHud();
    await wait(60);
    render();
    const m = findAllMatches();
    await processMatches(m, 1);
    state.busy = false;
    updateHud();
    checkEndGame();
  }

  async function processMatches(matches, combo) {
    if (!matches.length) return;

    if (combo > 1) sounds.combo(combo);
    else sounds.match(matches.length);

    // pop animation
    for (const { r, c } of matches) {
      const el = cellEl(r, c);
      if (el) {
        el.classList.add('pop-anim');
        // clone stays visible while falling below
        const emoji = CANDIES[state.board[r][c]].emoji;
        const color = COLORS[state.board[r][c]];
        const ghost = document.createElement('div');
        ghost.className = 'cell pop-anim';
        ghost.textContent = emoji;
        ghost.style.backgroundColor = color;
        cellEl(r, c).parentNode.insertBefore(ghost, cellEl(r, c).nextSibling);
        setTimeout(() => ghost.remove(), 400);
      }
    }

    // score
    const gained = matches.length * 10 * combo;
    state.score += gained;
    if (state.firstMatch) {
      state.firstMatch = false;
      sounds.select();
    }
    updateHud();

    await wait(360);

    // mark removed
    for (const { r, c } of matches) state.board[r][c] = null;

    // gravity + refill
    applyGravity();
    refillBoard();

    render();
    updateHud();
    await wait(120);

    const next = findAllMatches();
    if (next.length) {
      await processMatches(next, combo + 1);
    }
  }

  function applyGravity() {
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (state.board[r][c] !== null) {
          state.board[write][c] = state.board[r][c];
          if (write !== r) state.board[r][c] = null;
          write--;
        }
      }
    }
  }

  function refillBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.board[r][c] === null) {
          state.board[r][c] = randomCandy();
        }
      }
    }
    // avoid leaving immediate matches
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isPartOfMatch(state.board, r, c)) {
          state.board[r][c] = randomCandy();
          if (isPartOfMatch(state.board, r, c)) {
            state.board[r][c] = (state.board[r][c] + 1) % CANDIES.length;
          }
        }
      }
    }
  }

  // ---------- Interaction ----------
  function handleCellClick(e) {
    if (!state.running || state.busy) return;
    ensureAudio();
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = +cell.dataset.row;
    const c = +cell.dataset.col;

    if (!state.selected) {
      state.selected = { r, c };
      cell.classList.add('selected');
      sounds.select();
      return;
    }

    const { r: sr, c: sc } = state.selected;
    const dist = Math.abs(r - sr) + Math.abs(c - sc);
    if (dist === 1) {
      // clear selection state then swap
      cellEl(sr, sc).classList.remove('selected');
      state.selected = null;
      trySwap(sr, sc, r, c);
    } else if (sr === r && sc === c) {
      cell.classList.remove('selected');
      state.selected = null;
    } else {
      cellEl(sr, sc).classList.remove('selected');
      state.selected = { r, c };
      cell.classList.add('selected');
      sounds.select();
    }
  }

  function animateInvalid(r1, c1, r2, c2) {
    const a = cellEl(r1, c1);
    const b = cellEl(r2, c2);
    for (const el of [a, b]) {
      el.style.transition = 'transform 0.12s ease';
      el.style.transform = 'translateX(-6px)';
      setTimeout(() => { el.style.transform = 'translateX(6px)'; }, 120);
      setTimeout(() => { el.style.transform = ''; }, 240);
    }
  }

  // ---------- Game flow ----------
  function startGame(reset) {
    ensureAudio();
    if (reset) {
      state.board = createBoard();
      state.score = 0;
      state.moves = 30;
      state.level = 1;
      state.target = 1000;
      state.firstMatch = true;
      state.selected = null;
      state.busy = false;
    }
    // handle no-move board
    if (!anyMovesLeft()) state.board = createBoard();
    state.running = true;
    render();
    updateHud();
    closeOverlay();
  }

  function closeOverlay() {
    overlayEl.classList.add('hidden');
  }

  function showOverlay(title, text, btnLabel) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = btnLabel;
    overlayEl.classList.remove('hidden');
  }

  function checkEndGame() {
    if (state.moves <= 0) {
      if (state.score >= state.target) {
        state.running = false;
        sounds.win();
        state.level++;
        state.moves = 30;
        state.target = Math.floor(state.target * 1.6);
        state.board = createBoard();
        if (!anyMovesLeft()) state.board = createBoard();
        render();
        updateHud();
        showOverlay('Level Complete! 🎉', `You reached ${state.score.toLocaleString()} points. Ready for Level ${state.level}?`, 'Next Level');
        overlayBtn.onclick = () => { state.firstMatch = true; startGame(false); };
      } else {
        state.running = false;
        sounds.lose();
        showOverlay('Out of Moves 😢', `Score: ${state.score.toLocaleString()} / Target: ${state.target.toLocaleString()}`, 'Try Again');
        overlayBtn.onclick = () => startGame(true);
      }
    }
  }

  // ---------- Helpers ----------
  function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  // ---------- Wire up ----------
  boardEl.addEventListener('click', handleCellClick);

  overlayBtn.addEventListener('click', () => {
    ensureAudio();
    if (!state.running) startGame(true);
  });

  restartBtn.addEventListener('click', () => {
    ensureAudio();
    startGame(true);
  });

  // initial build
  state.board = createBoard();
  startGame(true);
})();