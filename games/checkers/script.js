// 西洋跳棋：畫面與操作。遊戲規則與電腦對手在 core.js
// 走一步分兩段：先選子（亮出可以走到的格子），再選落點；連跳時一跳一跳點（也可以直接點終點），或用拖曳
import {
    DARK,
    LEVELS,
    N,
    SIZE,
    cellName,
    chooseMove,
    createCheckers,
    isDark,
    isKing,
    narrowMoves,
    other,
    sideOf,
} from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 電腦「想一下」再走，也讓玩家看完上一步（實際計算時間另外算，hard 最多二十幾毫秒）
const THINK_MS = [450, 750];
// 棋子每跳一格的動畫時間
const HOP_MS = 190;
// 最後一步走完之後再顯示結果
const RESULT_DELAY_MS = 900;
// 按住棋子移動超過這個距離才算拖曳（否則是點一下）
const DRAG_PX = 6;

const SAVE_KEY = 'jsgames:checkers:game';
const OPPONENT_KEY = 'jsgames:checkers:opponent';
const SIDE_KEY = 'jsgames:checkers:side';
const STATS_KEY = 'jsgames:checkers:stats';

// 對手：電腦的三種難度，或兩人同一台裝置輪流下
const OPPONENTS = [...LEVELS, 'duo'];
const OPPONENT_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', duo: '2 players' };
const NAME = { r: 'Red', b: 'Black' };
const COLOR = { r: 'red', b: 'black' };
const REASONS = {
    repetition: 'Same position three times',
    quiet: '40 moves without a capture',
};

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.checkers');
const cellsEl = $('cells');
const statusText = $('status');
const overlays = { ready: $('overlay-ready'), over: $('overlay-over'), confirm: $('overlay-confirm') };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

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
const bests = Object.fromEntries(LEVELS.map((level) => [level, highScore(`checkers:${level}`)]));

// 兩人對戰的比數只記在這次開啟的期間
const duoTally = { r: 0, b: 0, draw: 0 };

// ---------- 狀態 ----------

let state = 'ready';
let opponent = OPPONENTS.includes(readStorage(OPPONENT_KEY)) ? readStorage(OPPONENT_KEY) : 'normal';
// 對電腦時玩家這一局執哪一色：紅永遠先走，每局紅黑輪流；玩家的棋子永遠在下方
let human = 'r';
let nextHuman = readStorage(SIDE_KEY) === 'b' ? 'b' : 'r';
let pendingOpponent = null;
let game = null;
// 這局對電腦時收回過棋，結果就不記入戰績
let assisted = false;
// 選取狀態：null 或 { from, hops }（hops 是連跳時已經點過的落點，還沒真正走出去）
let selection = null;
// 盤面朝向：下方是哪一方
let bottom = 'r';
// 每一格的元素（深色格是按鈕、淺色格是 div），依盤面 index
let squares = [];
// 鍵盤游標所在的格子（一定是深色格）；上下移動時左右交替，維持在同一直行附近
let cursor = DARK[DARK.length - 4];
let zigzag = 1;
// 吃掉的子在動畫期間還要畫出來：index → 棋子
const vanishing = new Map();
let overAt = 0;
let thinkTimer = 0;
let resultTimer = 0;
let vanishTimer = 0;

const vsCpu = () => opponent !== 'duo';
const cpu = () => other(human);
const isCpuTurn = () => vsCpu() && game.status === 'playing' && game.turn === cpu();
const humanCanPlay = () => state === 'playing' && game.status === 'playing' && !isCpuTurn();
const who = (side) => (vsCpu() ? (side === human ? 'You' : 'Computer') : NAME[side]);
const total = (count) => count.men + count.kings;
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

// ---------- 存檔與讀檔 ----------

// 只存進行中的局面；結束就清掉，下次開啟從開始畫面開始
function save() {
    if (state === 'ready' || !game) return;
    if (game.status !== 'playing' || game.history.length === 0) writeStorage(SAVE_KEY, null);
    else writeStorage(SAVE_KEY, JSON.stringify({ opponent, human, assisted, game: game.toJSON() }));
}

