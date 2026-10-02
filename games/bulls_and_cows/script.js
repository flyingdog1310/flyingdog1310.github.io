// 猜數字（Bulls and Cows）：畫面與操作。遊戲規則在 core.js
import { LEVELS, createBullsAndCows } from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 猜中後先讓玩家看一下盤面再顯示結果
const RESULT_DELAY_MS = 1400;
const BOUNCE_STEP_MS = 90;
const LEVEL_KEY = 'jsgames:bulls-and-cows:level';
const HELPER_KEY = 'jsgames:bulls-and-cows:helper';
const SAVE_KEY = 'jsgames:bulls-and-cows:game';
const STATS_KEY = 'jsgames:bulls-and-cows:stats';
// 螢幕數字鍵：電話鍵盤的排列
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Backspace', '0', 'Enter'];
// 示意盤面（開始畫面後方）：各位數的答案、已經猜過的數字、正在輸入的數字
const DEMOS = {
    3: { secret: '507', guesses: ['123', '456', '750'], current: '5' },
    4: { secret: '4071', guesses: ['1234', '5678', '0419'], current: '40' },
    5: { secret: '40712', guesses: ['01234', '56789', '10425'], current: '4' },
};

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.bulls');
const historyEl = $('history');
const entryEl = $('entry');
const keypadEl = $('keypad');
const toastsEl = $('toasts');
const statusText = $('status');
const overlays = {
    ready: $('overlay-ready'),
    over: $('overlay-over'),
    confirm: $('overlay-confirm'),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
// 各位數分開記錄最少猜測次數
const bests = Object.fromEntries(
    Object.keys(LEVELS).map((name) => [name, highScore(`bulls-and-cows:${name}`, { order: 'asc' })])
);

// ---------- 存檔 ----------

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

function readJSON(key) {
    try {
        return JSON.parse(readStorage(key));
    } catch {
        return null;
    }
}

function loadSaved() {
    const saved = readJSON(SAVE_KEY);
    if (!(saved?.level in LEVELS) || !saved.game) return null;
    try {
        const restored = createBullsAndCows({ state: saved.game });
        if (restored.status !== 'playing' || restored.length !== LEVELS[saved.level].length) return null;
        return { level: saved.level, assisted: Boolean(saved.assisted), game: restored };
    } catch {
        return null;
    }
}

// 只存進行中的局面；結束就清掉，下次開啟從開始畫面開始
function save() {
    if (state === 'ready' || !game) return;
    if (game.status !== 'playing') writeStorage(SAVE_KEY, null);
    else writeStorage(SAVE_KEY, JSON.stringify({ level, assisted, game: game.toJSON() }));
}

// 各位數的統計：猜中幾局、總共猜了幾次（算平均用）；用了提示的局不算
const allStats = readJSON(STATS_KEY) ?? {};
const statsOf = (name) => allStats[name] ?? { solved: 0, guesses: 0 };

// ---------- 狀態 ----------

let state = 'ready';
let level = readStorage(LEVEL_KEY) in LEVELS ? readStorage(LEVEL_KEY) : 'normal';
// 提示開關（偏好設定）與這一局是否開過提示（開過就不記錄）
let helper = readStorage(HELPER_KEY) === '1';
let assisted = false;
let pendingLevel = null;
let game = null;
let overAt = 0;
let resultTimer = 0;

// ---------- 盤面 ----------

function makeTile(digit = '') {
    const tile = document.createElement('span');
    tile.className = 'tile';
    tile.textContent = digit;
    return tile;
}

function makeChip(count, kind) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.kind = kind;
    chip.classList.toggle('is-zero', count === 0);
    chip.textContent = `${count}${kind.toUpperCase()}`;
    return chip;
}

function guessLabel(r) {
    const { code, bulls, cows } = game.guesses[r];
    return `Guess ${r + 1}: ${[...code].join(' ')}. ${bulls} A, ${cows} B`;
}

