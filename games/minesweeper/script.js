// 踩地雷：畫面與操作。遊戲規則在 core.js
import { LEVELS, createMinesweeper } from './core.js';
import { autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 長按插旗的時間，以及手指移動超過多少就取消（當成捲動）
const LONG_PRESS_MS = 350;
const LONG_PRESS_SLOP = 10;
// 展開動畫：每往外一圈延遲多久，最多延遲多久
const OPEN_STEP_MS = 18;
const OPEN_MAX_MS = 500;
// 輸了之後地雷依距離陸續爆開，播完再顯示結果
const BLAST_STEP_MS = 40;
const BLAST_MAX_MS = 900;
const MAX_CELL = 40;
const MIN_CELL = 18;
const MIN_TOUCH_CELL = 28;
const LEVEL_KEY = 'jsgames:minesweeper:level';

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.mines');
const boardArea = $('board-area');
const boardEl = $('board');
const statusText = $('status');
const overlays = {
    ready: $('overlay-ready'),
    paused: $('overlay-paused'),
    won: $('overlay-won'),
    lost: $('overlay-lost'),
    confirm: $('overlay-confirm'),
};

const coarse = matchMedia('(pointer: coarse)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const LEVEL_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' };

// 各難度分開記錄最佳時間（秒，越少越好）
const bests = Object.fromEntries(
    Object.keys(LEVELS).map((level) => [level, highScore(`minesweeper:${level}`, { order: 'asc' })])
);
const formatTime = (seconds) => `${seconds.toFixed(1)}s`;

function loadLevel() {
    try {
        const saved = localStorage.getItem(LEVEL_KEY);
        if (saved in LEVELS) return saved;
    } catch {
        // 略過
    }
    return 'beginner';
}

function saveLevel(level) {
    try {
        localStorage.setItem(LEVEL_KEY, level);
    } catch {
        // 略過
    }
}

// ---------- 狀態 ----------

let state = 'ready';
let level = loadLevel();
let pendingLevel = null;
let game = null;
let cells = [];
let cursor = 0;
let mode = 'dig';
let overAt = 0;
let resultTimer = 0;
// 計時：累積的毫秒 + 目前這段開始的時間（暫停時不計）
let elapsed = 0;
let runningSince = null;
let tick = 0;

function levelConfig(name) {
    const config = LEVELS[name];
    // 直向的手機上把專家盤面轉成直的（30 列 × 16 欄）
    const portrait = innerHeight > innerWidth && innerWidth < 700;
    if (portrait && config.cols > config.rows) return { ...config, rows: config.cols, cols: config.rows };
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
    $('time').textContent = Math.floor(currentSeconds());
}

// ---------- 盤面 ----------

function buildBoard() {
    boardEl.style.setProperty('--cols', game.cols);
    cells = game.cells.map((_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell';
        button.dataset.i = i;
        button.tabIndex = -1;
        return button;
    });
    boardEl.replaceChildren(...cells);
    cursor = Math.min(cursor, cells.length - 1);
    cells[cursor].tabIndex = 0;
    game.cells.forEach((_, i) => renderCell(i));
    layout();
}

const ICON = (id) => `<svg aria-hidden="true"><use href="#${id}" /></svg>`;

function renderCell(i) {
    const cell = game.cells[i];
    const el = cells[i];
    const row = Math.floor(i / game.cols) + 1;
    const col = (i % game.cols) + 1;
    el.dataset.state = cell.state;
    delete el.dataset.n;
    let label;
    if (cell.state === 'flagged') {
        el.innerHTML = ICON('i-flag');
        label = 'flagged';
    } else if (cell.state === 'revealed' && cell.mine) {
        el.innerHTML = ICON('i-mine');
        label = 'mine';
    } else if (cell.state === 'revealed') {
        el.textContent = cell.adjacent || '';
        if (cell.adjacent) el.dataset.n = cell.adjacent;
        label = cell.adjacent ? `${cell.adjacent} ${cell.adjacent === 1 ? 'mine' : 'mines'} nearby` : 'empty';
    } else {
        el.textContent = '';
        label = 'hidden';
    }
    el.setAttribute('aria-label', `Row ${row}, column ${col}: ${label}`);
}

function animateCell(i, className, delay) {
    const el = cells[i];
    if (reduceMotion.matches) return;
    el.classList.remove('is-opening', 'is-blast', 'is-planted');
    el.style.setProperty('--delay', `${delay}ms`);
    void el.offsetWidth;
    el.classList.add(className);
}

// 格子大小：整個盤面放得下時盡量放大（不超過 MAX_CELL）
// 觸控裝置上放不下時改成只對齊寬度、上下捲動，避免格子小到點不準
function layout() {
    if (!game) return;
    const padding = 12 + (game.cols - 1);
    const fitWidth = Math.floor((boardArea.clientWidth - padding) / game.cols);
    const fitHeight = Math.floor((boardArea.clientHeight - 12 - (game.rows - 1)) / game.rows);
    const fitBoth = Math.min(fitWidth, fitHeight);
    const size =
        coarse.matches && fitBoth < MIN_TOUCH_CELL
            ? Math.max(MIN_CELL, Math.min(MAX_CELL, fitWidth))
            : Math.max(MIN_CELL, Math.min(MAX_CELL, fitBoth));
    boardEl.style.setProperty('--cell', `${size}px`);
    root.style.setProperty('--board-width', `${size * game.cols + padding}px`);
}

new ResizeObserver(layout).observe(boardArea);

// ---------- 分數列 ----------

function renderHud() {
    // 開始畫面後面是示意盤面，顯示這個難度的地雷總數
    $('mines-left').textContent = state === 'ready' ? game.mines : game.minesLeft();
    const record = bests[level].get();
    $('best').textContent = record === null ? '–' : formatTime(record);
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
    level = nextLevel;
    saveLevel(level);
    game = createMinesweeper(levelConfig(level));
    resetClock();
    buildBoard();
    renderHud();
    setState('playing');
    cells[cursor].focus({ preventScroll: true });
    announce(`${LEVEL_NAMES[level]}, ${game.rows} by ${game.cols}, ${game.mines} mines`);
}

// 遊戲進行中（已經點過第一下）時換難度或開新局要先確認
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

function pause() {
    if (state !== 'playing' || game.status !== 'playing') return;
    stopClock();
    setState('paused');
}

function resume() {
    if (state !== 'paused') return;
    setState('playing');
    startClock();
    cells[cursor].focus({ preventScroll: true });
}

function apply(result) {
    if (!result) return;
    if (game.status === 'playing' || result.won || result.lost) startClock();

    for (const { index, depth } of result.opened) {
        renderCell(index);
        if (!result.lost || index !== result.lost.exploded) {
            animateCell(index, 'is-opening', Math.min(depth * OPEN_STEP_MS, OPEN_MAX_MS));
        }
    }

    if (result.lost) {
        stopClock();
        const { exploded, mines, wrongFlags } = result.lost;
        cells[exploded].classList.add('is-boom');
        animateCell(exploded, 'is-blast', 0);
        const er = Math.floor(exploded / game.cols);
        const ec = exploded % game.cols;
        let last = 0;
        for (const i of mines) {
            game.cells[i].state = 'revealed';
            renderCell(i);
            const d = Math.hypot(Math.floor(i / game.cols) - er, (i % game.cols) - ec);
            const delay = Math.min(d * BLAST_STEP_MS, BLAST_MAX_MS);
            last = Math.max(last, delay);
            animateCell(i, 'is-blast', delay);
        }
        for (const i of wrongFlags) cells[i].classList.add('is-wrong');
        announce('You hit a mine. Game over.');
        finish('lost', reduceMotion.matches ? 300 : last + 600);
    } else if (result.won) {
        stopClock();
        for (const i of result.won.flagged) {
            renderCell(i);
            animateCell(i, 'is-planted', 0);
        }
        announce(`Cleared in ${formatTime(currentSeconds())}.`);
        finish('won', 700);
    } else {
        const opened = result.opened.length;
        announce(opened === 1 ? cells[result.opened[0].index].getAttribute('aria-label') : `Opened ${opened} squares`);
    }
    renderHud();
}

function finish(outcome, delay) {
    const seconds = Math.round(currentSeconds() * 10) / 10;
    resultTimer = setTimeout(() => {
        if (outcome === 'won') {
            const isRecord = bests[level].submit(seconds);
            $('won-time').textContent = formatTime(seconds);
            const note = $('won-note');
            const record = bests[level].get();
            note.textContent = isRecord
                ? `${LEVEL_NAMES[level]} · New best time`
                : `${LEVEL_NAMES[level]} · Best ${formatTime(record ?? seconds)}`;
            note.classList.toggle('is-record', isRecord);
        } else {
            const left = game.cells.filter((c) => !c.mine && c.state !== 'revealed').length;
            $('lost-note').textContent = `${left} safe ${left === 1 ? 'square' : 'squares'} left · ${formatTime(seconds)}`;
        }
        overAt = performance.now();
        setState(outcome);
        renderHud();
        overlays[outcome].querySelector('.btn').focus({ preventScroll: true });
    }, delay);
}

function reveal(i) {
    if (state !== 'playing') return;
    apply(game.reveal(i));
}

function flag(i) {
    if (state !== 'playing' || !game.toggleFlag(i)) return;
    renderCell(i);
    if (game.cells[i].state === 'flagged') animateCell(i, 'is-planted', 0);
    renderHud();
    announce(cells[i].getAttribute('aria-label'));
    navigator.vibrate?.(12);
}

// 依目前的點擊模式決定點一下是挖還是插旗
function primary(i) {
    if (mode === 'flag' && game.cells[i].state !== 'revealed') flag(i);
    else reveal(i);
}

function setMode(next) {
    mode = next;
    for (const button of document.querySelectorAll('.tool')) {
        button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
}

// ---------- 操作：滑鼠 / 觸控 ----------

let press = null;

boardEl.addEventListener('pointerdown', (event) => {
    const el = event.target.closest('.cell');
    if (!el || state !== 'playing') return;
    moveCursor(Number(el.dataset.i), false);
    if (event.pointerType === 'mouse') return;
    // 觸控長按：插旗（插旗模式下改成挖）
    const i = Number(el.dataset.i);
    press = {
        i,
        x: event.clientX,
        y: event.clientY,
        fired: false,
        timer: setTimeout(() => {
            press.fired = true;
            if (mode === 'flag') reveal(i);
            else flag(i);
        }, LONG_PRESS_MS),
    };
});

boardEl.addEventListener('pointermove', (event) => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP) {
        clearTimeout(press.timer);
        press.cancelled = true;
    }
});