function loadSaved() {
    const saved = readJSON(SAVE_KEY);
    if (!OPPONENTS.includes(saved?.opponent) || !saved.game) return null;
    try {
        const restored = createCheckers({ state: saved.game });
        if (restored.status !== 'playing' || restored.history.length === 0) return null;
        return {
            opponent: saved.opponent,
            human: saved.human === 'b' ? 'b' : 'r',
            assisted: Boolean(saved.assisted),
            game: restored,
        };
    } catch {
        return null;
    }
}

// ---------- 盤面 ----------

// 盤面 index ↔ 畫面上的位置（執黑時整個盤面轉 180 度）
const toView = (i) => (bottom === 'r' ? i : SIZE - 1 - i);
const fromView = (row, col) => toView(row * N + col);

function buildBoard() {
    squares = Array.from({ length: SIZE }, (_, i) => {
        if (!isDark(i)) {
            const el = document.createElement('div');
            el.className = 'cell';
            el.setAttribute('aria-hidden', 'true');
            return el;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell';
        button.dataset.i = i;
        button.tabIndex = i === cursor ? 0 : -1;
        const piece = document.createElement('span');
        piece.className = 'piece';
        piece.innerHTML = '<svg aria-hidden="true"><use href="#i-crown" /></svg>';
        button.append(piece);
        return button;
    });
    layoutBoard();
}

// 依朝向排列格子與盤邊座標：下方 a–h、左邊 1–8
function layoutBoard() {
    bottom = vsCpu() && state !== 'ready' ? human : 'r';
    const order = Array.from({ length: SIZE }, (_, k) => squares[toView(k)]);
    cellsEl.replaceChildren(...order);
    const label = (text) => Object.assign(document.createElement('span'), { textContent: text });
    const files = [...'abcdefgh'];
    const ranks = Array.from({ length: N }, (_, r) => String(N - r));
    if (bottom === 'b') {
        files.reverse();
        ranks.reverse();
    }
    $('coords-cols').replaceChildren(...files.map(label));
    $('coords-rows').replaceChildren(...ranks.map(label));
}

// 選取的子現在畫在哪一格（連跳途中是最後一個落點）
const selectedAt = () => (selection ? (selection.hops.at(-1) ?? selection.from) : -1);
const narrowed = () => (selection ? narrowMoves(game.moves, selection.from, selection.hops) : null);
// 開始畫面的示意盤面也顯示提示
const hintsOn = () => game.status === 'playing' && (state === 'ready' || humanCanPlay());

function pieceName(piece) {
    return `${COLOR[sideOf(piece)]} ${isKing(piece) ? 'king' : 'piece'}`;
}

// 依 game.board 與選取狀態重畫所有格子
function render() {
    const info = narrowed();
    const at = selectedAt();
    const hops = selection?.hops.length ?? 0;
    // 連跳途中已經跳過的子（整步走完才拿掉）
    const taken = new Set(info && hops ? info.moves[0].captures.slice(0, hops) : []);
    const next = new Set(info?.next ?? []);
    // 連跳的終點（不是下一跳就到的）：可以直接點
    const ends = new Set(
        info ? info.moves.filter((m) => m.path.length > hops + 2).map((m) => m.to).filter((i) => !next.has(i)) : []
    );
    // 下一跳會吃掉的子
    const targets = new Set(info ? info.moves.map((m) => m.captures[hops]).filter((i) => i !== undefined) : []);
    const hints = hintsOn();
    const movable = new Set(hints && !selection ? game.movable() : []);
    const forced = hints && game.mustCapture();
    const last = game.last();
    const trail = new Set(last && !selection ? last.path : []);

    for (const i of DARK) {
        const el = squares[i];
        let piece = game.board[i];
        if (selection && hops) {
            if (i === selection.from) piece = null;
            if (i === at) piece = game.board[selection.from];
        }
        if (!piece && vanishing.has(i)) piece = vanishing.get(i);
        if ((el.dataset.piece ?? null) !== piece) {
            if (piece) el.dataset.piece = piece;
            else delete el.dataset.piece;
        }
        el.classList.toggle('is-vanishing', vanishing.has(i) && !game.board[i]);
        el.classList.toggle('is-selected', i === at);
        el.classList.toggle('is-movable', movable.has(i) && !forced);
        el.classList.toggle('is-forced', movable.has(i) && forced);
        el.classList.toggle('is-next', next.has(i));
        el.classList.toggle('is-end', ends.has(i));
        el.classList.toggle('is-target', targets.has(i));
        el.classList.toggle('is-taken', taken.has(i));
        el.classList.toggle('is-trail', trail.has(i));

        const parts = [cellName(i)];
        parts.push(piece ? pieceName(piece) : 'empty');
        if (i === at) parts.push('selected');
        else if (movable.has(i)) parts.push(forced ? 'must capture' : 'can move');
        if (next.has(i)) {
            const capture = info.moves.find((m) => m.path[hops + 1] === i)?.captures[hops];
            parts.push(capture === undefined ? 'move here' : `jump here, captures ${cellName(capture)}`);
        } else if (ends.has(i)) parts.push('end of jump');
        if (taken.has(i)) parts.push('captured');
        if (last && !selection && i === last.to) parts.push('last move');
        el.setAttribute('aria-label', parts.join(', '));
    }
    root.dataset.result = game.status === 'over' ? (game.winner ?? 'draw') : '';
    root.dataset.turn = game.status === 'playing' ? game.turn : '';
    root.dataset.input = humanCanPlay() ? 'on' : 'off';
    renderInfo();
}

// 棋子沿著路線滑過去（path 的第 from 個點到終點）；回傳動畫時間
function animatePath(path, from = 0) {
    const points = path.slice(from);
    const to = path.at(-1);
    if (points.length < 2 || reducedMotion.matches) return 0;
    const target = squares[to];
    const offset = (i) =>
        `translate(${squares[i].offsetLeft - target.offsetLeft}px, ${squares[i].offsetTop - target.offsetTop}px)`;
    const duration = HOP_MS * (points.length - 1);
    target.classList.add('is-moving');
    const animation = target.firstChild.animate(
        points.map((i) => ({ transform: offset(i) })),
        { duration, easing: points.length > 2 ? 'linear' : 'cubic-bezier(0.3, 0.7, 0.4, 1)' }
    );
    animation.finished.then(
        () => target.classList.remove('is-moving'),
        () => target.classList.remove('is-moving')
    );
    return duration;
}

// 被吃的子在棋子跳過之後淡出
function vanish(move, from = 0) {
    clearTimeout(vanishTimer);
    vanishing.clear();
    move.captures.forEach((i, k) => {
        vanishing.set(i, move.captured[k]);
        const delay = reducedMotion.matches ? 0 : Math.max(0, k - from + 0.5) * HOP_MS;
        squares[i].style.setProperty('--vanish-delay', `${delay}ms`);
    });
    vanishTimer = setTimeout(
        () => {
            vanishing.clear();
            render();
        },
        HOP_MS * (move.captures.length + 1) + 300
    );
}

// ---------- 分數列與提示文字 ----------

function renderHud() {
    root.dataset.mode = vsCpu() ? 'cpu' : 'duo';
    const sideA = vsCpu() ? human : 'r';
    const sideB = other(sideA);
    const count = game.count();
    $('side-a').dataset.side = sideA;
    $('side-b').dataset.side = sideB;
    $('name-a').textContent = vsCpu() ? 'You' : 'Red';
    $('name-b').textContent = vsCpu() ? 'Computer' : 'Black';
    for (const [key, side] of [
        ['a', sideA],
        ['b', sideB],
    ]) {
        $(`count-${key}`).textContent = total(count[side]);
        const kings = $(`kings-${key}`);
        kings.replaceChildren();
        if (count[side].kings) {
            kings.innerHTML = '<svg aria-hidden="true"><use href="#i-crown" /></svg>';
            kings.append(String(count[side].kings));
        }
        kings.setAttribute('aria-label', count[side].kings ? `${count[side].kings} kings` : '');
    }
    const wins = vsCpu()
        ? (({ win, loss, draw }) => [win, loss, draw])(statsOf(opponent))
        : [duoTally.r, duoTally.b, duoTally.draw];
    const winsText = (n) => `${n} ${n === 1 ? 'win' : 'wins'}`;
    $('wins-a').textContent = `· ${winsText(wins[0])}`;
    $('wins-b').textContent = `· ${winsText(wins[1])}`;
    $('draws').textContent = wins[2];
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.opponent === opponent));
    }
    const humanMoves = vsCpu() ? game.history.filter((m) => m.side === human).length : game.history.length;
    $('undo-btn').disabled = !(state === 'playing' && game.status === 'playing' && humanMoves > 0);
    renderInfo();
}

