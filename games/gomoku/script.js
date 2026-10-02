// 五子棋：畫面與操作。遊戲規則與電腦對手在 core.js
import { LEVELS, N, SIZE, CENTER, cellName, chooseMove, createGomoku, fivePoints, other } from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 電腦「想一下」再下，看得出是它下的（實際計算時間另外算，hard 最多十幾毫秒）
const THINK_MS = [300, 550];
// 連線畫出來之後再顯示結果
const RESULT_DELAY_MS = 1200;

const SAVE_KEY = 'jsgames:gomoku:game';
const OPPONENT_KEY = 'jsgames:gomoku:opponent';
const SIDE_KEY = 'jsgames:gomoku:side';
const STATS_KEY = 'jsgames:gomoku:stats';

// 對手：電腦的三種難度，或兩人同一台裝置輪流下
const OPPONENTS = [...LEVELS, 'duo'];
const OPPONENT_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', duo: '2 players' };
const NAME = { B: 'Black', W: 'White' };
const COLOR = { B: 'black', W: 'white' };
// 星位（天元與四個角的星）
const STARS = [
    [3, 3],
    [3, 11],
    [7, 7],
    [11, 3],
    [11, 11],
];

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.gomoku');
const cellsEl = $('cells');
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
const bests = Object.fromEntries(LEVELS.map((level) => [level, highScore(`gomoku:${level}`)]));

// 兩人對戰的比數只記在這次開啟的期間
const duoTally = { B: 0, W: 0, draw: 0 };

// ---------- 狀態 ----------

let state = 'ready';
let opponent = OPPONENTS.includes(readStorage(OPPONENT_KEY)) ? readStorage(OPPONENT_KEY) : 'normal';
// 對電腦時玩家這一局執哪一色：黑永遠先下，每局黑白輪流
let human = 'B';
let nextHuman = readStorage(SIDE_KEY) === 'W' ? 'W' : 'B';
let pendingOpponent = null;
let game = null;
// 這局對電腦時收回過棋，結果就不記入戰績
let assisted = false;
let cells = [];
// 鍵盤游標所在的格子
let cursor = CENTER;
// 預覽的格子與來源：mouse（滑過）、key（鍵盤聚焦）、touch（點了一下等確認）
let preview = -1;
let previewBy = '';
// 最近一次按下的指標種類：觸控要點兩下才下
let lastPointer = 'mouse';
let overAt = 0;
let thinkTimer = 0;
let resultTimer = 0;

const vsCpu = () => opponent !== 'duo';
const cpu = () => other(human);
const isCpuTurn = () => vsCpu() && game.status === 'playing' && game.turn === cpu();
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
    else writeStorage(SAVE_KEY, JSON.stringify({ opponent, human, assisted, game: game.toJSON() }));
}

function loadSaved() {
    const saved = readJSON(SAVE_KEY);
    if (!OPPONENTS.includes(saved?.opponent) || !saved.game) return null;
    try {
        const restored = createGomoku({ state: saved.game });
        if (restored.status !== 'playing' || restored.moves.length === 0) return null;
        return {
            opponent: saved.opponent,
            human: saved.human === 'W' ? 'W' : 'B',
            assisted: Boolean(saved.assisted),
            game: restored,
        };
    } catch {
        return null;
    }
}

// ---------- 盤面 ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
}

// 棋盤線與星位畫在 SVG 裡（邏輯座標 15 × 15，交叉點在每格中心），任何大小都清晰
function buildGrid() {
    const grid = $('grid');
    const lines = svg('g', { class: 'grid__lines' });
    for (let k = 0; k < N; k++) {
        const at = k + 0.5;
        lines.append(svg('line', { x1: 0.5, x2: N - 0.5, y1: at, y2: at }));
        lines.append(svg('line', { x1: at, x2: at, y1: 0.5, y2: N - 0.5 }));
    }
    const stars = svg('g', { class: 'grid__stars' });
    for (const [r, c] of STARS) stars.append(svg('circle', { cx: c + 0.5, cy: r + 0.5, r: 0.11 }));
    grid.replaceChildren(svg('rect', { class: 'grid__edge', x: 0.5, y: 0.5, width: N - 1, height: N - 1 }), lines, stars);

    // 盤邊的座標：上方 A–O、左邊 15–1（只在盤面夠大時顯示）
    $('coords-cols').replaceChildren(
        ...[...'ABCDEFGHIJKLMNO'].map((letter) => Object.assign(document.createElement('span'), { textContent: letter }))
    );
    $('coords-rows').replaceChildren(
        ...Array.from({ length: N }, (_, r) => Object.assign(document.createElement('span'), { textContent: N - r }))
    );
}

