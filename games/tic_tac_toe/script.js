// 井字棋：畫面與操作。遊戲規則與電腦對手在 core.js
import { LEVELS, chooseMove, createTicTacToe, other } from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 電腦「想一下」再下，看得出是它下的
const THINK_MS = [380, 650];
// 連線動畫播完再顯示結果
const RESULT_DELAY_MS = 900;

const SAVE_KEY = 'jsgames:tic-tac-toe:game';
const OPPONENT_KEY = 'jsgames:tic-tac-toe:opponent';
const FIRST_KEY = 'jsgames:tic-tac-toe:first';
const STATS_KEY = 'jsgames:tic-tac-toe:stats';

// 對手：電腦的三種難度，或兩人同一台裝置輪流下
const OPPONENTS = [...LEVELS, 'duo'];
const OPPONENT_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', duo: '2 players' };
// 對電腦時玩家固定是 X、電腦是 O，輪流先下
const HUMAN = 'X';
const CPU = 'O';

const CELL_NAMES = ['top left', 'top', 'top right', 'left', 'center', 'right', 'bottom left', 'bottom', 'bottom right'];
const LINE_NAMES = {
    '0,1,2': 'the top row',
    '3,4,5': 'the middle row',
    '6,7,8': 'the bottom row',
    '0,3,6': 'the left column',
    '1,4,7': 'the middle column',
    '2,5,8': 'the right column',
    '0,4,8': 'a diagonal',
    '2,4,6': 'a diagonal',
};
// 格子中心在連線 SVG（300 × 300）上的座標
const center = (i) => [(i % 3) * 100 + 50, Math.floor(i / 3) * 100 + 50];

const MARK_SVG = {
    X: '<svg class="mark mark--x" viewBox="0 0 100 100" aria-hidden="true"><path pathLength="1" d="M28 28l44 44" /><path pathLength="1" d="M72 28L28 72" /></svg>',
    O: '<svg class="mark mark--o" viewBox="0 0 100 100" aria-hidden="true"><circle pathLength="1" cx="50" cy="50" r="24" transform="rotate(-90 50 50)" /></svg>',
};
const GHOST_SVG = {
    X: '<svg class="ghost" aria-hidden="true"><use href="#m-x" /></svg>',
    O: '<svg class="ghost" aria-hidden="true"><use href="#m-o" /></svg>',
};

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.ttt');
const boardEl = $('board');
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
const bests = Object.fromEntries(LEVELS.map((level) => [level, highScore(`tic-tac-toe:${level}`)]));

// 兩人對戰的比數只記在這次開啟的期間
const duoTally = { X: 0, O: 0, draw: 0 };

// ---------- 狀態 ----------

let state = 'ready';
let opponent = OPPONENTS.includes(readStorage(OPPONENT_KEY)) ? readStorage(OPPONENT_KEY) : 'normal';
let nextFirst = readStorage(FIRST_KEY) === 'O' ? 'O' : 'X';
let pendingOpponent = null;
let game = null;
// 這局對電腦時收回過棋，結果就不記入戰績
let assisted = false;
let cells = [];
let cursor = 4;
let overAt = 0;
let thinkTimer = 0;
let resultTimer = 0;

const vsCpu = () => opponent !== 'duo';
const isCpuTurn = () => vsCpu() && game.status === 'playing' && game.turn === CPU;
const humanCanPlay = () => state === 'playing' && game.status === 'playing' && !isCpuTurn();

// 朗讀「輪到誰」；輪到電腦時不唸，等它下完再一起唸
function turnPrompt() {
    if (game.status !== 'playing' || isCpuTurn()) return '';
    return vsCpu() ? 'Your turn.' : `${game.turn} to move.`;
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
        const restored = createTicTacToe({ state: saved.game });
        if (restored.status !== 'playing' || restored.moves.length === 0) return null;
        return { opponent: saved.opponent, assisted: Boolean(saved.assisted), game: restored };
    } catch {
        return null;
    }
}

// ---------- 盤面 ----------

function buildBoard() {
    cells = Array.from({ length: 9 }, (_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell';
        button.dataset.i = i;
        button.tabIndex = i === cursor ? 0 : -1;
        return button;
    });
    boardEl.replaceChildren(...cells);
}

