// 翻牌配對：畫面與操作。遊戲規則在 core.js
import { LEVELS, createMemoryMatch } from './core.js';
import { autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 配錯的兩張停留多久再蓋回（期間翻下一張會立刻蓋回）
const MISMATCH_MS = 900;
// 翻牌動畫的時間（配對成功 / 配錯的動畫在翻完之後才播）
const FLIP_MS = 320;
// 過關時牌依距離陸續跳動，播完再顯示結果
const WAVE_STEP_MS = 45;
const MAX_CARD = 112;
const MIN_CARD = 40;
// 牌的高 / 寬
const CARD_RATIO = 1.25;
const LEVEL_KEY = 'jsgames:memory-match:level';

const SYMBOL_NAMES = [
    'star',
    'heart',
    'moon',
    'sun',
    'bolt',
    'drop',
    'leaf',
    'gem',
    'crown',
    'note',
    'bell',
    'fish',
    'cloud',
    'flame',
    'apple',
    'key',
    'flower',
    'planet',
];
const LEVEL_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.memory');
const boardArea = $('board-area');
const boardEl = $('board');
const statusText = $('status');
const overlays = {
    ready: $('overlay-ready'),
    paused: $('overlay-paused'),
    won: $('overlay-won'),
    confirm: $('overlay-confirm'),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// 各難度分開記錄最少步數與最短時間（秒），兩者各自比較
const bests = Object.fromEntries(
    Object.keys(LEVELS).map((name) => [
        name,
        {
            moves: highScore(`memory-match:${name}`, { order: 'asc' }),
            time: highScore(`memory-match:${name}:time`, { order: 'asc' }),
        },
    ])
);

function formatTime(seconds) {
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function loadLevel() {
    try {
        const saved = localStorage.getItem(LEVEL_KEY);
        if (saved in LEVELS) return saved;
    } catch {
        // 略過
    }
    return 'normal';
}

function saveLevel(name) {
    try {
        localStorage.setItem(LEVEL_KEY, name);
    } catch {
        // 略過
    }
}

// ---------- 狀態 ----------

let state = 'ready';
let level = loadLevel();
let pendingLevel = null;
let game = null;
let cards = [];
let cursor = 0;
let overAt = 0;
let settleTimer = 0;
let resultTimer = 0;
// 計時：累積的毫秒 + 目前這段開始的時間（暫停時不計）
let elapsed = 0;
let runningSince = null;
let tick = 0;

function levelConfig(name) {
    const config = LEVELS[name];
    // 直向的手機上把橫的盤面轉成直的
    const portrait = innerHeight > innerWidth && innerWidth < 700;
    if (portrait && config.cols > config.rows) return { rows: config.cols, cols: config.rows };
    return config;
}

// ---------- 計時 ----------

const currentSeconds = () => (elapsed + (runningSince === null ? 0 : performance.now() - runningSince)) / 1000;

function startClock() {
    if (runningSince !== null) return;
    runningSince = performance.now();
    tick = setInterval(renderTime, 250);
}

function stopClock() {
    if (runningSince === null) return;
    elapsed += performance.now() - runningSince;
    runningSince = null;
    clearInterval(tick);
}

function resetClock() {
    stopClock();
    elapsed = 0;
    renderTime();
}

function renderTime() {
    $('time').textContent = formatTime(currentSeconds());
}

// ---------- 盤面 ----------

function buildBoard() {
    boardEl.style.setProperty('--cols', game.cols);
    cards = game.cards.map(({ symbol }, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card';
        button.dataset.i = i;
        button.tabIndex = -1;
        button.style.setProperty('--ink', `var(--s${symbol})`);
        button.innerHTML = `<span class="card__inner"><span class="card__back"></span><span class="card__face"><svg aria-hidden="true"><use href="#s${symbol}" /></svg></span></span>`;
        return button;
    });
    boardEl.replaceChildren(...cards);
    cursor = Math.min(cursor, cards.length - 1);
    cards[cursor].tabIndex = 0;
    game.cards.forEach((_, i) => renderCard(i));
    layout();
}

function cardName(i) {
    return SYMBOL_NAMES[game.cards[i].symbol];
}

function renderCard(i) {
    const card = game.cards[i];
    const el = cards[i];
    el.dataset.state = card.state;
    const row = Math.floor(i / game.cols) + 1;
    const col = (i % game.cols) + 1;
    const label = card.state === 'down' ? 'face down' : card.state === 'matched' ? `${cardName(i)}, matched` : cardName(i);
    el.setAttribute('aria-label', `Row ${row}, column ${col}: ${label}`);
    // 已配對的牌不能再點，但保留在 tab 順序裡讓方向鍵可以經過
    el.setAttribute('aria-disabled', String(card.state === 'matched'));
}

function animateCard(i, className, delay = 0) {
    const el = cards[i];
    if (reduceMotion.matches) return;
    el.classList.remove('is-match', 'is-miss', 'is-wave');
    el.style.setProperty('--delay', `${delay}ms`);
    void el.offsetWidth;
    el.classList.add(className);
}

// 牌的大小：整個盤面放得下時盡量放大（不超過 MAX_CARD）
function layout() {
    if (!game) return;
    const gap = boardArea.clientWidth < 480 ? 6 : 10;
    const padding = 2 * gap;
    const fitWidth = (boardArea.clientWidth - padding - gap * (game.cols - 1)) / game.cols;
    const fitHeight = (boardArea.clientHeight - padding - gap * (game.rows - 1)) / game.rows / CARD_RATIO;
    const width = Math.floor(Math.max(MIN_CARD, Math.min(MAX_CARD, fitWidth, fitHeight)));
    root.style.setProperty('--gap-card', `${gap}px`);
    root.style.setProperty('--card-w', `${width}px`);
    root.style.setProperty('--board-width', `${width * game.cols + gap * (game.cols - 1) + padding}px`);
}

new ResizeObserver(layout).observe(boardArea);

// ---------- 分數列 ----------

function renderHud() {
    $('moves').textContent = game.moves;
    $('pairs').textContent = game.matches;
    $('pairs-total').textContent = game.pairs;
    const record = bests[level].moves.get();
    $('best').textContent = record === null ? '–' : record;
    renderTime();
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.level === level));
    }
}