function makeRow(r) {
    const { code, bulls, cows } = game.guesses[r];
    const li = document.createElement('li');
    li.className = 'guess';
    li.setAttribute('aria-label', guessLabel(r));
    const n = document.createElement('span');
    n.className = 'guess__n';
    n.textContent = r + 1;
    const tiles = document.createElement('span');
    tiles.className = 'tiles';
    tiles.append(...[...code].map((d) => makeTile(d)));
    if (bulls === game.length) tiles.dataset.solved = '';
    const result = document.createElement('span');
    result.className = 'result';
    result.append(makeChip(bulls, 'a'), makeChip(cows, 'b'));
    for (const el of [n, tiles, result]) el.setAttribute('aria-hidden', 'true');
    li.append(n, tiles, result);
    return li;
}

function renderHistory() {
    historyEl.replaceChildren(...game.guesses.map((_, r) => makeRow(r)));
    $('empty').hidden = game.guesses.length > 0;
    scrollHistory(false);
}

function scrollHistory(smooth = true) {
    historyEl.scrollTo({ top: historyEl.scrollHeight, behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto' });
}

function renderEntry() {
    const done = game.status !== 'playing';
    // 結束後輸入列顯示答案
    const text = done ? game.secret : game.current;
    if (entryEl.children.length !== game.length) {
        entryEl.replaceChildren(...Array.from({ length: game.length }, () => makeTile()));
    }
    [...entryEl.children].forEach((tile, i) => {
        tile.textContent = text[i] ?? '';
        tile.classList.toggle('is-filled', Boolean(text[i]));
        tile.classList.toggle('is-cursor', !done && i === game.current.length);
    });
    entryEl.dataset.status = game.status;
    entryEl.setAttribute(
        'aria-label',
        done ? `The number: ${[...game.secret].join(' ')}` : `Your guess: ${[...game.current].join(' ') || 'empty'}`
    );
}

// 提示：數字鍵與盤面上的數字標出一定不在 / 一定在答案裡
function renderHints() {
    const show = helper && game;
    root.dataset.helper = show ? 'on' : 'off';
    const states = show ? game.digitStates() : {};
    for (const key of keypadEl.querySelectorAll('[data-digit]')) {
        const d = key.dataset.digit;
        setHint(key, states[d]);
        key.classList.toggle('is-used', game?.status === 'playing' && game.current.includes(d));
        const hint = states[d] === 'out' ? ', not in the number' : states[d] === 'in' ? ', in the number' : '';
        key.setAttribute('aria-label', `${d}${hint}`);
    }
    for (const tile of historyEl.querySelectorAll('.tile')) setHint(tile, states[tile.textContent]);
    $('left').textContent = show ? game.candidates().length : '–';
}

function setHint(el, hint) {
    if (hint) el.dataset.hint = hint;
    else delete el.dataset.hint;
}

function renderHud() {
    root.style.setProperty('--len', LEVELS[level].length);
    $('count').textContent = game ? game.guesses.length : 0;
    const record = bests[level].get();
    $('best').textContent = record === null ? '–' : record;
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.level === (pendingLevel ?? level)));
    }
    $('helper-btn').setAttribute('aria-pressed', String(helper));
    $('ready-note').textContent = helper
        ? 'Helper is on: digits it can rule out are dimmed, and games are not recorded.'
        : 'Turn on the helper to see which digits are ruled out.';
}

function renderAll() {
    renderHistory();
    renderEntry();
    renderHints();
    renderHud();
}

function animate(el, className, delay = 0) {
    if (reduceMotion.matches || !el) return;
    el.classList.remove(className);
    el.style.setProperty('--delay', `${delay}ms`);
    void el.offsetWidth;
    el.classList.add(className);
}

function announce(text) {
    statusText.textContent = text;
}

// 盤面上方的提示（不搶焦點，朗讀交給 aria-live）
function toast(text, duration = 1400) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toastsEl.prepend(el);
    setTimeout(() => {
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 300);
    }, duration);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;

// ---------- 遊戲流程 ----------

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
}

function newGame(nextLevel = level) {
    clearTimeout(resultTimer);
    level = nextLevel;
    pendingLevel = null;
    writeStorage(LEVEL_KEY, level);
    game = createBullsAndCows({ length: LEVELS[level].length });
    assisted = helper;
    setState('playing');
    renderAll();
    save();
    announce(`New ${game.length}-digit number. Type your first guess.`);
}

