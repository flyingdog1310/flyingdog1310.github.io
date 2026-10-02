// 四子棋：畫面與操作。遊戲規則與電腦對手在 core.js
import { COLS, LEVELS, ROWS, WINDOWS, chooseMove, createConnectFour, indexOf, landingRow, other } from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 電腦「想一下」再下，看得出是它下的（hard 的計算時間另外算）
const THINK_MS = [350, 600];
// 棋子落下、連線亮起之後再顯示結果
const RESULT_DELAY_MS = 1200;

const SAVE_KEY = 'jsgames:connect-four:game';
const OPPONENT_KEY = 'jsgames:connect-four:opponent';
const FIRST_KEY = 'jsgames:connect-four:first';
const STATS_KEY = 'jsgames:connect-four:stats';

// 對手：電腦的三種難度，或兩人同一台裝置輪流下
const OPPONENTS = [...LEVELS, 'duo'];
const OPPONENT_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', duo: '2 players' };
// 對電腦時玩家固定是紅、電腦是黃，輪流先下
const HUMAN = 'R';
const CPU = 'Y';
const COLOR = { R: 'red', Y: 'yellow' };
const NAME = { R: 'Red', Y: 'Yellow' };

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.c4');
const discsEl = $('discs');
const columnsEl = $('columns');
const statusText = $('status');
const overlays = { ready: $('overlay-ready'), over: $('overlay-over'), confirm: $('overlay-confirm') };

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

// 對電腦的戰績（各難度分開）：贏 / 和 / 輸，與目前連續不敗的局數；最長連續不敗用 highScore 記錄
const allStats = readJSON(STATS_KEY) ?? {};
const statsOf = (level) => ({ win: 0, draw: 0, loss: 0, streak: 0, ...allStats[level] });
const bests = Object.fromEntries(LEVELS.map((level) => [level, highScore(`connect-four:${level}`)]));

// 兩人對戰的比數只記在這次開啟的期間
const duoTally = { R: 0, Y: 0, draw: 0 };

// ---------- 狀態 ----------

let state = 'ready';
let opponent = OPPONENTS.includes(readStorage(OPPONENT_KEY)) ? readStorage(OPPONENT_KEY) : 'normal';
let nextFirst = readStorage(FIRST_KEY) === 'Y' ? 'Y' : 'R';
let pendingOpponent = null;
let game = null;
// 這局對電腦時收回過棋，結果就不記入戰績
let assisted = false;
let columns = [];
// 每一格的棋子元素（沒有棋子時為 null）
let discs = [];
let ghost = null;
// 鍵盤游標所在的行，與目前預覽（滑鼠滑過或鍵盤聚焦）的行
let cursor = 3;
let preview = -1;
let overAt = 0;
let thinkTimer = 0;
let resultTimer = 0;

const vsCpu = () => opponent !== 'duo';
const isCpuTurn = () => vsCpu() && game.status === 'playing' && game.turn === CPU;
const humanCanPlay = () => state === 'playing' && game.status === 'playing' && !isCpuTurn();

// 朗讀「輪到誰」；輪到電腦時不唸，等它下完再一起唸
function turnPrompt() {
    if (game.status !== 'playing' || isCpuTurn()) return '';
    return vsCpu() ? 'Your turn.' : `${NAME[game.turn]} to move.`;
}

// 只存進行中的局面；結束就清掉，下次開啟從開始畫面開始
function save() {
    if (state === 'ready' || !game) return;
    if (game.status !== 'playing' || game.moves.length === 0) writeStorage(SAVE_KEY, null);
    else writeStorage(SAVE_KEY, JSON.stringify({ opponent, assisted, game: game.toJSON() }));
}

function loadSaved() {
    const saved = readJSON(SAVE_KEY);
    if (!OPPONENTS.includes(saved?.opponent) || !saved.game) return null;
    try {
        const restored = createConnectFour({ state: saved.game });
        if (restored.status !== 'playing' || restored.moves.length === 0) return null;
        return { opponent: saved.opponent, assisted: Boolean(saved.assisted), game: restored };
    } catch {
        return null;
    }
}

// ---------- 盤面 ----------