function buildBoard() {
    cells = Array.from({ length: SIZE }, (_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell';
        button.dataset.i = i;
        button.tabIndex = i === cursor ? 0 : -1;
        return button;
    });
    cellsEl.replaceChildren(...cells);
}

function cellLabel(i, last) {
    const mark = game.board[i];
    const parts = [cellName(i), mark ? `${COLOR[mark]} stone` : 'empty'];
    if (i === last) parts.push('last move');
    return parts.join(', ');
}

// 依 game.board 重畫所有棋子；animate 是剛下的那一格
function renderBoard(animate = -1) {
    const last = game.lastIndex();
    const winning = new Set(game.winner?.cells ?? []);
    cells.forEach((el, i) => {
        const mark = game.board[i];
        if ((el.dataset.mark ?? null) !== mark) {
            if (mark) el.dataset.mark = mark;
            else delete el.dataset.mark;
        }
        el.classList.toggle('is-new', i === animate);
        el.classList.toggle('is-last', i === last && game.status === 'playing');
        el.classList.toggle('is-win', winning.has(i));
        el.setAttribute('aria-label', cellLabel(i, last));
        el.setAttribute('aria-disabled', String(Boolean(mark) || game.status !== 'playing'));
    });
    root.dataset.result = game.status === 'won' ? 'win' : game.status;
    renderWinLines();
    renderPreview();
}

// 連成五子：在連線上畫一條發光的線
function renderWinLines() {
    const group = $('win-lines');
    const lines = game.winner?.lines ?? [];
    group.replaceChildren(
        ...lines.map(([a, b]) =>
            svg('line', {
                class: 'win-line',
                x1: (a % N) + 0.5,
                y1: Math.floor(a / N) + 0.5,
                x2: (b % N) + 0.5,
                y2: Math.floor(b / N) + 0.5,
                pathLength: 1,
            })
        )
    );
}

// 合法步的提示：預覽的空格顯示輪到的那一方的棋子；鍵盤與觸控另外畫出十字線，看得出是哪一個交叉點
function renderPreview() {
    const active = preview >= 0 && humanCanPlay() && !game.board[preview] ? preview : -1;
    cells.forEach((el, i) => {
        el.classList.toggle('is-preview', i === active);
        el.classList.toggle('is-pending', i === active && previewBy === 'touch');
    });
    const cross = $('crosshair');
    const showCross = active >= 0 && previewBy !== 'mouse';
    cross.classList.toggle('is-on', showCross);
    if (showCross) {
        const y = Math.floor(active / N) + 0.5;
        const x = (active % N) + 0.5;
        $('cross-h').setAttribute('y1', y);
        $('cross-h').setAttribute('y2', y);
        $('cross-v').setAttribute('x1', x);
        $('cross-v').setAttribute('x2', x);
    }
    renderInfo();
}

function setPreview(i, by) {
    preview = i;
    previewBy = i >= 0 ? by : '';
    renderPreview();
}

// ---------- 分數列與提示文字 ----------

function renderHud() {
    root.dataset.mode = vsCpu() ? 'cpu' : 'duo';
    root.dataset.turn = game.status === 'playing' ? game.turn : '';
    // 玩家現在可以下棋（給預覽與游標樣式用）
    root.dataset.input = humanCanPlay() ? 'on' : 'off';
    const sideA = vsCpu() ? human : 'B';
    $('side-a').dataset.mark = sideA;
    $('side-b').dataset.mark = other(sideA);
    $('name-a').textContent = vsCpu() ? 'You' : 'Black';
    $('name-b').textContent = vsCpu() ? 'Computer' : 'White';
    if (vsCpu()) {
        const stats = statsOf(opponent);
        $('wins-a').textContent = stats.win;
        $('wins-b').textContent = stats.loss;
        $('draws').textContent = stats.draw;
    } else {
        $('wins-a').textContent = duoTally.B;
        $('wins-b').textContent = duoTally.W;
        $('draws').textContent = duoTally.draw;
    }
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.opponent === opponent));
    }
    const humanMoves = vsCpu() ? countHumanMoves() : game.moves.length;
    $('undo-btn').disabled = !(state === 'playing' && game.status === 'playing' && humanMoves > 0);
    renderPreview();
}

// 對電腦時玩家下過幾步：黑下第 0、2、4… 步
const countHumanMoves = () => game.moves.filter((_, k) => (k % 2 === 0 ? 'B' : 'W') === human).length;