function renderInfo() {
    const turn = $('turn');
    let text = '';
    let forced = false;
    if (state === 'playing' && game.status === 'playing') {
        const info = narrowed();
        if (isCpuTurn()) text = 'Computer is thinking…';
        else if (info && selection.hops.length) text = 'Keep jumping';
        else if (info) {
            const n = info.moves.length;
            const verb = info.moves[0].captures.length ? 'jump' : 'move';
            text = `${cellName(selection.from)} selected · ${n} ${n === 1 ? verb : `${verb}s`}`;
        } else {
            forced = game.mustCapture();
            const subject = vsCpu() ? 'You' : NAME[game.turn];
            text = forced ? `${subject} must capture` : vsCpu() ? 'Your turn' : `${NAME[game.turn]} to move`;
        }
    }
    turn.textContent = text;
    turn.classList.toggle('is-cpu', state === 'playing' && isCpuTurn());
    turn.classList.toggle('is-forced', forced);

    const note = $('note');
    // 快要因為太久沒吃子而和局時提醒
    const left = Math.ceil((80 - game.quiet) / 2);
    const quiet =
        game.status === 'playing' && game.quiet >= 40
            ? ` · Draw in ${left} ${left === 1 ? 'move' : 'moves'} without a capture`
            : '';
    if (vsCpu()) {
        const best = bests[opponent].get() ?? 0;
        const color = `You play ${COLOR[human]}`;
        note.textContent = assisted
            ? `${color} · Undo used, this game won’t count${quiet}`
            : `${color} · Unbeaten streak ${statsOf(opponent).streak} · Best ${best}${quiet}`;
    } else {
        note.textContent = `Red moves first${quiet}`;
    }
}

