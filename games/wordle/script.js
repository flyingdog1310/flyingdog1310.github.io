// Wordle：畫面與操作。遊戲規則在 core.js，字庫在 words.js
import {
    MAX_GUESSES,
    WORD_LENGTH,
    createWordle,
    currentStreak,
    dailyAnswer,
    dayNumber,
    emptyStats,
    randomAnswer,
    recordResult,
    shareText,
} from './core.js';
import { ALLOWED, ANSWERS } from './words.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 翻牌：每格間隔與單格時間（與 style.css 的 flip 動畫一致）
const FLIP_STEP_MS = 300;
const FLIP_MS = 500;
const BOUNCE_STEP_MS = 100;
// 結束後先讓玩家看一下盤面再顯示結果
const RESULT_DELAY_MS = 1600;
const MODE_KEY = 'jsgames:wordle:mode';
const HARD_KEY = 'jsgames:wordle:hard';
const STATS_KEY = 'jsgames:wordle:stats';
const SAVE_KEYS = { daily: 'jsgames:wordle:daily', practice: 'jsgames:wordle:practice' };
const MODES = ['daily', 'practice'];
// 第幾次猜中時的稱讚
const PRAISE = ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'];
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];
const MARK_NAMES = { correct: 'correct', present: 'in the word', absent: 'not in the word' };

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.wordle');
const boardEl = $('board');
const keyboardEl = $('keyboard');
const toastsEl = $('toasts');
const statusText = $('status');
const overlays = {
    ready: $('overlay-ready'),
    result: $('overlay-result'),
    confirm: $('overlay-confirm'),
};
// 哪個狀態顯示哪個覆蓋畫面
const OVERLAY_OF = { ready: 'ready', over: 'result', stats: 'result', confirm: 'confirm' };

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isWord = (word) => ALLOWED.has(word);
// 各模式分開記錄最長連勝
const bests = Object.fromEntries(MODES.map((name) => [name, highScore(`wordle:${name}`)]));

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

// 每日題目只接著玩今天的；練習接著玩上次的字（包含已經結束、還沒按下一個字的）
function loadSaved(name) {
    const saved = readJSON(SAVE_KEYS[name]);
    if (!saved?.game || (name === 'daily' && saved.day !== dayNumber())) return null;
    try {
        return { game: createWordle({ state: saved.game, isWord }), day: saved.day ?? null };
    } catch {
        return null;
    }
}

function save() {
    if (!game || state === 'ready') return;
    writeStorage(SAVE_KEYS[mode], JSON.stringify({ day: mode === 'daily' ? day : null, game: game.toJSON() }));
}

const allStats = readJSON(STATS_KEY) ?? {};
const statsOf = (name) => allStats[name] ?? emptyStats();

// ---------- 狀態 ----------

let state = 'ready';
let mode = MODES.includes(readStorage(MODE_KEY)) ? readStorage(MODE_KEY) : 'daily';
let hard = readStorage(HARD_KEY) === '1';
let game = null;
// 目前這局每日題目的編號（練習為 null）
let day = null;
let revealing = false;
let overAt = 0;
let resultTimer = 0;
// 這局是否刷新最長連勝（結果畫面顯示）
let isRecord = false;
// 統計 / 確認畫面關掉後回到哪個狀態
let returnTo = 'playing';
let countdown = 0;

// ---------- 盤面與鍵盤 ----------

const rows = Array.from({ length: MAX_GUESSES }, () => {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'group');
    for (let i = 0; i < WORD_LENGTH; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.setAttribute('aria-hidden', 'true');
        row.append(tile);
    }
    return row;
});
boardEl.replaceChildren(...rows);
const tileAt = (r, c) => rows[r].children[c];