function buildBoard() {
    columns = Array.from({ length: COLS }, (_, c) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'column';
        button.dataset.c = c;
        button.tabIndex = c === cursor ? 0 : -1;
        return button;
    });
    columnsEl.replaceChildren(...columns);
    ghost = document.createElement('div');
    ghost.className = 'disc disc--ghost';
    discsEl.replaceChildren(ghost);
    discs = Array(ROWS * COLS).fill(null);
}

function placeDisc(el, index) {
    el.style.setProperty('--r', Math.floor(index / COLS));
    el.style.setProperty('--c', index % COLS);
}

// 依 game.board 重畫所有棋子；animate 是剛落下要播落下動畫的格子
function renderDiscs(animate = -1) {
    for (let i = 0; i < ROWS * COLS; i++) {
        const mark = game.board[i];
        let el = discs[i];
        if (!mark) {
            el?.remove();
            discs[i] = null;
            continue;
        }
        if (!el || el.dataset.mark !== mark) {
            el?.remove();
            el = document.createElement('div');
            el.className = 'disc';
            el.dataset.mark = mark;
            placeDisc(el, i);
            discsEl.append(el);
            discs[i] = el;
        }
        if (i === animate) {
            // 從盤面上緣落到這一列，距離越長越久（自由落體：時間與距離的平方根成正比）
            const fall = Math.floor(i / COLS) + 1;
            el.style.setProperty('--fall', fall);
            el.style.setProperty('--dur', `${Math.round(120 * Math.sqrt(fall) + 120)}ms`);
            el.classList.remove('is-new');
            void el.offsetWidth;
            el.classList.add('is-new');
        } else {
            el.classList.remove('is-new');
        }
    }
    const last = game.lastIndex();
    const winning = new Set(game.winner?.cells ?? []);
    discs.forEach((el, i) => {
        if (!el) return;
        el.classList.toggle('is-last', i === last && game.status === 'playing');
        el.classList.toggle('is-win', winning.has(i));
    });
    root.dataset.result = game.status === 'won' ? `win-${game.winner.mark}` : game.status;
    renderColumns();
    renderGhost();
}

// 每一行的 aria-label：由下往上的棋子與剩下幾格
function columnLabel(c) {
    const stack = [];
    for (let r = ROWS - 1; r >= 0; r--) {
        const mark = game.board[indexOf(r, c)];
        if (mark) stack.push(COLOR[mark]);
    }
    const left = ROWS - stack.length;
    const content = stack.length ? `bottom to top ${stack.join(', ')}` : 'empty';
    const room = left === 0 ? 'full' : left === ROWS ? '' : `${left} ${left === 1 ? 'space' : 'spaces'} left`;
    return `Column ${c + 1}: ${[content, room].filter(Boolean).join('; ')}`;
}

function renderColumns() {
    columns.forEach((el, c) => {
        const full = landingRow(game.board, c) === -1;
        el.classList.toggle('is-full', full);
        el.setAttribute('aria-disabled', String(full || game.status !== 'playing'));
        el.setAttribute('aria-label', columnLabel(c));
    });
}

// 合法步的提示：預覽的行顯示輪到的那一方的棋子會落在哪
function renderGhost() {
    const row = preview >= 0 && humanCanPlay() ? landingRow(game.board, preview) : -1;
    columns.forEach((el, c) => el.classList.toggle('is-preview', c === preview && humanCanPlay()));
    if (row === -1) {
        ghost.hidden = true;
        return;
    }
    ghost.hidden = false;
    ghost.dataset.mark = game.turn;
    placeDisc(ghost, indexOf(row, preview));
}

function setPreview(c) {
    preview = c;
    renderGhost();
}

// ---------- 分數列與提示文字 ----------

function renderHud() {
    root.dataset.mode = vsCpu() ? 'cpu' : 'duo';
    root.dataset.turn = game.status === 'playing' ? game.turn : '';
    // 玩家現在可以下棋（給預覽與游標樣式用）
    root.dataset.input = humanCanPlay() ? 'on' : 'off';
    $('name-r').textContent = vsCpu() ? 'You' : 'Red';
    $('name-y').textContent = vsCpu() ? 'Computer' : 'Yellow';
    if (vsCpu()) {
        const stats = statsOf(opponent);
        $('wins-r').textContent = stats.win;
        $('wins-y').textContent = stats.loss;
        $('draws').textContent = stats.draw;
    } else {
        $('wins-r').textContent = duoTally.R;
        $('wins-y').textContent = duoTally.Y;
        $('draws').textContent = duoTally.draw;
    }
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.opponent === opponent));
    }
    const humanMoves = vsCpu() ? countHumanMoves() : game.moves.length;
    $('undo-btn').disabled = !(state === 'playing' && game.status === 'playing' && humanMoves > 0);
    renderGhost();
    renderInfo();
}

