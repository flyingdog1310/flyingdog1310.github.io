// 數獨：畫面與操作。遊戲規則在 core.js
import { LEVELS, PEERS, boxOf, colOf, createSudoku, rowOf } from './core.js';
import { autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 完成一列 / 行 / 宮的光波：每格延遲；整盤完成時每一圈延遲
const WAVE_STEP_MS = 35;
const WIN_STEP_MS = 45;
// 整盤完成的光波播完再顯示結果
const WIN_DELAY_MS = 1100;
const SAVE_KEY = 'jsgames:sudoku:game';
const LEVEL_KEY = 'jsgames:sudoku:level';

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.sudoku');
const boardEl = $('board');
const numpad = $('numpad');
const statusText = $('status');
const overlays = {
    ready: $('overlay-ready'),
    paused: $('overlay-paused'),
    won: $('overlay-won'),
    confirm: $('overlay-confirm'),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

// 各難度分開記錄最佳時間（秒，越少越好）；用了提示的不算
const bests = Object.fromEntries(
    Object.keys(LEVELS).map((name) => [name, highScore(`sudoku:${name}`, { order: 'asc' })])
);

function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ---------- 存檔：進行中的局面與時間存在 localStorage，關掉再開可以接著玩 ----------

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // 無痕模式等情況存不了就算了
    }
}

function loadSaved() {
    try {
        const saved = JSON.parse(readStorage(SAVE_KEY));
        if (!saved || !(saved.game?.level in LEVELS)) return null;
        const restored = createSudoku({ state: saved.game });
        return restored.status === 'playing' ? { game: restored, time: Number(saved.time) || 0 } : null;
    } catch {
        return null;
    }
}

function save() {
    if (!game || state === 'ready') return;
    if (game.status !== 'playing') writeStorage(SAVE_KEY, null);
    else writeStorage(SAVE_KEY, JSON.stringify({ game: game.toJSON(), time: currentSeconds() }));
}

// ---------- 狀態 ----------

let state = 'ready';
let level = LEVELS[readStorage(LEVEL_KEY)] ? readStorage(LEVEL_KEY) : 'easy';
let game = null;
let selected = 40;
let notesMode = false;
let overAt = 0;
let winTimer = 0;
let pendingLevel = null;
// 確認畫面取消後回到哪個狀態
let confirmFrom = 'playing';
// 計時：累積的毫秒 + 目前這段開始的時間（只有 playing 時在跑）
let elapsed = 0;
let runningSince = null;
let tick = 0;

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
    renderTime();
}

function renderTime() {
    $('time').textContent = formatTime(currentSeconds());
}

// ---------- 盤面 ----------

// 格子依宮排列（每宮一個 .box），cells[i] 仍以列優先的索引對應
const cells = new Array(81);
const boxes = Array.from({ length: 9 }, () => {
    const box = document.createElement('div');
    box.className = 'box';
    return box;
});
for (let k = 0; k < 9; k++) {
    for (let j = 0; j < 9; j++) {
        const i = (Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell';
        button.dataset.i = i;
        button.tabIndex = -1;
        cells[i] = button;
        boxes[k].append(button);
    }
}
boardEl.replaceChildren(...boxes);

const numButtons = Array.from({ length: 9 }, (_, k) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'num';
    button.dataset.digit = k + 1;
    button.innerHTML = `${k + 1}<small></small>`;
    return button;
});
numpad.replaceChildren(...numButtons);

// 每格目前顯示的內容（沒變就不重建，避免打斷動畫）
const shown = new Array(81).fill(null);

function cellLabel(i, conflicts) {
    const v = game.values[i];
    let text;
    if (v) text = `${v}${game.isGiven(i) ? ', given' : ''}${conflicts.has(i) ? ', conflict' : ''}`;
    else {
        const notes = game.noteDigits(i);
        text = notes.length ? `empty, notes ${notes.join(' ')}` : 'empty';
    }
    return `Row ${rowOf(i) + 1}, column ${colOf(i) + 1}: ${text}`;
}