// 已經猜過的局換位數或開新局：先確認放棄
function requestNewGame(nextLevel = level) {
    if (state === 'ready') {
        // 開始畫面：只換位數和示意盤面，按開始才進入
        level = nextLevel;
        writeStorage(LEVEL_KEY, level);
        showDemo();
        return;
    }
    if (state === 'confirm') return;
    if (state === 'playing' && game.guesses.length > 0) {
        pendingLevel = nextLevel;
        setState('confirm');
        renderHud();
        overlays.confirm.querySelector('.btn').focus({ preventScroll: true });
        return;
    }
    newGame(nextLevel);
}

function cancelConfirm() {
    pendingLevel = null;
    setState('playing');
    renderHud();
}

function giveUp() {
    if (!game.giveUp()) return;
    save();
    renderEntry();
    renderHints();
    animate(entryEl, 'is-reveal');
    announce(`The number was ${[...game.secret].join(' ')}.`);
    setState('playing');
    finish();
}

function type(digit) {
    if (state !== 'playing') return;
    const result = game.type(digit);
    if (!result) return;
    if (result.error) {
        animate(entryEl.children[result.col], 'is-nudge');
        toast(`${digit} is already in your guess`);
        announce(`${digit} is already in your guess`);
        return;
    }
    renderEntry();
    renderHints();
    animate(entryEl.children[result.col], 'is-pop');
    save();
}

function erase() {
    if (state !== 'playing') return;
    if (!game.erase()) return;
    renderEntry();
    renderHints();
    save();
}

function submit() {
    if (state !== 'playing') return;
    const result = game.submit();
    if (!result) return;
    if (result.error) {
        animate(entryEl, 'is-shake');
        toast(result.message);
        announce(result.message);
        return;
    }
    const row = makeRow(result.row);
    historyEl.append(row);
    $('empty').hidden = true;
    animate(row, 'is-new');
    renderEntry();
    renderHints();
    renderHud();
    scrollHistory();
    save();
    if (result.won) {
        recordResult();
        const tiles = row.querySelectorAll('.tile');
        tiles.forEach((tile, i) => animate(tile, 'is-bounce', 250 + i * BOUNCE_STEP_MS));
        toast(`Solved in ${plural(game.guesses.length, 'guess')}`, RESULT_DELAY_MS);
        announce(`${result.bulls} A. Solved in ${plural(game.guesses.length, 'guess')}!`);
        navigator.vibrate?.(20);
        finish();
        return;
    }
    let text = guessLabel(result.row);
    if (helper) text += `. ${game.candidates().length} possible`;
    announce(text);
}

// 這一局是否刷新紀錄（結果畫面顯示）
let isRecord = false;

function recordResult() {
    isRecord = false;
    if (assisted) return;
    const stats = statsOf(level);
    allStats[level] = { solved: stats.solved + 1, guesses: stats.guesses + game.guesses.length };
    writeStorage(STATS_KEY, JSON.stringify(allStats));
    isRecord = bests[level].submit(game.guesses.length);
}

function finish() {
    const won = game.status === 'won';
    resultTimer = setTimeout(
        () => {
            overAt = performance.now();
            renderResult(won);
            setState('over');
            renderHud();
            overlays.over.querySelector('.btn').focus({ preventScroll: true });
        },
        reduceMotion.matches ? 500 : won ? RESULT_DELAY_MS : 900
    );
}

function renderResult(won) {
    const n = game.guesses.length;
    $('over-title').textContent = won ? (n <= 3 ? 'Brilliant' : n <= 6 ? 'Well done' : 'Got it') : 'The number was';
    const answer = $('over-answer');
    answer.replaceChildren(...[...game.secret].map((d) => makeTile(d)));
    answer.dataset.won = String(won);
    answer.setAttribute('aria-label', [...game.secret].join(' '));
    $('over-score').textContent = won ? `${plural(n, 'guess')}` : n ? `after ${plural(n, 'guess')}` : '';

    const stats = statsOf(level);
    const best = bests[level].get();
    $('sum-solved').textContent = stats.solved;
    $('sum-average').textContent = stats.solved ? (stats.guesses / stats.solved).toFixed(1) : '–';
    $('sum-best').textContent = best ?? '–';

    const note = $('over-note');
    const levelName = `${game.length} digits`;
    if (!won) note.textContent = `${levelName} · Better luck next time`;
    else if (assisted) note.textContent = `${levelName} · Helper used, not recorded`;
    else if (isRecord) note.textContent = `${levelName} · New best`;
    else note.textContent = `${levelName} · Best ${plural(best, 'guess')}`;
    note.classList.toggle('is-record', won && isRecord);
}