function renderInfo() {
    const turn = $('turn');
    if (state !== 'playing' || game.status !== 'playing') turn.textContent = '';
    else if (preview >= 0 && previewBy === 'touch' && humanCanPlay())
        turn.textContent = `Tap ${cellName(preview)} again to place`;
    else if (vsCpu()) turn.textContent = game.turn === human ? 'Your turn' : 'Computer is thinking…';
    else turn.textContent = `${NAME[game.turn]} to move`;
    turn.dataset.mark = game.status === 'playing' ? game.turn : '';
    turn.classList.toggle('is-cpu', isCpuTurn());

    const note = $('note');
    if (vsCpu()) {
        const best = bests[opponent].get() ?? 0;
        const color = `You play ${COLOR[human]}`;
        note.textContent = assisted
            ? `${color} · Undo used, this game won’t count`
            : `${color} · Unbeaten streak ${statsOf(opponent).streak} · Best ${best}`;
    } else {
        note.textContent = 'Black moves first · swap seats each game';
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

function startAnnouncement() {
    if (!vsCpu()) return 'Black goes first.';
    return human === 'B' ? 'You play black and go first.' : 'You play white. Computer goes first.';
}

function newGame(nextOpponent = opponent) {
    clearTimers();
    opponent = nextOpponent;
    writeStorage(OPPONENT_KEY, opponent);
    game = createGomoku();
    if (vsCpu()) {
        // 對電腦時黑白輪流執
        human = nextHuman;
        nextHuman = other(human);
        writeStorage(SIDE_KEY, nextHuman);
    }
    assisted = false;
    preview = -1;
    setState('playing');
    renderBoard();
    renderHud();
    save();
    focusCursor();
    announce(`${OPPONENT_NAMES[opponent]}. ${startAnnouncement()}`);
    scheduleCpu();
}

// 已經下過棋的局，換對手或開新局要先確認
function requestNewGame(nextOpponent = opponent) {
    if (state === 'ready') {
        // 開始畫面：只換對手，按開始才進入
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
    focusCursor();
    scheduleCpu();
}

function scheduleCpu() {
    clearTimeout(thinkTimer);
    if (state !== 'playing' || !isCpuTurn()) return;
    const [min, max] = THINK_MS;
    // 開局第一步不需要想太久
    const delay = game.moves.length === 0 ? min : min + Math.random() * (max - min);
    thinkTimer = setTimeout(() => {
        if (state !== 'playing' || !isCpuTurn()) return;
        const index = chooseMove(game.board, cpu(), opponent);
        place(index, `Computer plays ${cellName(index)}.`);
    }, delay);
}

// 下了這一步之後若再一子就能連五，提醒一聲（朗讀用）
function threatNote(mark) {
    const points = fivePoints(game.board, mark);
    if (points.length === 0) return '';
    const who = vsCpu() ? (mark === human ? 'You threaten' : 'Computer threatens') : `${NAME[mark]} threatens`;
    return `${who} five at ${points.map(cellName).join(' and ')}.`;
}

// 下一步並更新畫面；prefix 是要朗讀的這一步
function place(index, prefix) {
    const result = game.play(index);
    if (!result) return;
    navigator.vibrate?.(8);
    preview = -1;
    renderBoard(result.index);
    renderHud();
    save();

    if (result.won || result.draw) {
        finish(prefix);
        return;
    }
    announce([prefix, threatNote(result.mark), turnPrompt()].filter(Boolean).join(' '));
    scheduleCpu();
}

function reject(i) {
    // 已經有棋子：輕輕搖一下表示不能下
    const el = cells[i];
    el.classList.remove('is-rejected');
    void el.offsetWidth;
    el.classList.add('is-rejected');
    announce(`${cellName(i)} is taken.`);
}

function play(i) {
    if (!humanCanPlay()) return;
    if (game.board[i]) {
        reject(i);
        return;
    }
    const mark = game.turn;
    place(i, vsCpu() ? `You play ${cellName(i)}.` : `${NAME[mark]} plays ${cellName(i)}.`);
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
        } while (game.turn !== human);
        assisted = true;
    } else if (game.undo()) {
        removed = 1;
    }
    if (!removed) return;
    preview = -1;
    renderBoard();
    renderHud();
    save();
    announce(`Took back ${removed === 1 ? 'one move' : `${removed} moves`}. ${turnPrompt()}`);
}

// 連線的方向（給朗讀用）
function lineName([a, b]) {
    const step = b - a;
    if (Math.floor(a / N) === Math.floor(b / N)) return 'across';
    if (step % N === 0) return 'vertically';
    return 'diagonally';
}

function finish(prefix) {
    clearTimeout(thinkTimer);
    const win = game.winner;
    let title;
    let spoken;
    if (win) {
        title = vsCpu() ? (win.mark === human ? 'You win' : 'Computer wins') : `${NAME[win.mark]} wins`;
        spoken = `${title} with five ${lineName(win.lines[0])}.`;
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
            const outcome = !win ? 'draw' : win.mark === human ? 'win' : 'loss';
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
        detail = `Black ${duoTally.B} · Draws ${duoTally.draw} · White ${duoTally.W}`;
        note = `${game.moves.length} moves`;
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
        root.dataset.outcome = !win ? 'draw' : vsCpu() ? (win.mark === human ? 'win' : 'loss') : 'win';
        // 卡片放在連線上方或下方空比較多列的一側，讓連線保持看得到
        const rows = win ? win.cells.map((i) => Math.floor(i / N)) : [0];
        root.dataset.card = N - 1 - Math.max(...rows) >= Math.min(...rows) ? 'bottom' : 'top';
        overlays.over.querySelector('.btn').focus({ preventScroll: true });
    }, RESULT_DELAY_MS);
}