const keys = {};
keyboardEl.replaceChildren(
    ...KEY_ROWS.map((letters) => {
        const row = document.createElement('div');
        row.className = 'key-row';
        for (const ch of letters) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'key';
            if (ch === '+') {
                button.dataset.key = 'Enter';
                button.classList.add('key--wide');
                button.textContent = 'Enter';
            } else if (ch === '-') {
                button.dataset.key = 'Backspace';
                button.classList.add('key--wide');
                button.setAttribute('aria-label', 'Delete');
                button.innerHTML = '<svg><use href="#i-back" /></svg>';
            } else {
                button.dataset.key = ch;
                button.textContent = ch;
                keys[ch] = button;
            }
            row.append(button);
        }
        return row;
    })
);

function rowLabel(r) {
    const guesses = game.guesses;
    if (r < guesses.length) {
        const { word, marks } = guesses[r];
        const letters = [...word].map((ch, i) => `${ch.toUpperCase()} ${MARK_NAMES[marks[i]]}`).join(', ');
        return `Guess ${r + 1}: ${word.toUpperCase()}. ${letters}`;
    }
    if (r === guesses.length && game.current) {
        return `Guess ${r + 1}: ${[...game.current.toUpperCase()].join(' ')}`;
    }
    return `Guess ${r + 1}: empty`;
}

// 畫一列（不播動畫）
function renderRow(r) {
    const guess = game.guesses[r];
    const text = guess ? guess.word : r === game.row ? game.current : '';
    for (let c = 0; c < WORD_LENGTH; c++) {
        const tile = tileAt(r, c);
        tile.textContent = text[c] ?? '';
        tile.classList.toggle('is-filled', Boolean(text[c]));
        if (guess) tile.dataset.mark = guess.marks[c];
        else delete tile.dataset.mark;
    }
    rows[r].setAttribute('aria-label', rowLabel(r));
}

function renderBoard() {
    for (let r = 0; r < MAX_GUESSES; r++) {
        renderRow(r);
        for (const tile of rows[r].children) tile.classList.remove('is-flip', 'is-pop', 'is-bounce');
        rows[r].classList.remove('is-shake');
    }
}

function renderKeyboard() {
    const states = game.letterStates();
    for (const [ch, button] of Object.entries(keys)) {
        const mark = states[ch];
        if (mark) button.dataset.mark = mark;
        else delete button.dataset.mark;
        button.setAttribute('aria-label', mark ? `${ch.toUpperCase()}, ${MARK_NAMES[mark]}` : ch.toUpperCase());
    }
}

function renderHud() {
    root.dataset.mode = mode;
    for (const button of document.querySelectorAll('.mode')) {
        button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    $('hard-btn').setAttribute('aria-pressed', String(hard));
    $('streak').textContent = currentStreak(statsOf(mode), mode === 'daily' ? dayNumber() : null);
    $('best').textContent = bests[mode].get() ?? 0;
    $('ready-note').textContent =
        mode === 'daily'
            ? `Daily #${dayNumber()} · Everyone gets the same word today`
            : 'Practice · Unlimited random words';
}

function renderAll() {
    renderBoard();
    renderKeyboard();
    renderHud();
}

function animate(el, className, delay = 0) {
    if (reduceMotion.matches) return;
    el.classList.remove(className);
    el.style.setProperty('--delay', `${delay}ms`);
    void el.offsetWidth;
    el.classList.add(className);
}

function announce(text) {
    statusText.textContent = text;
}

// 畫面上方的提示（不搶焦點，朗讀交給 aria-live）
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

const titleOf = () => (mode === 'daily' ? `Wordle #${day}` : 'Wordle Practice');

// ---------- 結果與統計 ----------

function formatCountdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    return `${h}:${m}:${String(s % 60).padStart(2, '0')}`;
}

function untilMidnight() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
}

// 每日題目結束後：倒數下一題；過了午夜就可以玩新的一題
function renderNextNote() {
    const note = $('result-note');
    const next = $('next-btn');
    if (state !== 'over' || mode !== 'daily') return;
    if (dayNumber() !== day) {
        note.textContent = 'A new daily word is ready';
        next.textContent = 'Play today’s word';
    } else {
        note.textContent = `${isRecord ? 'New best streak · ' : ''}Next word in ${formatCountdown(untilMidnight())}`;
        next.textContent = 'Practice';
    }
}