function toggleHelper() {
    helper = !helper;
    writeStorage(HELPER_KEY, helper ? '1' : '0');
    if (helper && state !== 'ready' && game.status === 'playing' && !assisted) {
        assisted = true;
        save();
        toast('Helper on · this game won’t be recorded', 2000);
    }
    renderHints();
    renderHud();
    announce(helper ? `Helper on. ${game.candidates().length} possible numbers.` : 'Helper off');
}

// ---------- 操作 ----------

keypadEl.replaceChildren(
    ...KEYPAD.map((key) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'key';
        button.dataset.key = key;
        if (key === 'Backspace') {
            button.classList.add('key--action');
            button.setAttribute('aria-label', 'Delete');
            button.innerHTML = '<svg><use href="#i-back" /></svg>';
        } else if (key === 'Enter') {
            button.classList.add('key--enter');
            button.setAttribute('aria-label', 'Submit guess');
            button.innerHTML = '<svg><use href="#i-enter" /></svg>';
        } else {
            button.dataset.digit = key;
            button.textContent = key;
        }
        return button;
    })
);

keypadEl.addEventListener('click', (event) => {
    const key = event.target.closest('.key')?.dataset.key;
    if (!key) return;
    if (key === 'Enter') submit();
    else if (key === 'Backspace') erase();
    else type(key);
});

// 螢幕數字鍵按下後不搶走焦點，避免實體 Enter 又按到同一顆鍵
keypadEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.key')) event.preventDefault();
});

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const { key } = event;
    // 焦點在按鈕上時，Enter / Space 交給按鈕本身（螢幕數字鍵除外：Enter 一律是送出）
    const onButton = event.target instanceof HTMLButtonElement;
    if (key === 'h' || key === 'H') {
        toggleHelper();
        return;
    }
    if (state === 'playing') {
        if (key === 'Enter') {
            if (onButton && !event.target.closest('.keypad')) return;
            event.preventDefault();
            if (!event.repeat) submit();
        } else if (key === 'Backspace') {
            event.preventDefault();
            erase();
        } else if (/^\d$/.test(key)) {
            type(key);
        }
        return;
    }
    if (state === 'confirm' && key === 'Escape') {
        cancelConfirm();
        return;
    }
    if (key === 'Enter' && !onButton && !event.repeat) {
        if (state === 'over' && performance.now() - overAt < RESTART_GRACE_MS) return;
        if (state === 'ready' || state === 'over') {
            event.preventDefault();
            newGame(state === 'over' ? (pendingLevel ?? level) : level);
        }
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
            newGame();
            break;
        case 'restart':
            // 用鍵盤按下（detail 為 0）時，結束後一小段時間內不接受，避免連按 Enter 直接跳過結算
            if (event.detail === 0 && performance.now() - overAt < RESTART_GRACE_MS) break;
            newGame(pendingLevel ?? level);
            break;
        case 'confirm':
            giveUp();
            break;
        case 'cancel':
            cancelConfirm();
            break;
    }
});

$('helper-btn').addEventListener('click', toggleHelper);
$('new-btn').addEventListener('click', () => requestNewGame(level));
addEventListener('pagehide', save);

// ---------- 啟動：有進行中的局面就直接接著玩，否則顯示開始畫面與示意盤面 ----------

function showDemo() {
    const demo = DEMOS[LEVELS[level].length];
    game = createBullsAndCows({ state: { length: demo.secret.length, ...demo } });
    setState('ready');
    renderAll();
}

const saved = loadSaved();
if (saved && (saved.game.guesses.length > 0 || saved.game.current)) {
    level = saved.level;
    game = saved.game;
    assisted = saved.assisted;
    setState('playing');
    renderAll();
    announce(`${game.length} digits. ${plural(game.guesses.length, 'guess')} so far.`);
} else {
    showDemo();
}