// ---------- 操作 ----------

// 觸控的格子很小（手機上約 23px，比手指還小）：第一下只瞄準並畫出十字線，再點同一點才下，點錯了改點別的地方就好
// 滑鼠與鍵盤看得到預覽，點一下就下
cellsEl.addEventListener('pointerdown', (event) => {
    lastPointer = event.pointerType || 'mouse';
});

cellsEl.addEventListener('click', (event) => {
    const el = event.target.closest('.cell');
    if (!el) return;
    const i = Number(el.dataset.i);
    moveCursor(i, false);
    const touch = event.detail !== 0 && lastPointer !== 'mouse';
    if (touch && humanCanPlay() && !game.board[i] && !(preview === i && previewBy === 'touch')) {
        setPreview(i, 'touch');
        announce(`${cellName(i)} selected. Tap again to place.`);
        return;
    }
    play(i);
});

// 滑鼠滑過時預覽
cellsEl.addEventListener('pointerover', (event) => {
    const el = event.target.closest('.cell');
    if (el && event.pointerType === 'mouse' && previewBy !== 'touch') setPreview(Number(el.dataset.i), 'mouse');
});
cellsEl.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && previewBy === 'mouse') setPreview(-1);
});
// 鍵盤聚焦時預覽游標所在的格子
cellsEl.addEventListener('focusin', (event) => {
    const i = Number(event.target.dataset.i);
    if (i !== cursor) moveCursor(i, false);
    if (event.target.matches(':focus-visible')) setPreview(i, 'key');
});
cellsEl.addEventListener('focusout', (event) => {
    if (!cellsEl.contains(event.relatedTarget) && previewBy === 'key') setPreview(-1);
});

function moveCursor(next, focus = true) {
    cells[cursor].tabIndex = -1;
    cursor = next;
    cells[cursor].tabIndex = 0;
    if (focus) {
        cells[cursor].focus({ preventScroll: true });
        setPreview(cursor, 'key');
    }
}

function focusCursor() {
    cells[cursor].focus({ preventScroll: true });
}

const ARROWS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing') {
        if (ARROWS[key]) {
            event.preventDefault();
            const [dr, dc] = ARROWS[key];
            const r = Math.min(N - 1, Math.max(0, Math.floor(cursor / N) + dr));
            const c = Math.min(N - 1, Math.max(0, (cursor % N) + dc));
            moveCursor(r * N + c);
        } else if (key === 'Home' || key === 'End') {
            event.preventDefault();
            const row = Math.floor(cursor / N);
            moveCursor(row * N + (key === 'Home' ? 0 : N - 1));
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

// 示意盤面：黑在斜線連成五子的一局
const DEMO = {
    moves: [112, 98, 97, 142, 82, 67, 83, 84, 69, 55, 111, 125, 110, 109, 113, 114, 96, 124, 54, 68, 81, 126, 65, 129, 49],
};

function showDemo() {
    clearTimers();
    game = createGomoku({ state: DEMO });
    human = nextHuman;
    setState('ready');
    renderBoard();
    renderHud();
}

buildGrid();
buildBoard();
const saved = loadSaved();
if (saved) {
    opponent = saved.opponent;
    human = saved.human;
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