function renderCell(i, conflicts) {
    const el = cells[i];
    const v = game.values[i];
    const notes = v ? [] : game.noteDigits(i);
    const key = v ? `v${v}` : `n${notes.join('')}`;
    if (shown[i] !== key) {
        shown[i] = key;
        if (v) el.innerHTML = `<span class="value">${v}</span>`;
        else if (notes.length) {
            el.innerHTML = `<span class="notes">${[1, 2, 3, 4, 5, 6, 7, 8, 9]
                .map((d) => `<span data-d="${d}">${notes.includes(d) ? d : ''}</span>`)
                .join('')}</span>`;
        } else el.textContent = '';
    }
    el.classList.toggle('is-given', game.isGiven(i));
    el.classList.toggle('is-conflict', conflicts.has(i));
    el.setAttribute('aria-label', cellLabel(i, conflicts));
}

// 選取格的同列 / 行 / 宮、同一個數字（含筆記）都標示出來
function renderHighlights() {
    const peers = new Set(PEERS[selected]);
    const digit = game.values[selected];
    for (let i = 0; i < 81; i++) {
        const el = cells[i];
        el.classList.toggle('is-selected', i === selected);
        el.classList.toggle('is-peer', peers.has(i));
        el.classList.toggle('is-same', Boolean(digit) && i !== selected && game.values[i] === digit);
        for (const note of el.querySelectorAll('.notes span')) {
            note.classList.toggle('is-match', Boolean(digit) && note.dataset.d === String(digit) && note.textContent !== '');
        }
    }
}

function renderBoard() {
    const conflicts = game.conflicts();
    for (let i = 0; i < 81; i++) renderCell(i, conflicts);
    renderHighlights();
    renderControls();
}

function renderControls() {
    const counts = game.counts();
    numButtons.forEach((button, k) => {
        const left = 9 - counts[k + 1];
        button.classList.toggle('is-done', left <= 0);
        button.querySelector('small').textContent = left > 0 ? left : '';
        button.setAttribute('aria-label', `${notesMode ? 'Note' : 'Fill'} ${k + 1}${left > 0 ? `, ${left} left` : ', complete'}`);
    });
    $('undo-btn').disabled = !game.canUndo();
    $('notes-btn').setAttribute('aria-pressed', String(notesMode));
    root.classList.toggle('is-notes', notesMode);
}

function renderHud() {
    const record = bests[level].get();
    $('best').textContent = record === null ? '–' : formatTime(record);
    renderTime();
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.level === level));
    }
}

function animate(i, className, delay = 0) {
    if (reduceMotion.matches) return;
    const el = cells[i];
    el.classList.remove(className);
    el.style.setProperty('--delay', `${delay}ms`);
    void el.offsetWidth;
    el.classList.add(className);
}

function announce(text) {
    statusText.textContent = text;
}

// ---------- 遊戲流程 ----------

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
    if (next === 'playing') startClock();
    else stopClock();
    if (next === 'paused') $('paused-note').textContent = `${LEVEL_NAMES[level]} · ${formatTime(currentSeconds())}`;
}

function focusSelected() {
    cells[selected].focus({ preventScroll: true });
}

function newGame(nextLevel = level) {
    clearTimeout(winTimer);
    level = nextLevel;
    writeStorage(LEVEL_KEY, level);
    game = createSudoku({ level });
    elapsed = 0;
    shown.fill(null);
    select(firstEmpty());
    setState('playing');
    renderBoard();
    renderHud();
    save();
    focusSelected();
    announce(`New ${LEVEL_NAMES[level].toLowerCase()} puzzle, ${game.givenCount()} numbers given`);
}

const firstEmpty = () => Math.max(0, game.values.findIndex((v) => v === 0));

// 已經填過數字時換難度或開新局要先確認
function requestNewGame(nextLevel = level) {
    if (state === 'ready') {
        // 開始畫面：只換難度和示意盤面，按開始才進入
        level = nextLevel;
        writeStorage(LEVEL_KEY, level);
        showDemo();
        return;
    }
    if ((state === 'playing' || state === 'paused') && game.hasProgress()) {
        pendingLevel = nextLevel;
        confirmFrom = state;
        setState('confirm');
        overlays.confirm.querySelector('.btn').focus({ preventScroll: true });
        return;
    }
    newGame(nextLevel);
}

function pause() {
    if (state !== 'playing') return;
    setState('paused');
    save();
}

function resume() {
    if (state !== 'paused') return;
    setState('playing');
    focusSelected();
}