function announce(text) {
    statusText.textContent = text;
}

// 朗讀「輪到誰」；輪到電腦時不唸，等它走完再一起唸
function turnPrompt() {
    if (game.status !== 'playing' || isCpuTurn()) return '';
    const subject = vsCpu() ? 'Your turn' : `${NAME[game.turn]} to move`;
    if (game.mustCapture()) {
        const pieces = game.movable().map(cellName);
        return `${subject}, capture is compulsory: ${list(pieces)} can jump.`;
    }
    return `${subject}.`;
}

// 一步的說法：「You move c3 to d4」「Computer jumps e5 to c3 to a1, capturing d4 and b2」
function describe(result) {
    const self = vsCpu() && result.side === human;
    const route = result.path.map(cellName).join(' to ');
    let text;
    if (result.captures.length) {
        const caps = result.captures.map(cellName);
        const capsText = caps.length === 1 ? caps[0] : `${caps.slice(0, -1).join(', ')} and ${caps.at(-1)}`;
        text = `${who(result.side)} ${self ? 'jump' : 'jumps'} ${route}, capturing ${capsText}.`;
    } else {
        text = `${who(result.side)} ${self ? 'move' : 'moves'} ${route}.`;
    }
    if (result.promote) {
        const owner = self ? 'Your' : vsCpu() ? 'Computer’s' : `${NAME[result.side]}’s`;
        text += ` ${owner} piece is crowned king.`;
    }
    if (result.captures.length) {
        const count = game.count();
        text += ` Red ${total(count.r)}, black ${total(count.b)}.`;
    }
    return text;
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
    clearTimeout(vanishTimer);
    vanishing.clear();
}

function startAnnouncement() {
    if (!vsCpu()) return 'Red moves first.';
    return human === 'r' ? 'You play red and move first.' : 'You play black. Computer moves first.';
}

function newGame(nextOpponent = opponent) {
    clearTimers();
    opponent = nextOpponent;
    writeStorage(OPPONENT_KEY, opponent);
    game = createCheckers();
    if (vsCpu()) {
        // 對電腦時紅黑輪流執
        human = nextHuman;
        nextHuman = other(human);
        writeStorage(SIDE_KEY, nextHuman);
    }
    assisted = false;
    selection = null;
    setState('playing');
    layoutBoard();
    // 游標放在自己這一方前排中間的格子
    moveCursor(fromView(5, 2), false);
    render();
    renderHud();
    save();
    focusCursor();
    announce(`${OPPONENT_NAMES[opponent]}. ${startAnnouncement()} ${turnPrompt()}`.trim());
    scheduleCpu();
}

