// 2048：畫面與操作。遊戲規則在 core.js
import { SIZE, createGame } from './core.js';
import { highScore, onSwipe } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 滑動動畫的長度（與 style.css 的 transition 一致），合併來源在這之後移除
const SLIDE_MS = 110;
// 結束 / 勝利畫面在最後一步動畫播完後才出現
const OVERLAY_DELAY_MS = 450;
const SAVE_KEY = 'jsgames:2048:game';

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.g2048');
const tilesLayer = $('tiles');
const statusText = $('status');
const undoButton = $('undo-btn');
const overlays = {
    ready: $('overlay-ready'),
    won: $('overlay-won'),
    over: $('overlay-over'),
    confirm: $('overlay-confirm'),
};

const best = highScore('2048');
// 舊版把最高分存在 bestScore，第一次開啟時搬過來
try {
    const legacy = Number.parseInt(localStorage.getItem('bestScore'), 10);
    if (Number.isFinite(legacy) && legacy > 0) best.submit(legacy);
} catch {
    // localStorage 不可用時略過
}

const formatNumber = (n) => n.toLocaleString('en-US');

// 背景格子
document.querySelector('.cells').append(...Array.from({ length: SIZE * SIZE }, () => document.createElement('span')));

// ---------- 存檔：進行中的局面存在 localStorage，關掉再開可以接著玩 ----------

function loadSaved() {
    try {
        return JSON.parse(localStorage.getItem(SAVE_KEY));
    } catch {
        return null;
    }
}

function save() {
    try {
        if (game.over) localStorage.removeItem(SAVE_KEY);
        else localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON()));
    } catch {
        // 無痕模式等情況存不了就算了
    }
}

function clearSave() {
    try {
        localStorage.removeItem(SAVE_KEY);
    } catch {
        // 略過
    }
}

// ---------- 方塊 ----------

let state = 'ready';
let game = null;
let overAt = 0;
let overlayTimer = 0;
// id → 方塊元素
const tileEls = new Map();
// 合併後要移除的來源方塊
let leaving = [];

function makeTile(id, value, index, extraClass = '') {
    const el = document.createElement('div');
    el.className = `tile ${extraClass}`.trim();
    el.dataset.v = value;
    el.dataset.digits = String(value).length;
    place(el, index);
    const face = document.createElement('div');
    face.className = 'tile__face';
    face.textContent = value;
    el.append(face);
    tilesLayer.append(el);
    tileEls.set(id, el);
    return el;
}

function place(el, index) {
    el.style.setProperty('--x', index % SIZE);
    el.style.setProperty('--y', Math.floor(index / SIZE));
}

// 上一步的動畫還沒播完就收尾，避免連續操作時殘留
function settle() {
    for (const el of leaving) el.remove();
    leaving = [];
    for (const el of tileEls.values()) el.classList.remove('tile--new', 'tile--merged');
}

// 整個盤面重畫（開局、讀檔、復原）
function renderBoard() {
    settle();
    tilesLayer.replaceChildren();
    tileEls.clear();
    game.cells.forEach((tile, index) => {
        if (tile) makeTile(tile.id, tile.value, index);
    });
}

function animate(result) {
    settle();
    const mergedFrom = new Set(result.merges.flatMap((m) => m.from));
    for (const { id, to } of result.slides) {
        const el = tileEls.get(id);
        if (!el) continue;
        place(el, to);
        if (mergedFrom.has(id)) {
            tileEls.delete(id);
            leaving.push(el);
        }
    }
    const toRemove = leaving;
    setTimeout(() => {
        for (const el of toRemove) el.remove();
        leaving = leaving.filter((el) => !toRemove.includes(el));
    }, SLIDE_MS);
    for (const merge of result.merges) makeTile(merge.id, merge.value, merge.to, 'tile--merged');
    if (result.spawned) makeTile(result.spawned.id, result.spawned.value, result.spawned.index, 'tile--new');
}

// ---------- 分數列 ----------

const shown = {};

function renderHud() {
    // 開始畫面後面是示意盤面，分數顯示 0
    const score = formatNumber(state === 'ready' ? 0 : game.score);
    if (shown.score !== score) {
        shown.score = score;
        $('score').textContent = score;
    }
    const record = best.get();
    const bestText = record === null ? '–' : formatNumber(record);
    if (shown.best !== bestText) {
        shown.best = bestText;
        $('best').textContent = bestText;
    }
    undoButton.disabled = !game.canUndo || state === 'ready';
}

function showGain(points) {
    const gain = $('gain');
    gain.textContent = `+${points}`;
    gain.classList.remove('is-showing');
    void gain.offsetWidth;
    gain.classList.add('is-showing');
}

// ---------- 狀態 ----------

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
    renderHud();
}