function select(i, focus = false) {
    cells[selected].tabIndex = -1;
    selected = i;
    cells[selected].tabIndex = 0;
    if (game) renderHighlights();
    if (focus) focusSelected();
}

// 填數字 / 提示的結果：更新畫面、動畫、朗讀
function apply(result) {
    if (!result) return;
    renderBoard();
    save();
    const i = result.index;
    const conflicts = game.conflicts();
    if (result.value) {
        if (result.hint) animate(i, 'is-hinted');
        else animate(i, conflicts.has(i) ? 'is-shake' : 'is-placed');
    }

    const done = Object.entries(result.completed ?? {});
    // 光波由剛填的格子往兩邊擴散
    for (const [, unit] of done) {
        unit.forEach((j) => animate(j, 'is-wave', Math.abs(unit.indexOf(j) - unit.indexOf(i)) * WAVE_STEP_MS));
    }

    const parts = [cellLabel(i, conflicts)];
    if (result.hint) parts.unshift('Hint');
    for (const [name] of done) {
        parts.push(
            name === 'row' ? `Row ${rowOf(i) + 1} complete` : name === 'col' ? `Column ${colOf(i) + 1} complete` : `Box ${boxOf(i) + 1} complete`
        );
    }
    announce(parts.join('. '));

    if (result.won) win(i);
}

function win(last) {
    stopClock();
    const seconds = Math.floor(currentSeconds());
    save();
    for (let j = 0; j < 81; j++) {
        const d = Math.max(Math.abs(rowOf(j) - rowOf(last)), Math.abs(colOf(j) - colOf(last)));
        animate(j, 'is-wave', d * WIN_STEP_MS);
    }
    announce(`Solved in ${formatTime(seconds)}.`);
    winTimer = setTimeout(
        () => {
            const note = $('won-note');
            const hints = game.hintsUsed;
            let isRecord = false;
            if (hints === 0) {
                isRecord = bests[level].submit(seconds);
                const record = bests[level].get();
                note.textContent = isRecord
                    ? `${LEVEL_NAMES[level]} · New best time`
                    : `${LEVEL_NAMES[level]} · Best ${formatTime(record ?? seconds)}`;
            } else {
                note.textContent = `${LEVEL_NAMES[level]} · ${hints} ${hints === 1 ? 'hint' : 'hints'}, no best time`;
            }
            note.classList.toggle('is-record', isRecord);
            $('won-time').textContent = formatTime(seconds);
            overAt = performance.now();
            setState('won');
            renderHud();
            overlays.won.querySelector('.btn').focus({ preventScroll: true });
        },
        reduceMotion.matches ? 300 : WIN_DELAY_MS
    );
}

function input(digit, asNote = notesMode) {
    if (state !== 'playing') return;
    if (game.isGiven(selected)) {
        announce(`${cellLabel(selected, game.conflicts())}. Given numbers can't be changed`);
        return;
    }
    if (asNote) {
        const result = game.toggleNote(selected, digit);
        if (!result) return;
        renderBoard();
        save();
        announce(cellLabel(selected, game.conflicts()));
    } else {
        apply(game.setValue(selected, digit));
    }
}

function erase() {
    if (state !== 'playing') return;
    const result = game.erase(selected);
    if (!result) return;
    renderBoard();
    save();
    announce(cellLabel(selected, game.conflicts()));
}

function undo() {
    if (state !== 'playing') return;
    const changed = game.undo();
    if (!changed) return;
    // 跳到被復原的那一格
    select(changed[0]);
    renderBoard();
    save();
    animate(changed[0], 'is-placed');
    announce(`Undo. ${cellLabel(changed[0], game.conflicts())}`);
}

function hint() {
    if (state !== 'playing') return;
    const target = game.hintTarget(selected);
    if (target < 0) return;
    select(target);
    apply(game.hint(target));
}

function toggleNotes() {
    notesMode = !notesMode;
    renderControls();
    announce(`Notes ${notesMode ? 'on' : 'off'}`);
}

// ---------- 操作：滑鼠 / 觸控 ----------

boardEl.addEventListener('click', (event) => {
    const el = event.target.closest('.cell');
    if (!el || state !== 'playing') return;
    select(Number(el.dataset.i));
});