function endPress() {
    if (press) clearTimeout(press.timer);
}

boardEl.addEventListener('pointerup', endPress);
boardEl.addEventListener('pointercancel', () => {
    endPress();
    if (press) press.cancelled = true;
});

boardEl.addEventListener('click', (event) => {
    const el = event.target.closest('.cell');
    if (!el) return;
    const i = Number(el.dataset.i);
    // 長按已經處理過，或手指移動過（捲動盤面）就不算點擊
    if (press && press.i === i && (press.fired || press.cancelled)) {
        press = null;
        return;
    }
    press = null;
    primary(i);
});

boardEl.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const el = event.target.closest('.cell');
    // 觸控裝置的長按也會觸發 contextmenu，交給上面的長按計時處理
    if (!el || (press && press.i === Number(el.dataset.i))) return;
    flag(Number(el.dataset.i));
});

// ---------- 操作：鍵盤 ----------

function moveCursor(next, focus = true) {
    cells[cursor].tabIndex = -1;
    cursor = next;
    cells[cursor].tabIndex = 0;
    if (focus) cells[cursor].focus({ preventScroll: false });
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
        } else if (key === 'f') {
            event.preventDefault();
            flag(cursor);
        } else if (key === 'p' || key === 'Escape') {
            pause();
        }
        // Space / Enter 由格子按鈕本身的 click 處理
        return;
    }
    if (state === 'paused' && (key === 'p' || key === 'Escape')) {
        resume();
        return;
    }
    if (state === 'confirm' && key === 'Escape') {
        setState('playing');
        return;
    }
    const onButton = event.target instanceof HTMLButtonElement;
    if (key === 'Enter' && !onButton && !event.repeat) {
        if ((state === 'won' || state === 'lost') && performance.now() - overAt < RESTART_GRACE_MS) return;
        if (state === 'ready' || state === 'won' || state === 'lost') newGame();
    }
});

document.addEventListener('click', (event) => {
    const levelButton = event.target.closest('.level');
    if (levelButton) {
        requestNewGame(levelButton.dataset.level);
        return;
    }
    const toolButton = event.target.closest('.tool');
    if (toolButton) {
        setMode(toolButton.dataset.mode);
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
    let seed = 5;
    const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    game = createMinesweeper({ ...levelConfig(level), random });
    const center = Math.floor(game.rows / 2) * game.cols + Math.floor(game.cols / 2);
    game.reveal(center);
    // 在打開的區域邊緣插幾支旗子，看起來像玩到一半
    let planted = 0;
    game.cells.forEach((cell, i) => {
        if (planted >= 4 || !cell.mine) return;
        if (game.neighbors(i).some((n) => game.cells[n].state === 'revealed')) {
            game.toggleFlag(i);
            planted++;
        }
    });
    resetClock();
    setState('ready');
    buildBoard();
    renderHud();
}

showDemo();