function renderResult() {
    const over = state === 'over';
    const stats = statsOf(mode);
    const streak = currentStreak(stats, mode === 'daily' ? dayNumber() : null);
    const won = game?.status === 'won';
    $('result-title').textContent = over ? (won ? PRAISE[game.row - 1] : 'Not this time') : 'Statistics';

    const answer = $('result-answer');
    answer.hidden = !over;
    if (over) {
        answer.replaceChildren(
            ...[...game.answer].map((ch) => {
                const span = document.createElement('span');
                span.className = 'mini';
                span.dataset.mark = won ? 'correct' : 'absent';
                span.textContent = ch;
                return span;
            })
        );
        answer.setAttribute('aria-label', `The word was ${game.answer.toUpperCase()}`);
    }

    $('sum-played').textContent = stats.played;
    $('sum-rate').textContent = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    $('sum-streak').textContent = streak;
    $('sum-best').textContent = bests[mode].get() ?? 0;

    // 猜幾次的分布：長條以最多的一欄為滿，這一局的那一欄亮起來
    const most = Math.max(1, ...stats.dist);
    $('dist').replaceChildren(
        ...stats.dist.map((count, k) => {
            const li = document.createElement('li');
            const isThis = over && won && game.row === k + 1;
            li.classList.toggle('is-this', isThis);
            li.style.setProperty('--fill', count / most);
            li.innerHTML = `<span class="dist__n">${k + 1}</span><span class="dist__bar"><span>${count}</span></span>`;
            li.setAttribute('aria-label', `${k + 1} ${k === 0 ? 'guess' : 'guesses'}: ${count}`);
            return li;
        })
    );

    $('result-actions').hidden = !over;
    const note = $('result-note');
    note.classList.toggle('is-record', over && isRecord);
    note.textContent = over && isRecord ? 'New best streak' : '';
    $('next-btn').textContent = 'Next word';
    clearInterval(countdown);
    if (over && mode === 'daily') {
        renderNextNote();
        countdown = setInterval(renderNextNote, 1000);
    }
}

function recordStats() {
    const won = game.status === 'won';
    allStats[mode] = recordResult(statsOf(mode), { won, guesses: game.row, day: mode === 'daily' ? day : null });
    writeStorage(STATS_KEY, JSON.stringify(allStats));
    isRecord = won && bests[mode].submit(allStats[mode].streak);
}

// ---------- 遊戲流程 ----------

function setState(next) {
    state = next;
    root.dataset.state = next;
    const shown = OVERLAY_OF[next];
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== shown;
    if (shown === 'result') renderResult();
    else clearInterval(countdown);
}

function showResult() {
    setState('over');
    renderHud();
    overlays.result.querySelector('#next-btn').focus({ preventScroll: true });
}

// 開啟某個模式的這一局：有存檔就接著玩，否則出新題
function openGame(name, { fresh = false } = {}) {
    clearTimeout(resultTimer);
    revealing = false;
    mode = name;
    writeStorage(MODE_KEY, mode);
    const saved = fresh ? null : loadSaved(mode);
    if (saved) {
        game = saved.game;
        day = saved.day;
    } else {
        day = mode === 'daily' ? dayNumber() : null;
        const answer = mode === 'daily' ? dailyAnswer(day, ANSWERS) : randomAnswer(ANSWERS);
        game = createWordle({ answer, hard, isWord });
    }
    isRecord = false;
    state = 'playing';
    renderAll();
    save();
    if (game.status === 'playing') {
        setState('playing');
        announce(
            `${titleOf()}${game.hard ? ', hard mode' : ''}. ${game.row ? `${game.row} of ${MAX_GUESSES} guesses used` : 'Guess the word'}`
        );
    } else {
        showResult();
    }
}