numpad.addEventListener('click', (event) => {
    const button = event.target.closest('.num');
    if (button) input(Number(button.dataset.digit));
});

// 數字鍵與工具列按下後不搶走焦點，讓鍵盤可以繼續操作盤面
for (const el of [numpad, document.querySelector('.tools')]) {
    el.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') event.preventDefault();
    });
}

document.querySelector('.tools').addEventListener('click', (event) => {
    const tool = event.target.closest('.tool')?.dataset.tool;
    if (tool === 'notes') toggleNotes();
    else if (tool === 'undo') undo();
    else if (tool === 'erase') erase();
    else if (tool === 'hint') hint();
});

// ---------- 操作：鍵盤 ----------

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

addEventListener('keydown', (event) => {
    if (event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const command = event.metaKey || event.ctrlKey;
    if (state === 'playing') {
        if (command) {
            if (key === 'z') {
                event.preventDefault();
                undo();
            }
            return;
        }
        // 用 code 判斷數字，Shift + 數字（鍵盤上是符號）也認得
        const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1];
        const arrow = ARROWS[key];
        if (digit) {
            event.preventDefault();
            input(Number(digit), notesMode !== event.shiftKey);
        } else if (arrow) {
            event.preventDefault();
            const r = Math.min(8, Math.max(0, rowOf(selected) + arrow[0]));
            const c = Math.min(8, Math.max(0, colOf(selected) + arrow[1]));
            select(r * 9 + c, true);
        } else if (key === 'Backspace' || key === 'Delete' || key === '0') {
            event.preventDefault();
            erase();
        } else if (key === 'n') {
            toggleNotes();
        } else if (key === 'u') {
            undo();
        } else if (key === 'h') {
            hint();
        } else if (key === 'p' || key === 'Escape') {
            pause();
        }
        return;
    }
    if (command) return;
    if (state === 'paused' && (key === 'p' || key === 'Escape')) {
        resume();
        return;
    }
    if (state === 'confirm' && key === 'Escape') {
        cancelConfirm();
        return;
    }
    const onButton = event.target instanceof HTMLButtonElement;
    if (key === 'Enter' && !onButton && !event.repeat) {
        if (state === 'won' && performance.now() - overAt < RESTART_GRACE_MS) return;
        if (state === 'ready' || state === 'won') newGame();
        else if (state === 'paused') resume();
    }
});

function cancelConfirm() {
    pendingLevel = null;
    setState(confirmFrom);
    if (state === 'playing') focusSelected();
}

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
        case 'new':
            requestNewGame(level);
            break;
        case 'confirm':
            newGame(pendingLevel ?? level);
            pendingLevel = null;
            break;
        case 'cancel':
            cancelConfirm();
            break;
    }
});

$('new-btn').addEventListener('click', () => requestNewGame(level));
$('pause-btn').addEventListener('click', pause);

// 切到背景或失焦就暫停（盤面被蓋住、時間停止），回來由玩家按繼續
autoPause({ pause, resume() {} });
addEventListener('blur', pause);
addEventListener('pagehide', save);

// ---------- 啟動：有存檔就接著玩（先停在暫停畫面），否則顯示開始畫面與示意盤面 ----------

// 示意盤面：固定種子的題目，填了一部分、有幾格筆記、選取一個數字讓同數字的格子亮起來
function showDemo() {
    let seed = 11;
    const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    game = createSudoku({ level, random });
    const empty = game.values.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    empty.forEach((i, k) => {
        if (k % 3 === 0) game.setValue(i, game.solution[i]);
        else if (k % 7 === 1) {
            for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
                if (PEERS[i].every((p) => game.values[p] !== d) && (d + i) % 3 !== 0) game.toggleNote(i, d);
            }
        }
    });
    elapsed = 0;
    shown.fill(null);
    setState('ready');
    const center = game.values.findIndex((v, i) => v && rowOf(i) === 4 && colOf(i) >= 3);
    select(center >= 0 ? center : 40);
    renderBoard();
    renderHud();
}

const saved = loadSaved();
if (saved) {
    game = saved.game;
    level = game.level;
    elapsed = saved.time * 1000;
    select(firstEmpty());
    renderBoard();
    renderHud();
    setState('paused');
} else {
    showDemo();
}