// 已經走過棋的局，換對手或開新局要先確認
function requestNewGame(nextOpponent = opponent) {
    if (state === 'ready') {
        // 開始畫面：只換對手，按開始才進入
        opponent = nextOpponent;
        writeStorage(OPPONENT_KEY, opponent);
        showDemo();
        return;
    }
    if (state === 'playing' && game.status === 'playing' && game.history.length > 0) {
        pendingOpponent = nextOpponent;
        clearTimeout(thinkTimer);
        endDrag();
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

function scheduleCpu(after = 0) {
    clearTimeout(thinkTimer);
    if (state !== 'playing' || !isCpuTurn()) return;
    const [min, max] = THINK_MS;
    // 開局第一步不需要想太久
    const delay = after + (game.history.length === 0 ? min : min + Math.random() * (max - min));
    thinkTimer = setTimeout(() => {
        if (state !== 'playing' || !isCpuTurn()) return;
        commit(chooseMove(game.board, cpu(), opponent), 0);
    }, delay);
}

// 走出一整步並更新畫面；from 是動畫從路線的第幾個點開始（玩家連跳時棋子已經在半路上）
function commit(move, from = 0) {
    const result = game.play(move.path);
    if (!result) return;
    navigator.vibrate?.(result.captures.length ? 14 : 8);
    selection = null;
    vanish(result, from);
    render();
    const duration = animatePath(result.path, from);
    const to = squares[result.to];
    to.classList.remove('is-crowned');
    if (result.promote) {
        void to.offsetWidth;
        to.style.setProperty('--crown-delay', `${duration}ms`);
        to.classList.add('is-crowned');
    }
    renderHud();
    save();
    // 對電腦時游標跟著自己的棋子；兩人對戰時跟著剛走的棋子
    if (!vsCpu() || result.side === human) moveCursor(result.to, cellsEl.contains(document.activeElement));

    const text = describe(result);
    if (result.over) {
        finish(text, duration);
        return;
    }
    announce(`${text} ${turnPrompt()}`.trim());
    scheduleCpu(duration);
}

function select(i) {
    selection = { from: i, hops: [] };
    render();
    const info = narrowed();
    const jumping = info.moves[0].captures.length > 0;
    const targets = list(info.next.map(cellName));
    announce(`${cellName(i)} selected. ${jumping ? 'Jump' : 'Move'} to ${targets}.`);
}

function deselect(speak = true) {
    if (!selection) return;
    selection = null;
    render();
    if (speak) announce('Selection cleared.');
}

// 連跳時跳一格（還沒走完就先畫在半路上）
function hop(i, dragged) {
    selection.hops.push(i);
    const info = narrowed();
    if (info.done) {
        commit(info.done, dragged ? info.done.path.length - 1 : selection.hops.length - 1);
        return;
    }
    const prev = selection.hops.at(-2) ?? selection.from;
    render();
    if (!dragged) animatePath([prev, i]);
    const caught = info.moves[0].captures[selection.hops.length - 1];
    const onward = list(info.next.map(cellName));
    announce(`Jumped to ${cellName(i)}, capturing ${cellName(caught)}. Keep jumping: ${onward}.`);
}

function reject(i, text) {
    const el = squares[i];
    el.classList.remove('is-rejected');
    void el.offsetWidth;
    el.classList.add('is-rejected');
    announce(text);
}

// 點一下（或 Space / Enter、拖曳放開）某一格
function activate(i, { dragged = false } = {}) {
    if (!humanCanPlay() || !isDark(i)) return;
    const info = narrowed();
    if (info) {
        if (info.next.includes(i)) return hop(i, dragged);
        // 連跳的終點：只有一條路線停在那裡時可以直接點
        const ending = info.moves.filter((m) => m.to === i && m.path.length > selection.hops.length + 1);
        if (ending.length === 1) return commit(ending[0], dragged ? ending[0].path.length - 1 : selection.hops.length);
        if (ending.length > 1) return reject(i, `More than one way to reach ${cellName(i)}. Tap each jump.`);
    }
    const piece = game.board[i];
    if (sideOf(piece) === game.turn) {
        // 再點一次選取中的子：取消選取
        if (selection && selection.from === i && !selection.hops.length) return deselect();
        if (game.movable().includes(i)) return select(i);
        selection = null;
        render();
        if (game.mustCapture()) {
            return reject(i, `Capture is compulsory: ${list(game.movable().map(cellName))} can jump.`);
        }
        return reject(i, `${cellName(i)} has no moves.`);
    }
    if (selection) return deselect();
    if (piece) return reject(i, `${cellName(i)}, ${pieceName(piece)}. Select one of your own pieces.`);
    announce(`${cellName(i)} is empty. Select one of your pieces first.`);
}

function undo() {
    if (state !== 'playing' || game.status !== 'playing') return;
    clearTimeout(thinkTimer);
    endDrag();
    selection = null;
    let removed = 0;
    if (vsCpu()) {
        // 收回到玩家上一次走的那一步之前：連同之後電腦的回應一起收回
        if (!game.history.some((m) => m.side === human)) return scheduleCpu();
        let last;
        do {
            last = game.undo();
            removed += 1;
        } while (last.side !== human);
        assisted = true;
    } else if (game.undo()) {
        removed = 1;
    }
    if (!removed) return;
    clearTimeout(vanishTimer);
    vanishing.clear();
    render();
    renderHud();
    save();
    announce(`Took back ${removed === 1 ? 'one move' : `${removed} moves`}. ${turnPrompt()}`);
}

function finish(prefix, duration) {
    clearTimeout(thinkTimer);
    const winner = game.winner;
    const count = game.count();
    const title = winner
        ? vsCpu()
            ? winner === human
                ? 'You win'
                : 'Computer wins'
            : `${NAME[winner]} wins`
        : 'Draw';
    let reason = REASONS[game.reason] ?? '';
    if (game.reason === 'no-moves') {
        const loser = other(winner);
        const subject = vsCpu() ? (loser === human ? 'You have' : 'Computer has') : `${NAME[loser]} has`;
        reason = total(count[loser]) === 0 ? 'All pieces captured' : `${subject} no moves left`;
    }
    let spoken = `${title}. ${reason}.`;

    let detail = '';
    let note = '';
    let record = false;
    if (vsCpu()) {
        if (assisted) {
            note = 'Undo used · not counted';
        } else {
            const stats = statsOf(opponent);
            const outcome = !winner ? 'draw' : winner === human ? 'win' : 'loss';
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
        duoTally[winner ?? 'draw'] += 1;
        detail = `Red ${duoTally.r} · Draws ${duoTally.draw} · Black ${duoTally.b}`;
        note = `${game.history.length} moves`;
    }
    if (record) spoken += ` New best unbeaten streak: ${statsOf(opponent).streak}.`;
    announce(`${prefix} ${spoken}`);
    renderHud();
    // 結束就清掉存檔
    save();

    resultTimer = setTimeout(
        () => {
            $('over-title').textContent = title;
            $('over-reason').textContent = reason;
            $('over-detail').textContent = detail;
            $('over-detail').hidden = !detail;
            const noteEl = $('over-note');
            noteEl.textContent = note;
            noteEl.classList.toggle('is-record', record);
            overAt = performance.now();
            setState('over');
            root.dataset.outcome = !winner ? 'draw' : vsCpu() ? (winner === human ? 'win' : 'loss') : 'win';
            overlays.over.querySelector('.btn').focus({ preventScroll: true });
        },
        duration + (reducedMotion.matches ? 400 : RESULT_DELAY_MS)
    );
}

// ---------- 滑鼠 / 觸控：點一下選子、再點落點；也可以按住拖曳 ----------

let drag = null;
// 拖曳放開後瀏覽器還會送一次 click，要忽略
let swallowClick = false;

cellsEl.addEventListener('click', (event) => {
    const el = event.target.closest('.cell[data-i]');
    if (!el) return;
    if (swallowClick) {
        swallowClick = false;
        return;
    }
    const i = Number(el.dataset.i);
    moveCursor(i, false);
    activate(i);
});

cellsEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !humanCanPlay()) return;
    const el = event.target.closest('.cell[data-i]');
    if (!el) return;
    const i = Number(el.dataset.i);
    // 只有可以動的子（或連跳途中選取的子）可以拖
    const draggable = i === selectedAt() || (sideOf(game.board[i]) === game.turn && game.movable().includes(i));
    if (!draggable || (selection?.hops.length && i !== selectedAt())) return;
    drag = { i, x: event.clientX, y: event.clientY, id: event.pointerId, active: false };
});