function announce(text) {
    statusText.textContent = text;
}

// ---------- 遊戲流程 ----------

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
}

function newGame(nextLevel = level) {
    clearTimeout(resultTimer);
    clearTimeout(settleTimer);
    level = nextLevel;
    saveLevel(level);
    game = createMemoryMatch(levelConfig(level));
    resetClock();
    buildBoard();
    renderHud();
    setState('playing');
    cards[cursor].focus({ preventScroll: true });
    announce(`${LEVEL_NAMES[level]}, ${game.pairs} pairs`);
}

// 遊戲進行中（已經翻過牌）時換難度或開新局要先確認
function requestNewGame(nextLevel = level) {
    if (state === 'playing' && game.status === 'playing') {
        pendingLevel = nextLevel;
        setState('confirm');
        return;
    }
    if (state === 'ready') {
        // 開始畫面：只換難度和示意盤面，按開始才進入
        level = nextLevel;
        saveLevel(level);
        showDemo();
        return;
    }
    newGame(nextLevel);
}

// 配錯的牌蓋回去
function settle() {
    clearTimeout(settleTimer);
    const hidden = game.settle();
    if (hidden) for (const i of hidden) renderCard(i);
}

function pause() {
    if (state !== 'playing' || game.status !== 'playing') return;
    stopClock();
    // 暫停期間不留著翻開的配錯牌
    settle();
    setState('paused');
}

function resume() {
    if (state !== 'paused') return;
    setState('playing');
    startClock();
    cards[cursor].focus({ preventScroll: true });
}

function flip(i) {
    if (state !== 'playing') return;
    clearTimeout(settleTimer);
    const result = game.flip(i);
    if (!result) return;
    startClock();

    if (result.hidden) for (const h of result.hidden) renderCard(h);
    renderCard(i);

    if (result.match) {
        for (const m of result.match) {
            renderCard(m);
            animateCard(m, 'is-match', FLIP_MS);
        }
        const streak = game.streak > 1 ? ` ${game.streak} in a row.` : '';
        announce(`${cardName(i)}. Match! ${game.matches} of ${game.pairs} pairs.${streak}`);
        navigator.vibrate?.(15);
    } else if (result.mismatch) {
        for (const m of result.mismatch) animateCard(m, 'is-miss', FLIP_MS);
        announce(`${cardName(i)}. No match.`);
        settleTimer = setTimeout(settle, MISMATCH_MS + FLIP_MS);
    } else {
        announce(cardName(i));
    }

    if (result.won) finish(i);
    renderHud();
}

