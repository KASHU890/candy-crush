(() => {
  'use strict';

  const ROWS = 8;
  const COLS = 8;
  const SWIPE_THRESHOLD = 20;
  const CANDIES = [
    { emoji: '🍎', color: '#ff5a5a' },
    { emoji: '🍇', color: '#9b5afe' },
    { emoji: '🍩', color: '#ffb347' },
    { emoji: '🍓', color: '#ff8fab' },
    { emoji: '🍊', color: '#ff914d' },
    { emoji: '🍒', color: '#e63946' },
  ];
  const COLORS = CANDIES.map(c => c.color);

  // ---------- Level definitions (Candy Crush style) ----------
  const LEVELS = [];
  (function initLevels() {
    for (let i = 1; i <= 24; i++) {
      const target = Math.floor(800 * Math.pow(1.22, i - 1) / 10) * 10;
      const moves = Math.max(17, 32 - Math.floor((i - 1) / 2));
      const types = Math.min(6, 5 + Math.floor((i - 1) / 4));
      const base = { target, moves, types };
      if (i % 4 === 0 && i < 24) {
        base.collect = { candy: i % CANDIES.length, count: 12 + (i % 3) * 4 };
      }
      LEVELS.push(base);
    }
  })();

  function getLevelConfig(l) {
    const idx = Math.max(1, Math.min(LEVELS.length, l)) - 1;
    return Object.assign({}, LEVELS[idx]);
  }

  const state = {
    board: [],
    selected: null,
    score: 0,
    moves: 30,
    level: 1,
    target: 1000,
    candyTypes: 5,
    collected: 0,
    busy: false,
    running: false,
    firstMatch: true,
    save: { level: 1, best: {} },
  };

  const gameView = document.getElementById('gameView');
  const mapView = document.getElementById('mapView');
  const mapListEl = document.getElementById('mapList');
  const mapProgressEl = document.getElementById('mapProgress');
  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const movesEl = document.getElementById('moves');
  const levelEl = document.getElementById('level');
  const targetEl = document.getElementById('target');
  const targetLabelEl = document.querySelector('#targetBox .hud-label');
  const progressEl = document.getElementById('progressFill');
  const overlayEl = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const overlayStarsEl = document.getElementById('overlayStars');
  const overlayBtn = document.getElementById('overlayBtn');
  const overlayMapBtn = document.getElementById('overlayMapBtn');
  const mapBtn = document.getElementById('mapBtn');
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
    return Math.floor(Math.random() * state.candyTypes);
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

  // ---------- Levels & progress ----------
  function calcStars(score, target) {
    if (score >= Math.ceil(target * 1.5)) return 3;
    if (score >= Math.ceil(target * 1.25)) return 2;
    return 1;
  }

  function isGoalMet() {
    const cfg = getLevelConfig(state.level);
    if (cfg.collect) return state.collected >= cfg.collect.count;
    return state.score >= cfg.target;
  }

  function goalText(cfg) {
    if (cfg.collect) {
      return `Collect ${cfg.collect.count} ${CANDIES[cfg.collect.candy].emoji} in ${cfg.moves} moves.\nExtra score helps: ${cfg.target.toLocaleString()}`;
    }
    return `Reach ${cfg.target.toLocaleString()} points in ${cfg.moves} moves.`;
  }

  // optional test hook (?dbg in URL)
  if (window.location.search.indexOf('dbg') !== -1) {
    window.__game = {
      state,
      LEVELS,
      checkEndGame,
      calcStars,
      isGoalMet,
      goalText,
      enterLevel,
      openMap,
      trySwap,
      shuffleBoard,
      resolveIfStuck,
      createBoard,
      findAllMatches,
      anyMovesLeft,
      cascadePeak: () => cascadePeak,
    };
  }

  const SAVE_KEY = 'candyCrushSave';

  function loadProgress() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && typeof data.level === 'number') {
          const lvl = Math.max(1, Math.min(LEVELS.length, data.level));
          state.save = {
            level: lvl,
            best: (data.best && typeof data.best === 'object') ? data.best : {},
          };
          state.level = lvl;
        }
      }
    } catch (e) {
      state.save = { level: 1, best: {} };
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state.save));
    } catch (e) { /* private mode / quota: ignore */ }
  }

  function recordCompletion(level, score, stars) {
    const prev = state.save.best[level];
    if (!prev || score > prev.score) {
      state.save.best[level] = { score, stars };
    }
  }

  // ---------- Rendering ----------
  function render() {
    if (!state.board.length) {
      state.board = createBoard();
    }
    boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = state.board[r][c];
        if (v === null || v === undefined) {
          state.board[r][c] = randomCandy();
        }
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
    const cfg = getLevelConfig(state.level);
    scoreEl.textContent = state.score.toLocaleString();
    movesEl.textContent = state.moves;
    levelEl.textContent = state.level;
    let pct;
    if (cfg.collect) {
      targetLabelEl.textContent = 'Collect';
      targetEl.textContent = `${CANDIES[cfg.collect.candy].emoji} ${Math.min(state.collected, cfg.collect.count)}/${cfg.collect.count}`;
      pct = (state.collected / cfg.collect.count) * 100;
    } else {
      targetLabelEl.textContent = 'Target';
      targetEl.textContent = cfg.target.toLocaleString();
      pct = (state.score / cfg.target) * 100;
    }
    progressEl.style.width = Math.min(100, Math.round(pct)) + '%';
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
        if (c + 1 < COLS) {
          [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]];
          if (findAllMatches().length) { [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]]; return true; }
          [b[r][c], b[r][c + 1]] = [b[r][c + 1], b[r][c]];
        }
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
      [b[r1][c1], b[r2][c2]] = [b[r2][c2], b[r1][c1]];
      sounds.bad();
      animateInvalid(r1, c1, r2, c2);
      return;
    }

    state.busy = true;
    state.selected = null;
    state.moves--;
    sounds.swap();
    try {
      const el1 = cellEl(r1, c1);
      const el2 = cellEl(r2, c2);
      if (el1) el1.classList.add('swap-anim');
      if (el2) el2.classList.add('swap-anim');
      updateHud();
      await wait(60);
      render();
      const m = findAllMatches();
      await processMatches(m, 1);
    } catch (err) {
      console.warn('swap error', err);
    } finally {
      state.busy = false;
      updateHud();
      render();
      checkEndGame();
    }
  }

  async function processMatches(matches, combo) {
    if (!matches.length) return;

    if (combo > 1) sounds.combo(combo);
    else sounds.match(matches.length);
    if (combo > cascadePeak) cascadePeak = combo;

    // pop animation
    for (const { r, c } of matches) {
      if (state.board[r][c] === null || state.board[r][c] === undefined) continue;
      const el = cellEl(r, c);
      if (el) {
        el.classList.add('pop-anim');
        const emoji = CANDIES[state.board[r][c]].emoji;
        const color = COLORS[state.board[r][c]];
        const ghost = document.createElement('div');
        ghost.className = 'cell pop-anim';
        ghost.textContent = emoji;
        ghost.style.backgroundColor = color;
        if (el.parentNode && el.nextSibling) {
          el.parentNode.insertBefore(ghost, el.nextSibling);
          setTimeout(() => ghost.remove(), 400);
        }
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

    // mark removed + count collections
    const cfg = getLevelConfig(state.level);
    for (const { r, c } of matches) {
      if (cfg.collect && state.board[r][c] === cfg.collect.candy) {
        state.collected++;
      }
      state.board[r][c] = null;
    }

    // gravity + refill
    applyGravity();
    refillBoard();

    render();
    updateHud();
    await wait(120);

    const next = findAllMatches();
    if (next.length) {
      await processMatches(next, combo + 1);
    } else {
      const shuffled = resolveIfStuck();
      if (shuffled) await shuffled;
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
        if (state.board[r][c] === null || state.board[r][c] === undefined) {
          state.board[r][c] = randomCandy();
        }
      }
    }
  }

  async function shuffleBoard() {
    let tries = 0;
    do {
      state.board = createBoard();
      tries++;
    } while (!anyMovesLeft() && tries < 200);
    render();
    if (boardEl) {
      boardEl.classList.add('shuffle-anim');
      sounds.bad();
      await wait(500);
      boardEl.classList.remove('shuffle-anim');
    }
    updateHud();
  }

  function resolveIfStuck() {
    if (state.running && state.moves > 0 && !isGoalMet() && !anyMovesLeft()) {
      return shuffleBoard();
    }
    return null;
  }

  // Sync-able declared vars
  let cascadePeak = 0;

  // ---------- Interaction ----------
  let pointer = null;

  function clearSelection() {
    if (state.selected) {
      const el = cellEl(state.selected.r, state.selected.c);
      if (el) el.classList.remove('selected');
      state.selected = null;
    }
  }

  function handleTap(r, c, cell) {
    if (!state.running || state.busy) return;

    if (!state.selected) {
      state.selected = { r, c };
      cell.classList.add('selected');
      sounds.select();
      return;
    }

    const { r: sr, c: sc } = state.selected;
    const dist = Math.abs(r - sr) + Math.abs(c - sc);
    if (dist === 1) {
      clearSelection();
      trySwap(sr, sc, r, c);
    } else if (sr === r && sc === c) {
      cell.classList.remove('selected');
      state.selected = null;
    } else {
      const old = cellEl(sr, sc);
      if (old) old.classList.remove('selected');
      state.selected = { r, c };
      cell.classList.add('selected');
      sounds.select();
    }
  }

  function swapByDir(r, c, dr, dc) {
    const tr = r + dr;
    const tc = c + dc;
    if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return;
    clearSelection();
    trySwap(r, c, tr, tc);
  }

  function handleCellClick(e) {
    if (!state.running || state.busy) return;
    ensureAudio();
    const cell = e.target.closest('.cell');
    if (!cell) return;
    handleTap(+cell.dataset.row, +cell.dataset.col, cell);
  }

  if (window.PointerEvent) {
    boardEl.addEventListener('pointerdown', (e) => {
      if (!state.running || state.busy) return;
      ensureAudio();
      const cell = e.target.closest ? e.target.closest('.cell') : null;
      if (!cell) return;
      pointer = { r: +cell.dataset.row, c: +cell.dataset.col, x: e.clientX, y: e.clientY, moved: false };
      e.preventDefault();
    });

    boardEl.addEventListener('pointermove', (e) => {
      if (!pointer || state.busy) return;
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;
      pointer.moved = true;
      if (Math.abs(dx) >= Math.abs(dy)) swapByDir(pointer.r, pointer.c, 0, dx > 0 ? 1 : -1);
      else swapByDir(pointer.r, pointer.c, dy > 0 ? 1 : -1, 0);
      pointer = null;
    });

    boardEl.addEventListener('pointerup', (e) => {
      if (!pointer) return;
      const { r, c, moved } = pointer;
      const cell = e.target.closest ? e.target.closest('.cell') : null;
      pointer = null;
      if (moved || !cell) return;
      handleTap(r, c, cell);
    });

    boardEl.addEventListener('pointercancel', () => { pointer = null; });
    boardEl.addEventListener('lostpointercapture', () => { pointer = null; });
  } else {
    boardEl.addEventListener('click', handleCellClick);
  }

  function animateInvalid(r1, c1, r2, c2) {
    const a = cellEl(r1, c1);
    const b = cellEl(r2, c2);
    for (const el of [a, b]) {
      if (!el) continue;
      el.style.transition = 'transform 0.12s ease';
      el.style.transform = 'translateX(-6px)';
      setTimeout(() => { el.style.transform = 'translateX(6px)'; }, 120);
      setTimeout(() => { el.style.transform = ''; }, 240);
    }
  }

  // ---------- Game flow ----------
  function prepareLevel(lvl) {
    const cfg = getLevelConfig(lvl);
    state.level = lvl;
    state.score = 0;
    state.collected = 0;
    state.moves = cfg.moves;
    state.target = cfg.target;
    state.candyTypes = cfg.types;
    state.firstMatch = true;
    state.selected = null;
    state.busy = false;
    state.running = false;
    state.board = createBoard();
    let guard = 0;
    while (!anyMovesLeft() && guard < 200) {
      state.board = createBoard();
      guard++;
    }
  }

  function beginLevel() {
    state.running = true;
    closeOverlay();
  }

  function enterLevel(lvl, withIntro) {
    ensureAudio();
    prepareLevel(lvl);
    closeMap();
    render();
    updateHud();
    if (withIntro) showIntro();
    else beginLevel();
  }

  function startNewGame() {
    state.level = 1;
    state.save = { level: 1, best: {} };
    localStorage.removeItem(SAVE_KEY);
    enterLevel(1, false);
  }

  function closeOverlay() {
    overlayEl.classList.add('hidden');
    overlayMapBtn.classList.add('hidden');
  }

  function renderStars(stars) {
    let html = '';
    for (let i = 1; i <= 3; i++) {
      html += `<span class="star${i <= stars ? '' : ' star-empty'}">★</span>`;
    }
    overlayStarsEl.innerHTML = html;
    overlayStarsEl.classList.remove('hidden');
  }

  function showOverlay(title, text, primaryLabel, stars, secondaryLabel) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = primaryLabel;
    if (typeof stars === 'number') renderStars(stars);
    else overlayStarsEl.classList.add('hidden');
    if (secondaryLabel) {
      overlayMapBtn.textContent = secondaryLabel;
      overlayMapBtn.classList.remove('hidden');
    } else {
      overlayMapBtn.classList.add('hidden');
    }
    overlayEl.classList.remove('hidden');
  }

  function showIntro() {
    const cfg = getLevelConfig(state.level);
    showOverlay(`Level ${state.level}`, goalText(cfg), 'Play', undefined, 'Map');
    overlayBtn.onclick = () => beginLevel();
    overlayMapBtn.onclick = () => openMap();
  }

  function checkEndGame() {
    if (state.moves <= 0 || isGoalMet()) {
      if (isGoalMet()) {
        state.running = false;
        sounds.win();
        const stars = calcStars(state.score, state.target);
        recordCompletion(state.level, state.score, stars);
        const next = state.level + 1;
        state.save.level = Math.min(LEVELS.length, Math.max(state.save.level, next));
        saveProgress();
        const cfg = getLevelConfig(state.level);
        const resultText = cfg.collect
          ? `Collected ${Math.min(state.collected, cfg.collect.count)}/${cfg.collect.count} ${CANDIES[cfg.collect.candy].emoji}`
          : `Scored ${state.score.toLocaleString()}`;
        const hasNext = state.level < LEVELS.length;
        showOverlay('Level Complete! 🎉', `${resultText} with ${stars} star${stars > 1 ? 's' : ''}.`, hasNext ? 'Next Level' : 'Map', stars, hasNext ? undefined : undefined);
        overlayBtn.onclick = () => {
          if (hasNext) enterLevel(state.level + 1, false);
          else openMap();
        };
      } else {
        state.running = false;
        sounds.lose();
        const cfg = getLevelConfig(state.level);
        const goalTextNow = cfg.collect
          ? `Collect ${cfg.collect.count} ${CANDIES[cfg.collect.candy].emoji} · ${state.collected}/${cfg.collect.count}`
          : `Reach ${cfg.target.toLocaleString()} · ${state.score.toLocaleString()}`;
        showOverlay('Level Failed 😢', `Out of moves!\nGoal: ${goalTextNow}`, 'Try Again', undefined, 'Map');
        overlayBtn.onclick = () => enterLevel(state.level, false);
        overlayMapBtn.onclick = () => openMap();
      }
    }
  }

  // ---------- Level map (Candy Crush style) ----------
  function openMap() {
    state.running = false;
    renderMap();
    gameView.classList.add('hidden');
    mapView.classList.remove('hidden');
  }

  function closeMap() {
    mapView.classList.add('hidden');
    gameView.classList.remove('hidden');
  }

  function renderMap() {
    mapListEl.innerHTML = '';
    const done = Object.keys(state.save.best).length;
    mapProgressEl.textContent = `${done} / ${LEVELS.length} complete`;

    const tile = 56, gapX = 74, gapY = 96, marginX = 34, top = 34;
    const perRow = 4;
    const rows = Math.ceil(LEVELS.length / perRow);

    // winding path points
    const points = [];
    for (let i = 1; i <= LEVELS.length; i++) {
      const row = Math.floor((i - 1) / perRow);
      let col = (i - 1) % perRow;
      if (row % 2 === 1) col = perRow - 1 - col;
      const x = marginX + col * gapX;
      const y = top + row * gapY;
      points.push({ x, y, i });
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'map-path');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', rows * gapY + top * 2);
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x + tile / 2} ${p.y + tile / 2}`).join(' ');
    poly.setAttribute('d', d);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'rgba(255,255,255,0.45)');
    poly.setAttribute('stroke-width', '6');
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
    mapListEl.appendChild(svg);

    const max = state.save.level;
    for (const p of points) {
      const cfg = LEVELS[p.i - 1];
      const best = state.save.best[p.i];
      const unlocked = p.i <= max;
      const isCur = unlocked && p.i >= max;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'level-bubble' + (best ? ' done' : '') + (isCur ? ' current' : '') + (unlocked ? '' : ' locked');
      el.dataset.level = p.i;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      let inner = `<span class="bubble-num">${p.i}</span>`;
      if (best) {
        inner += `<span class="bubble-stars">${'★'.repeat(best.stars)}<span class="star-dim">${'★'.repeat(3 - best.stars)}</span></span>`;
      }
      if (!unlocked) {
        el.innerHTML = `<span class="bubble-num">🔒</span>`;
      } else if (isCur && !best) {
        el.innerHTML = `${inner}<span class="bubble-tag">PLAY</span>`;
      } else {
        el.innerHTML = inner;
      }
      if (cfg.collect && unlocked) {
        el.title = `Level ${p.i}: collect ${cfg.collect.count} ${CANDIES[cfg.collect.candy].emoji}`;
      }
      mapListEl.appendChild(el);
    }

    const h = rows * gapY + top * 2;
    mapListEl.style.height = Math.min(h + 24, 540) + 'px';
  }

  mapListEl.addEventListener('click', (e) => {
    const b = e.target.closest('.level-bubble');
    if (!b) return;
    const lvl = +b.dataset.level;
    if (lvl > state.save.level) return;
    enterLevel(lvl, true);
  });

  // ---------- Helpers ----------
  function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  // ---------- No-refresh guards ----------
  document.addEventListener('submit', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.ctrlKey && (e.key === 'r' || e.key === 'R'))) {
      if (state.running && !state.busy) {
        saveProgress();
      }
    }
  });

  // ---------- Offline support (service worker) ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ---------- Wire up ----------
  mapBtn.addEventListener('click', () => {
    ensureAudio();
    openMap();
  });

  restartBtn.addEventListener('click', () => {
    ensureAudio();
    enterLevel(state.level, false);
  });

  overlayBtn.addEventListener('click', () => {
    ensureAudio();
    beginLevel();
  });

  overlayMapBtn.addEventListener('click', () => {
    openMap();
  });

  // ---------- Boot ----------
  loadProgress();
  renderMap();
  gameView.classList.add('hidden');
  mapView.classList.remove('hidden');
})();