function renderCell(i, { animate = false } = {}) {
    const el = cells[i];
    const mark = game.board[i];
    if (mark) {
        if (el.dataset.mark !== mark) el.innerHTML = MARK_SVG[mark];
        el.dataset.mark = mark;
        el.classList.toggle('is-new', animate);
    } else {
        // 空格放一個目前輪到的記號當作滑過 / 聚焦時的預覽
        el.innerHTML = GHOST_SVG[game.turn];
        delete el.dataset.mark;
        el.classList.remove('is-new');
    }
    const winning = game.winner?.line.includes(i) ?? false;
    el.classList.toggle('is-win', winning);
    el.classList.toggle('is-last', game.moves.at(-1) === i);
    el.setAttribute('aria-disabled', String(Boolean(mark) || game.status !== 'playing'));
    const what = mark ? (vsCpu() ? `${mark}, ${mark === HUMAN ? 'yours' : "computer's"}` : mark) : 'empty';
    el.setAttribute('aria-label', `${capitalize(CELL_NAMES[i])}: ${what}${winning ? ', winning line' : ''}`);
}

const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

function renderBoard() {
    for (let i = 0; i < 9; i++) renderCell(i);
    renderStrike();
}

function renderStrike() {
    const line = $('strike-line');
    const win = game.winner;
    root.dataset.result = game.status === 'won' ? `win-${win.mark}` : game.status;
    if (!win) {
        line.removeAttribute('x1');
        return;
    }
    // 從第一格外側一點畫到最後一格外側一點
    const [x1, y1] = center(win.line[0]);
    const [x2, y2] = center(win.line[2]);
    const dx = (x2 - x1) / 200;
    const dy = (y2 - y1) / 200;
    const reach = 34;
    line.setAttribute('x1', x1 - dx * reach);
    line.setAttribute('y1', y1 - dy * reach);
    line.setAttribute('x2', x2 + dx * reach);
    line.setAttribute('y2', y2 + dy * reach);
    line.dataset.mark = win.mark;
}

// ---------- 分數列與提示文字 ----------

function renderHud() {
    root.dataset.mode = vsCpu() ? 'cpu' : 'duo';
    root.dataset.turn = game.status === 'playing' ? game.turn : '';
    // 玩家現在可以下棋（給滑過預覽與游標樣式用）
    root.dataset.input = humanCanPlay() ? 'on' : 'off';
    $('name-x').textContent = vsCpu() ? 'You' : 'Player X';
    $('name-o').textContent = vsCpu() ? 'Computer' : 'Player O';
    if (vsCpu()) {
        const stats = statsOf(opponent);
        $('wins-x').textContent = stats.win;
        $('wins-o').textContent = stats.loss;
        $('draws').textContent = stats.draw;
    } else {
        $('wins-x').textContent = duoTally.X;
        $('wins-o').textContent = duoTally.O;
        $('draws').textContent = duoTally.draw;
    }
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.opponent === opponent));
    }
    const humanMoves = vsCpu() ? game.moves.filter((i) => game.board[i] === HUMAN).length : game.moves.length;
    $('undo-btn').disabled = !(state === 'playing' && game.status === 'playing' && humanMoves > 0);
    renderInfo();
}

function renderInfo() {
    const turn = $('turn');
    if (game.status !== 'playing') turn.textContent = '';
    else if (vsCpu()) turn.textContent = game.turn === HUMAN ? 'Your turn' : 'Computer is thinking…';
    else turn.textContent = `${game.turn} to move`;
    turn.dataset.mark = game.status === 'playing' ? game.turn : '';

    const note = $('note');
    if (vsCpu()) {
        const best = bests[opponent].get() ?? 0;
        note.textContent = assisted
            ? 'Undo used · this game won’t count'
            : `Unbeaten streak ${statsOf(opponent).streak} · Best ${best}`;
    } else {
        note.textContent = `${game.first} started this game · starts alternate`;
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
    if (vsCpu()) return game.turn === HUMAN ? 'You go first.' : 'Computer goes first.';
    return `${game.turn} goes first.`;
}

function newGame(nextOpponent = opponent) {
    clearTimers();
    opponent = nextOpponent;
    writeStorage(OPPONENT_KEY, opponent);
    game = createTicTacToe({ first: nextFirst });
    // 下一局換另一方先下
    nextFirst = other(nextFirst);
    writeStorage(FIRST_KEY, nextFirst);
    assisted = false;
    setState('playing');
    renderBoard();
    renderHud();
    save();
    cells[cursor].focus({ preventScroll: true });
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
    cells[cursor].focus({ preventScroll: true });
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
        const index = chooseMove(game.board, CPU, opponent);
        place(index, `Computer plays ${CPU} ${where(index)}.`);
    }, delay);
}

const where = (i) => (i === 4 ? 'in the center' : `at ${CELL_NAMES[i]}`);