// 對電腦時玩家下過幾步（先手是誰決定了哪幾步是玩家的）
const countHumanMoves = () =>
    game.moves.filter((_, k) => (k % 2 === 0 ? game.first : other(game.first)) === HUMAN).length;

function renderInfo() {
    const turn = $('turn');
    if (game.status !== 'playing') turn.textContent = '';
    else if (vsCpu()) turn.textContent = game.turn === HUMAN ? 'Your turn' : 'Computer is thinking…';
    else turn.textContent = `${NAME[game.turn]} to move`;
    turn.dataset.mark = game.status === 'playing' ? game.turn : '';

    const note = $('note');
    if (vsCpu()) {
        const best = bests[opponent].get() ?? 0;
        note.textContent = assisted
            ? 'Undo used · this game won’t count'
            : `Unbeaten streak ${statsOf(opponent).streak} · Best ${best}`;
    } else {
        note.textContent = `${NAME[game.first]} started this game · starts alternate`;
    }
}

function announce(text) {
    statusText.textContent = text;
}

// ---------- 遊戲流程 ----------

function setState(next) {
    state = next;
    root.dataset.state = next;
    if (game) root.dataset.input = humanCanPlay() ? 'on' : 'off';
    if (next !== 'over') delete root.dataset.outcome;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
}

function clearTimers() {
    clearTimeout(thinkTimer);
    clearTimeout(resultTimer);
}

function startTurnAnnouncement() {
    if (vsCpu()) return game.turn === HUMAN ? 'You go first with red.' : 'Computer goes first.';
    return `${NAME[game.turn]} goes first.`;
}

function newGame(nextOpponent = opponent) {
    clearTimers();
    opponent = nextOpponent;
    writeStorage(OPPONENT_KEY, opponent);
    game = createConnectFour({ first: nextFirst });
    // 下一局換另一方先下
    nextFirst = other(nextFirst);
    writeStorage(FIRST_KEY, nextFirst);
    assisted = false;
    setState('playing');
    renderDiscs();
    renderHud();
    save();
    columns[cursor].focus({ preventScroll: true });
    announce(`${OPPONENT_NAMES[opponent]}. ${startTurnAnnouncement()}`);
    scheduleCpu();
}

// 已經下過棋的局，換對手或開新局要先確認
function requestNewGame(nextOpponent = opponent) {
    if (state === 'ready') {
        // 開始畫面：只換對手和示意盤面，按開始才進入
        opponent = nextOpponent;
        writeStorage(OPPONENT_KEY, opponent);
        showDemo();
        return;
    }
    if (state === 'playing' && game.status === 'playing' && game.moves.length > 0) {
        pendingOpponent = nextOpponent;
        clearTimeout(thinkTimer);
        setState('confirm');
        overlays.confirm.querySelector('.btn').focus({ preventScroll: true });
        return;
    }
    if (state === 'confirm') return;
    newGame(nextOpponent);
}

function cancelConfirm() {
    pendingOpponent = null;
    setState('playing');
    renderHud();
    columns[cursor].focus({ preventScroll: true });
    scheduleCpu();
}

function scheduleCpu() {
    clearTimeout(thinkTimer);
    if (state !== 'playing' || !isCpuTurn()) return;
    const [min, max] = THINK_MS;
    // 第一步不需要想太久
    const delay = game.moves.length === 0 ? min : min + Math.random() * (max - min);
    thinkTimer = setTimeout(() => {
        if (state !== 'playing' || !isCpuTurn()) return;
        const col = chooseMove(game.board, CPU, opponent);
        place(col, `Computer drops yellow in column ${col + 1}.`);
    }, delay);
}

// 下一步並更新畫面；prefix 是要朗讀的這一步
function place(col, prefix) {
    const result = game.play(col);
    if (!result) return;
    navigator.vibrate?.(8);
    renderDiscs(result.index);
    renderHud();
    save();

    if (result.won || result.draw) {
        finish(prefix);
        return;
    }
    announce(`${prefix} ${turnPrompt()}`.trim());
    scheduleCpu();
}