cellsEl.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        drag.active = true;
        if (selectedAt() !== drag.i) select(drag.i);
        cellsEl.setPointerCapture?.(drag.id);
        squares[drag.i].classList.add('is-drag');
    }
    squares[drag.i].firstChild.style.translate = `${dx}px ${dy}px`;
});

function endDrag() {
    if (!drag) return;
    const el = squares[drag.i];
    el.classList.remove('is-drag');
    el.firstChild.style.translate = '';
    drag = null;
}

cellsEl.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const wasActive = drag.active;
    endDrag();
    if (!wasActive) return;
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.cell[data-i]');
    if (!target) return;
    const i = Number(target.dataset.i);
    const info = narrowed();
    // 放在可以走到的格子才算數，否則棋子回到原位、保持選取
    if (info && (info.next.includes(i) || info.moves.some((m) => m.to === i))) {
        moveCursor(i, false);
        activate(i, { dragged: true });
    }
});

cellsEl.addEventListener('pointercancel', endDrag);

// ---------- 鍵盤：方向鍵移動游標（只停在深色格），Space / Enter 交給按鈕本身的 click ----------

function moveCursor(next, focus = true) {
    if (!isDark(next)) return;
    squares[cursor].tabIndex = -1;
    cursor = next;
    squares[cursor].tabIndex = 0;
    if (focus) squares[cursor].focus({ preventScroll: true });
}