// 下一步並更新畫面；prefix 是要朗讀的這一步
function place(index, prefix) {
    const result = game.play(index);
    if (!result) return;
    navigator.vibrate?.(8);
    for (let i = 0; i < 9; i++) renderCell(i, { animate: i === index });
    renderStrike();
    renderHud();
    save();

    if (result.won || result.draw) {
        finish(prefix);
        return;
    }
    announce(`${prefix} ${turnPrompt()}`.trim());
    scheduleCpu();
}

function play(i) {
    if (!humanCanPlay()) return;
    if (game.board[i] !== null) {
        // 已經有棋子：輕輕搖一下表示不能下
        cells[i].classList.remove('is-taken');
        void cells[i].offsetWidth;
        cells[i].classList.add('is-taken');
        announce(`${capitalize(CELL_NAMES[i])} is taken.`);
        return;
    }
    const mark = game.turn;
    place(i, vsCpu() ? `You play ${mark} ${where(i)}.` : `${mark} ${where(i)}.`);
}

function undo() {
    if (state !== 'playing' || game.status !== 'playing') return;
    clearTimeout(thinkTimer);
    let removed = 0;
    if (vsCpu()) {
        // 收回到上一次輪到玩家的時候：電腦的回應與玩家的那一步
        const humanMoves = game.moves.filter((i) => game.board[i] === HUMAN).length;
        if (humanMoves === 0) return scheduleCpu();
        do {
            game.undo();
            removed += 1;
        } while (game.turn !== HUMAN);
        assisted = true;
    } else if (game.undo()) {
        removed = 1;
    }
    if (!removed) return;
    renderBoard();
    renderHud();
    save();
    announce(`Took back ${removed === 1 ? 'one move' : `${removed} moves`}. ${turnPrompt()}`);
}

function finish(prefix) {
    clearTimeout(thinkTimer);
    const win = game.winner;
    let title;
    let spoken;
    if (win) {
        const line = LINE_NAMES[win.line.join(',')];
        if (vsCpu()) {
            title = win.mark === HUMAN ? 'You win' : 'Computer wins';
            spoken = `${title} with ${line}.`;
        } else {
            title = `${win.mark} wins`;
            spoken = `${title} with ${line}.`;
        }
    } else {
        title = 'Draw';
        spoken = 'Draw.';
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
            if (record) note = `New best · ${stats.streak} games unbeaten`;
            else if (outcome === 'loss') note = best > 0 ? `Streak reset · Best ${best}` : 'Streak reset';
            else note = `Unbeaten streak ${stats.streak} · Best ${best}`;
        }
    } else {
        duoTally[win ? win.mark : 'draw'] += 1;
        detail = `X ${duoTally.X} · Draws ${duoTally.draw} · O ${duoTally.O}`;
        note = `${nextFirst} goes first next`;
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
        overlays.over.querySelector('.btn').focus({ preventScroll: true });
    }, RESULT_DELAY_MS);
}

// ---------- 操作 ----------

boardEl.addEventListener('click', (event) => {
    const el = event.target.closest('.cell');
    if (!el) return;
    const i = Number(el.dataset.i);
    moveCursor(i, false);
    play(i);
});

function moveCursor(next, focus = true) {
    cells[cursor].tabIndex = -1;
    cursor = next;
    cells[cursor].tabIndex = 0;
    if (focus) cells[cursor].focus({ preventScroll: true });
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing') {
        const arrow = ARROWS[key];
        if (arrow) {
            event.preventDefault();
            const r = Math.min(2, Math.max(0, Math.floor(cursor / 3) + arrow[0]));
            const c = Math.min(2, Math.max(0, (cursor % 3) + arrow[1]));
            moveCursor(r * 3 + c);
        } else if (/^[1-9]$/.test(key) && !event.repeat) {
            moveCursor(Number(key) - 1);
            play(cursor);
        } else if (key === 'u' && !event.repeat) {
            undo();
        } else if (key === 'n' && !event.repeat) {
            requestNewGame();
        }
        // Space / Enter 由格子按鈕本身的 click 處理
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
            // newGame 會把焦點移到格子上；不擋掉的話這次 Enter 會接著下在那一格
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

// 示意盤面：X 即將以對角線取勝的局面
const DEMO = { first: 'X', moves: [4, 1, 0, 8, 6, 3] };

function showDemo() {
    clearTimers();
    game = createTicTacToe({ state: DEMO });
    setState('ready');
    renderBoard();
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
    renderBoard();
    renderHud();
    announce(`${OPPONENT_NAMES[opponent]}, game in progress. ${turnPrompt()}`.trim());
    scheduleCpu();
} else {
    showDemo();
}