function type(letter) {
    if (state !== 'playing' || revealing) return;
    const result = game.type(letter);
    if (!result) return;
    renderRow(result.row);
    animate(tileAt(result.row, result.col), 'is-pop');
    save();
}

function erase() {
    if (state !== 'playing' || revealing) return;
    const result = game.erase();
    if (!result) return;
    renderRow(result.row);
    save();
}

function submit() {
    if (state !== 'playing' || revealing) return;
    const result = game.submit();
    if (!result) return;
    if (result.error) {
        animate(rows[game.row], 'is-shake');
        toast(result.message);
        announce(result.message);
        return;
    }
    // 結果先存起來，動畫中途關掉也算數
    if (result.status !== 'playing') recordStats();
    save();
    reveal(result);
}

// 一格一格翻開，翻完才更新鍵盤與朗讀
function reveal(result) {
    const { row } = result;
    renderRow(row);
    const instant = reduceMotion.matches;
    for (let c = 0; c < WORD_LENGTH; c++) animate(tileAt(row, c), 'is-flip', c * FLIP_STEP_MS);
    revealing = true;
    setTimeout(
        () => {
            revealing = false;
            renderKeyboard();
            announce(rowLabel(row));
            if (result.status !== 'playing') finish(result);
        },
        instant ? 0 : (WORD_LENGTH - 1) * FLIP_STEP_MS + FLIP_MS
    );
}

function finish({ row, status }) {
    if (status === 'won') {
        for (let c = 0; c < WORD_LENGTH; c++) animate(tileAt(row, c), 'is-bounce', c * BOUNCE_STEP_MS);
        toast(PRAISE[row], RESULT_DELAY_MS);
        announce(`${PRAISE[row]}! Solved in ${row + 1} ${row ? 'guesses' : 'guess'}.`);
    } else {
        toast(game.answer.toUpperCase(), RESULT_DELAY_MS + 400);
        announce(`The word was ${game.answer.toUpperCase()}.`);
    }
    renderHud();
    resultTimer = setTimeout(
        () => {
            overAt = performance.now();
            showResult();
        },
        reduceMotion.matches ? 600 : RESULT_DELAY_MS
    );
}

function switchMode(name) {
    if (name === mode && state !== 'ready') return;
    if (state === 'ready') {
        // 開始畫面：只換模式說明，按開始才進入
        mode = name;
        writeStorage(MODE_KEY, mode);
        renderHud();
        return;
    }
    if (revealing) return;
    save();
    openGame(name);
}

// 練習模式：這一局還沒結束就換字，算輸
function requestNewWord() {
    if (mode !== 'practice' || revealing) return;
    if (game.status === 'playing' && game.row > 0) {
        returnTo = state;
        setState('confirm');
        overlays.confirm.querySelector('.btn').focus({ preventScroll: true });
        return;
    }
    openGame('practice', { fresh: true });
}

function skipWord() {
    const answer = game.answer.toUpperCase();
    allStats.practice = recordResult(statsOf('practice'), { won: false, guesses: game.row });
    writeStorage(STATS_KEY, JSON.stringify(allStats));
    openGame('practice', { fresh: true });
    toast(`The word was ${answer}`, 2200);
    announce(`The word was ${answer}. New word.`);
}

// 結果畫面上的主按鈕：練習→下一個字；每日→去練習，過了午夜則玩新的一題
function next() {
    if (mode === 'practice') openGame('practice', { fresh: true });
    else if (dayNumber() !== day) openGame('daily', { fresh: true });
    else openGame('practice');
}

function toggleHard() {
    hard = !hard;
    writeStorage(HARD_KEY, hard ? '1' : '0');
    renderHud();
    if (state === 'ready' || !game) {
        announce(`Hard mode ${hard ? 'on' : 'off'}`);
        return;
    }
    if (game.setHard(hard)) {
        save();
        announce(`Hard mode ${hard ? 'on' : 'off'}`);
    } else if (game.status === 'playing') {
        toast(`Hard mode ${hard ? 'starts' : 'ends'} with the next word`, 2000);
        announce(`Hard mode ${hard ? 'on' : 'off'} from the next word`);
    }
}