function play(c) {
    if (!humanCanPlay()) return;
    if (landingRow(game.board, c) === -1) {
        // 這一行滿了：輕輕搖一下表示不能下
        const el = columns[c];
        el.classList.remove('is-rejected');
        void el.offsetWidth;
        el.classList.add('is-rejected');
        announce(`Column ${c + 1} is full.`);
        return;
    }
    const mark = game.turn;
    place(c, vsCpu() ? `You drop red in column ${c + 1}.` : `${NAME[mark]} in column ${c + 1}.`);
}

function undo() {
    if (state !== 'playing' || game.status !== 'playing') return;
    clearTimeout(thinkTimer);
    let removed = 0;
    if (vsCpu()) {
        // 收回到上一次輪到玩家的時候：電腦的回應與玩家的那一步
        if (countHumanMoves() === 0) return scheduleCpu();
        do {
            game.undo();
            removed += 1;
        } while (game.turn !== HUMAN);
        assisted = true;
    } else if (game.undo()) {
        removed = 1;
    }
    if (!removed) return;
    renderDiscs();
    renderHud();
    save();
    announce(`Took back ${removed === 1 ? 'one move' : `${removed} moves`}. ${turnPrompt()}`);
}

// 連線的方向（給朗讀用）：找一組完全落在連線格子裡的四格窗
function lineName(cells) {
    const set = new Set(cells);
    const w = WINDOWS.find((win) => win.every((i) => set.has(i)));
    const step = w[1] - w[0];
    return step === 1 ? 'across' : step === COLS ? 'vertically' : 'diagonally';
}

function finish(prefix) {
    clearTimeout(thinkTimer);
    const win = game.winner;
    let title;
    let spoken;
    if (win) {
        title = vsCpu() ? (win.mark === HUMAN ? 'You win' : 'Computer wins') : `${NAME[win.mark]} wins`;
        spoken = `${title} with four ${lineName(win.cells)}.`;
    } else {
        title = 'Draw';
        spoken = 'The board is full. Draw.';
    }

    let detail = '';
    let note = '';
    let record = false;
    if (vsCpu()) {
        if (assisted) {
            note = 'Undo used · not counted';
        } else {
            const stats = statsOf(opponent);
            const outcome = !win ? 'draw' : win.mark === HUMAN ? 'win' : 'loss';
            stats[outcome] += 1;
            stats.streak = outcome === 'loss' ? 0 : stats.streak + 1;
            allStats[opponent] = stats;
            writeStorage(STATS_KEY, JSON.stringify(allStats));
            record = stats.streak > 0 && bests[opponent].submit(stats.streak);
            const best = bests[opponent].get() ?? 0;
            detail = `${OPPONENT_NAMES[opponent]} · ${stats.win} won, ${stats.draw} drawn, ${stats.loss} lost`;
            if (record) note = `New best · ${stats.streak} ${stats.streak === 1 ? 'game' : 'games'} unbeaten`;
            else if (outcome === 'loss') note = best > 0 ? `Streak reset · Best ${best}` : 'Streak reset';
            else note = `Unbeaten streak ${stats.streak} · Best ${best}`;
        }
    } else {
        duoTally[win ? win.mark : 'draw'] += 1;
        detail = `Red ${duoTally.R} · Draws ${duoTally.draw} · Yellow ${duoTally.Y}`;
        note = `${NAME[nextFirst]} goes first next`;
    }
    if (record) spoken += ` New best unbeaten streak: ${statsOf(opponent).streak}.`;
    announce(`${prefix} ${spoken}`);
    renderHud();
    // 結束就清掉存檔
    save();

    resultTimer = setTimeout(() => {
        $('over-title').textContent = title;
        $('over-detail').textContent = detail;
        $('over-detail').hidden = !detail;
        const noteEl = $('over-note');
        noteEl.textContent = note;
        noteEl.classList.toggle('is-record', record);
        overAt = performance.now();
        setState('over');
        root.dataset.outcome = !win ? 'draw' : vsCpu() ? (win.mark === HUMAN ? 'win' : 'loss') : 'win';
        // 卡片放在離連線遠的一側（上方或下方），讓連線保持看得到
        const rows = win ? win.cells.map((i) => Math.floor(i / COLS)) : [ROWS];
        root.dataset.card = rows.reduce((a, b) => a + b, 0) / rows.length < ROWS / 2 ? 'bottom' : 'top';
        overlays.over.querySelector('.btn').focus({ preventScroll: true });
    }, RESULT_DELAY_MS);
}