// 過關：牌從最後翻的那張往外依序跳動，播完再顯示結果
function finish(last) {
    stopClock();
    const seconds = Math.round(currentSeconds() * 10) / 10;
    const lr = Math.floor(last / game.cols);
    const lc = last % game.cols;
    let longest = 0;
    game.cards.forEach((_, i) => {
        const d = Math.hypot(Math.floor(i / game.cols) - lr, (i % game.cols) - lc);
        const delay = FLIP_MS + d * WAVE_STEP_MS;
        longest = Math.max(longest, delay);
        animateCard(i, 'is-wave', delay);
    });
    announce(`All pairs found in ${game.moves} moves, ${formatTime(seconds)}.`);

    resultTimer = setTimeout(
        () => {
            const movesRecord = bests[level].moves.submit(game.moves);
            const timeRecord = bests[level].time.submit(seconds);
            $('won-moves').textContent = game.moves;
            $('won-detail').textContent = `${formatTime(seconds)} · Longest streak ${game.bestStreak}`;
            const note = $('won-note');
            const bestMoves = bests[level].moves.get() ?? game.moves;
            const bestTime = bests[level].time.get() ?? seconds;
            if (movesRecord && timeRecord) note.textContent = `${LEVEL_NAMES[level]} · New best moves and time`;
            else if (movesRecord) note.textContent = `${LEVEL_NAMES[level]} · New best moves`;
            else if (timeRecord) note.textContent = `${LEVEL_NAMES[level]} · New best time`;
            else note.textContent = `${LEVEL_NAMES[level]} · Best ${bestMoves} moves, ${formatTime(bestTime)}`;
            note.classList.toggle('is-record', movesRecord || timeRecord);
            overAt = performance.now();
            setState('won');
            renderHud();
            overlays.won.querySelector('.btn').focus({ preventScroll: true });
        },
        reduceMotion.matches ? 400 : longest + 700
    );
}

// ---------- 操作 ----------

boardEl.addEventListener('click', (event) => {
    const el = event.target.closest('.card');
    if (!el) return;
    const i = Number(el.dataset.i);
    moveCursor(i, false);
    flip(i);
});

function moveCursor(next, focus = true) {
    cards[cursor].tabIndex = -1;
    cursor = next;
    cards[cursor].tabIndex = 0;
    if (focus) cards[cursor].focus({ preventScroll: false });
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing') {
        const arrow = ARROWS[key];
        if (arrow) {
            event.preventDefault();
            const r = Math.floor(cursor / game.cols);
            const c = cursor % game.cols;
            const nr = Math.min(game.rows - 1, Math.max(0, r + arrow[0]));
            const nc = Math.min(game.cols - 1, Math.max(0, c + arrow[1]));
            moveCursor(nr * game.cols + nc);
        } else if (key === 'p' || key === 'Escape') {
            pause();
        }
        // Space / Enter 由牌的按鈕本身的 click 處理
        return;
    }
    if (state === 'paused' && (key === 'p' || key === 'Escape')) {
        resume();
        return;
    }
    if (state === 'confirm' && key === 'Escape') {
        pendingLevel = null;
        setState('playing');
        return;
    }
    const onButton = event.target instanceof HTMLButtonElement;
    if (key === 'Enter' && !onButton && !event.repeat) {
        if (state === 'won' && performance.now() - overAt < RESTART_GRACE_MS) return;
        if (state !== 'ready' && state !== 'won') return;
        // newGame 會把焦點移到牌上；不擋掉的話這次 Enter 會接著翻開那張牌
        event.preventDefault();
        newGame();
    }
});

document.addEventListener('click', (event) => {
    const levelButton = event.target.closest('.level');
    if (levelButton) {
        requestNewGame(levelButton.dataset.level);
        return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    switch (action) {
        case 'start':
        case 'restart':
            newGame();
            break;
        case 'resume':
            resume();
            break;
        case 'confirm':
            newGame(pendingLevel ?? level);
            pendingLevel = null;
            break;
        case 'cancel':
            pendingLevel = null;
            setState('playing');
            renderHud();
            break;
    }
});

$('new-btn').addEventListener('click', () => requestNewGame(level));
$('pause-btn').addEventListener('click', pause);

// 切到背景或失焦就暫停（盤面被蓋住、時間停止），回來由玩家按繼續
autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動：開始畫面與示意盤面 ----------

function showDemo() {
    clearTimeout(settleTimer);
    let seed = 7;
    const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    game = createMemoryMatch({ ...levelConfig(level), random });
    // 翻開幾對已配對的牌與一張單獨的牌，看起來像玩到一半
    const bySymbol = new Map();
    game.cards.forEach((card, i) => bySymbol.set(card.symbol, [...(bySymbol.get(card.symbol) ?? []), i]));
    const groups = [...bySymbol.values()];
    const shown = Math.max(2, Math.floor(game.pairs / 3));
    for (const [a, b] of groups.slice(0, shown)) {
        game.flip(a);
        game.flip(b);
    }
    game.flip(groups[shown][0]);
    resetClock();
    setState('ready');
    buildBoard();
    renderHud();
}

showDemo();