function openStats() {
    if (state === 'over' || state === 'confirm' || revealing) return;
    returnTo = state;
    setState('stats');
    overlays.result.querySelector('.result-close').focus({ preventScroll: true });
}

function closeOverlay() {
    if (state === 'stats' || state === 'confirm') setState(returnTo);
    // 結果畫面關掉後可以看盤面，按統計圖示再打開
    else if (state === 'over') setState('review');
}

async function share() {
    const text = shareText(game, titleOf());
    let copied = false;
    try {
        await navigator.clipboard.writeText(text);
        copied = true;
    } catch {
        // 首頁的 iframe 沒有剪貼簿權限時，改用舊的複製方式
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position: fixed; opacity: 0';
        document.body.append(area);
        area.select();
        try {
            copied = document.execCommand('copy');
        } catch {
            copied = false;
        }
        area.remove();
    }
    const message = copied ? 'Copied results to clipboard' : 'Could not copy results';
    toast(message, 1800);
    announce(message);
}

// ---------- 操作 ----------

keyboardEl.addEventListener('click', (event) => {
    const key = event.target.closest('.key')?.dataset.key;
    if (!key) return;
    if (key === 'Enter') submit();
    else if (key === 'Backspace') erase();
    else type(key);
});

// 螢幕鍵盤按下後不搶走焦點，避免實體 Enter 又按到同一顆鍵
keyboardEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.key')) event.preventDefault();
});

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const { key } = event;
    // 焦點在按鈕上時，Enter / Space 交給按鈕本身（螢幕鍵盤除外：Enter 一律是送出）
    const onButton = event.target instanceof HTMLButtonElement;
    if (state === 'playing') {
        if (key === 'Enter') {
            if (onButton && !event.target.closest('.keyboard')) return;
            event.preventDefault();
            if (!event.repeat) submit();
        } else if (key === 'Backspace') {
            event.preventDefault();
            erase();
        } else if (/^[a-z]$/i.test(key)) {
            type(key);
        }
        return;
    }
    if (key === 'Escape') {
        closeOverlay();
        return;
    }
    if (key === 'Enter' && !onButton && !event.repeat) {
        if (state === 'ready') openGame(mode);
        else if ((state === 'over' || state === 'review') && performance.now() - overAt >= RESTART_GRACE_MS) next();
    }
});

document.addEventListener('click', (event) => {
    const modeButton = event.target.closest('.mode');
    if (modeButton) {
        switchMode(modeButton.dataset.mode);
        return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    switch (action) {
        case 'start':
            openGame(mode);
            break;
        case 'next':
            // 用鍵盤按下（detail 為 0）時，結束後一小段時間內不接受，避免連按 Enter 直接跳過結算
            if (event.detail === 0 && performance.now() - overAt < RESTART_GRACE_MS) break;
            next();
            break;
        case 'share':
            share();
            break;
        case 'close':
        case 'cancel':
            closeOverlay();
            break;
        case 'confirm':
            skipWord();
            break;
    }
});

$('hard-btn').addEventListener('click', toggleHard);
$('stats-btn').addEventListener('click', () => (state === 'review' ? showResult() : openStats()));
$('new-btn').addEventListener('click', requestNewWord);
addEventListener('pagehide', save);

// ---------- 啟動：有進行中或今天已完成的局面就直接打開，否則顯示開始畫面與示意盤面 ----------

// 示意盤面：猜了兩次、第三列打到一半，鍵盤也上了色
function showDemo() {
    game = createWordle({ answer: 'prime' });
    for (const word of ['stare', 'pride']) {
        for (const ch of word) game.type(ch);
        game.submit();
    }
    for (const ch of 'pri') game.type(ch);
    day = null;
    setState('ready');
    renderAll();
}

const saved = loadSaved(mode);
if (saved && (saved.game.row > 0 || saved.game.current)) openGame(mode);
else showDemo();