function showOverlayLater(next) {
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
        if (next === 'over') {
            const isRecord = best.submit(game.score);
            $('final-score').textContent = formatNumber(game.score);
            const note = $('final-note');
            const record = best.get();
            note.textContent = isRecord
                ? `Highest tile ${game.maxTile()} · New best score`
                : `Highest tile ${game.maxTile()} · Best ${formatNumber(record ?? 0)}`;
            note.classList.toggle('is-record', isRecord);
            overAt = performance.now();
        } else if (next === 'won') {
            $('won-score').textContent = formatNumber(game.score);
        }
        setState(next);
        overlays[next].querySelector('.btn')?.focus({ preventScroll: true });
    }, OVERLAY_DELAY_MS);
}

function newGame() {
    clearTimeout(overlayTimer);
    clearSave();
    game = createGame();
    renderBoard();
    save();
    for (const key of Object.keys(shown)) delete shown[key];
    document.activeElement?.blur();
    setState('playing');
    announce('New game');
}

function resumeSaved(saved) {
    game = createGame({ state: saved });
    renderBoard();
    setState('playing');
}

function requestNewGame() {
    // 才剛開始或已經結束就直接開新局，否則先確認
    if (state === 'playing' && game.score > 0) setState('confirm');
    else newGame();
}

function undo() {
    if (!game.undo()) return;
    clearTimeout(overlayTimer);
    renderBoard();
    save();
    setState('playing');
    announce('Undid last move');
}

// ---------- 移動 ----------

const DIR_NAMES = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };

function announce(text) {
    statusText.textContent = text;
}

function move(dir) {
    if (state !== 'playing') return;
    const result = game.move(dir);
    if (!result) return;
    animate(result);
    if (result.gained > 0) {
        showGain(result.gained);
        best.submit(game.score);
    }
    save();
    renderHud();

    const merged = result.merges.map((m) => m.value).sort((a, b) => b - a);
    announce(
        `${DIR_NAMES[dir]}. ${merged.length ? `Merged ${merged.join(', ')}. ` : ''}Score ${formatNumber(game.score)}.` +
            (result.over ? ' No moves left.' : result.reachedGoal ? ' You made 2048.' : '')
    );

    if (result.reachedGoal && !game.keepPlaying) showOverlayLater('won');
    else if (result.over) showOverlayLater('over');
}

// ---------- 操作 ----------

const KEYS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
};
const keyOf = (event) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || (event.ctrlKey && event.key.toLowerCase() !== 'z')) return;
    const key = keyOf(event);
    const dir = KEYS[key];
    if (state === 'playing') {
        if (dir) {
            event.preventDefault();
            if (!event.repeat) move(dir);
        } else if (key === 'u' || (event.ctrlKey && key === 'z')) {
            event.preventDefault();
            undo();
        }
        return;
    }
    if (state === 'confirm' && key === 'Escape') {
        setState('playing');
        return;
    }
    if (state === 'over' && (key === 'u' || (event.ctrlKey && key === 'z'))) {
        event.preventDefault();
        undo();
        return;
    }
    const onButton = event.target instanceof HTMLButtonElement;
    if (key === 'Enter' && !onButton && !event.repeat) {
        event.preventDefault();
        if (state === 'over' && performance.now() - overAt < RESTART_GRACE_MS) return;
        if (state === 'ready' || state === 'over') newGame();
        else if (state === 'won') continuePlaying();
    }
});

function continuePlaying() {
    game.continueAfterWin();
    save();
    document.activeElement?.blur();
    setState('playing');
}

document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    switch (action) {
        case 'start':
            newGame();
            break;
        case 'continue':
            continuePlaying();
            break;
        case 'new':
        case 'new-confirmed':
            newGame();
            break;
        case 'cancel':
            setState('playing');
            break;
        case 'undo':
            undo();
            break;
    }
});

$('new-btn').addEventListener('click', requestNewGame);
undoButton.addEventListener('click', undo);

// 觸控 / 滑鼠：在盤面區域滑動
onSwipe($('board-area'), (dir) => move(dir), { threshold: 24 });

// ---------- 啟動：有存檔就接著玩，否則顯示開始畫面與示意盤面 ----------

function demoGame() {
    return createGame({
        state: {
            size: SIZE,
            cells: [2, 0, 4, 2, 8, 16, 2, 0, 64, 32, 128, 4, 1024, 512, 256, 8],
            score: 12_384,
        },
    });
}

// 存檔格式不對時 createGame 會直接開新局
const saved = loadSaved();
if (Array.isArray(saved?.cells) && saved.cells.some((v) => v > 0)) {
    resumeSaved(saved);
} else {
    game = demoGame();
    renderBoard();
    setState('ready');
}