// ---------- 操作 ----------

columnsEl.addEventListener('click', (event) => {
    const el = event.target.closest('.column');
    if (!el) return;
    const c = Number(el.dataset.c);
    moveCursor(c, false);
    play(c);
});

// 滑鼠滑過時預覽；觸控沒有滑過，點了就直接下
columnsEl.addEventListener('pointerover', (event) => {
    const el = event.target.closest('.column');
    if (el && event.pointerType === 'mouse') setPreview(Number(el.dataset.c));
});
columnsEl.addEventListener('pointerleave', () => setPreview(-1));
// 鍵盤聚焦時預覽游標所在的行
columnsEl.addEventListener('focusin', (event) => {
    const c = Number(event.target.dataset.c);
    if (c !== cursor) moveCursor(c, false);
    if (event.target.matches(':focus-visible')) setPreview(c);
});
columnsEl.addEventListener('focusout', (event) => {
    if (!columnsEl.contains(event.relatedTarget)) setPreview(-1);
});

function moveCursor(next, focus = true) {
    columns[cursor].tabIndex = -1;
    cursor = next;
    columns[cursor].tabIndex = 0;
    if (focus) {
        columns[cursor].focus({ preventScroll: true });
        setPreview(cursor);
    }
}

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing') {
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            event.preventDefault();
            moveCursor(Math.min(COLS - 1, Math.max(0, cursor + (key === 'ArrowLeft' ? -1 : 1))));
        } else if (key === 'Home' || key === 'End') {
            event.preventDefault();
            moveCursor(key === 'Home' ? 0 : COLS - 1);
        } else if (key === 'ArrowUp' || key === 'ArrowDown') {
            // 只有左右可以移動；上下把焦點帶回盤面
            event.preventDefault();
            moveCursor(cursor);
        } else if (/^[1-7]$/.test(key) && !event.repeat) {
            moveCursor(Number(key) - 1);
            play(cursor);
        } else if (key === 'u' && !event.repeat) {
            undo();
        } else if (key === 'n' && !event.repeat) {
            requestNewGame();
        }
        // Space / Enter 由行的按鈕本身的 click 處理
        return;
    }
    if (state === 'confirm' && key === 'Escape') {
        cancelConfirm();
        return;
    }
    const onButton = event.target instanceof HTMLButtonElement;
    if (key === 'Enter' && !onButton && !event.repeat) {
        if (state === 'over' && performance.now() - overAt < RESTART_GRACE_MS) return;
        if (state === 'ready' || state === 'over') {
            // newGame 會把焦點移到行上；不擋掉的話這次 Enter 會接著下在那一行
            event.preventDefault();
            newGame();
        }
    }
});

document.addEventListener('click', (event) => {
    const levelButton = event.target.closest('.level');
    if (levelButton) {
        const next = levelButton.dataset.opponent;
        if (next !== opponent || state !== 'playing') requestNewGame(next);
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
            newGame();
            break;
        case 'confirm':
            newGame(pendingOpponent ?? opponent);
            pendingOpponent = null;
            break;
        case 'cancel':
            cancelConfirm();
            break;
    }
});

$('undo-btn').addEventListener('click', undo);
$('new-btn').addEventListener('click', () => requestNewGame());
addEventListener('pagehide', save);

// ---------- 啟動：有進行中的局面就直接接著玩，否則顯示開始畫面與示意盤面 ----------

// 示意盤面：紅即將在對角線連成四子的中盤
const DEMO = { first: 'R', moves: [3, 3, 2, 4, 4, 2, 5, 5, 1, 4, 4, 6, 2] };

function showDemo() {
    clearTimers();
    game = createConnectFour({ state: DEMO });
    setState('ready');
    renderDiscs();
    renderHud();
    $('turn').textContent = '';
}

buildBoard();
const saved = loadSaved();
if (saved) {
    opponent = saved.opponent;
    assisted = saved.assisted;
    game = saved.game;
    setState('playing');
    renderDiscs();
    renderHud();
    announce(`${OPPONENT_NAMES[opponent]}, game in progress. ${turnPrompt()}`.trim());
    scheduleCpu();
} else {
    showDemo();
}