function focusCursor() {
    squares[cursor].focus({ preventScroll: true });
}

// 在畫面上的位置移動：左右一次跳兩格（同一列的下一個深色格），上下一次一列、左右交替
function stepCursor(key) {
    const view = toView(cursor);
    const row = Math.floor(view / N);
    const col = view % N;
    const inside = (c) => c >= 0 && c < N;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const c = col + (key === 'ArrowLeft' ? -2 : 2);
        if (inside(c)) moveCursor(fromView(row, c));
        else moveCursor(cursor);
        return;
    }
    if (key === 'Home' || key === 'End') {
        const cols = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => isDark(fromView(row, c)));
        moveCursor(fromView(row, key === 'Home' ? cols[0] : cols.at(-1)));
        return;
    }
    const r = row + (key === 'ArrowUp' ? -1 : 1);
    if (r < 0 || r >= N) return moveCursor(cursor);
    let c = col + zigzag;
    if (!inside(c)) c = col - zigzag;
    zigzag = col - c;
    moveCursor(fromView(r, c));
}

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing') {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
            event.preventDefault();
            stepCursor(key);
        } else if (key === 'Escape') {
            endDrag();
            deselect();
        } else if (key === 'u' && !event.repeat) {
            undo();
        } else if (key === 'n' && !event.repeat) {
            requestNewGame();
        }
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
            // newGame 會把焦點移到格子上；不擋掉的話這次 Enter 會接著選那一格
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

// 示意盤面：中盤，黑剛走 c5-d4，紅的 c3 必須連跳 e5、g7（選取中，標出落點與終點）
const at = (name) => (N - Number(name[1])) * N + 'abcdefgh'.indexOf(name[0]);
function demoBoard() {
    const board = Array(SIZE).fill(null);
    for (const name of ['b8', 'd8', 'f8', 'h8', 'a7', 'c7', 'e7', 'b6', 'd6', 'f6', 'c5']) board[at(name)] = 'b';
    for (const name of ['c1', 'e1', 'b2', 'f2', 'h2', 'a3', 'c3', 'g3', 'h4']) board[at(name)] = 'r';
    board[at('d2')] = 'R';
    return board;
}

function showDemo() {
    clearTimers();
    game = createCheckers({ state: { board: demoBoard(), turn: 'b', moves: [[at('c5'), at('d4')]] } });
    human = nextHuman;
    setState('ready');
    layoutBoard();
    selection = { from: at('c3'), hops: [] };
    render();
    renderHud();
}

buildBoard();
const saved = loadSaved();
if (saved) {
    opponent = saved.opponent;
    human = saved.human;
    assisted = saved.assisted;
    game = saved.game;
    setState('playing');
    layoutBoard();
    moveCursor(fromView(5, 2), false);
    render();
    renderHud();
    announce(`${OPPONENT_NAMES[opponent]}, game in progress. ${turnPrompt()}`.trim());
    scheduleCpu();
} else {
    showDemo();
}
