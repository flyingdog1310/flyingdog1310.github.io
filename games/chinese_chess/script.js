// 象棋：畫面與操作。遊戲規則與電腦對手在 core.js
// 棋子放在交叉點上（每個交叉點是一個 <button>），棋盤線、河界、九宮用 SVG 畫在下面
// 走一步分兩段：先選子（亮出可以走到的點），再選落點；也可以拖曳
import { COLS, LEVELS, ROWS, SIZE, chooseMove, createXiangqi, other, sideOf, squareName, typeOf } from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 電腦「想一下」再走，也讓玩家看完上一步（實際計算時間另外算，hard 在桌機上約 15 ms）
const THINK_MS = [450, 750];
// 棋子滑過去的時間：基本時間 + 每格多一點
const SLIDE_MS = 150;
const SLIDE_PER_SQUARE_MS = 22;
const SLIDE_MAX_MS = 340;
// 最後一步走完之後再顯示結果
const RESULT_DELAY_MS = 1100;
// 按住棋子移動超過這個距離才算拖曳（否則是點一下）
const DRAG_PX = 6;
// 剩幾手（半回合）就因為沒有吃子而和局時開始提醒
const NO_CAPTURE_WARN = 100;

const SAVE_KEY = 'jsgames:chinese-chess:game';
const OPPONENT_KEY = 'jsgames:chinese-chess:opponent';
const SIDE_KEY = 'jsgames:chinese-chess:side';
const STATS_KEY = 'jsgames:chinese-chess:stats';

// 對手：電腦的三種難度，或兩人同一台裝置輪流下
const OPPONENTS = [...LEVELS, 'duo'];
const OPPONENT_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', duo: '2 players' };
const NAME = { r: 'Red', b: 'Black' };
const COLOR = { r: 'red', b: 'black' };
const PIECE_NAMES = {
    k: 'general',
    a: 'advisor',
    b: 'elephant',
    n: 'horse',
    r: 'chariot',
    c: 'cannon',
    p: 'soldier',
};
// 棋子上的字：紅 帥仕相俥傌炮兵、黑 將士象車馬砲卒
const CHARS = {
    K: '帥',
    A: '仕',
    B: '相',
    N: '傌',
    R: '俥',
    C: '炮',
    P: '兵',
    k: '將',
    a: '士',
    b: '象',
    n: '馬',
    r: '車',
    c: '砲',
    p: '卒',
};
const REASONS = {
    checkmate: 'Checkmate',
    stalemate: 'No legal moves left',
    perpetual: 'Perpetual check loses',
    repetition: 'Repetition',
    nocapture: '60 moves without a capture',
    material: 'No attacking pieces left',
};

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.xiangqi');
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
const bests = Object.fromEntries(LEVELS.map((level) => [level, highScore(`chinese-chess:${level}`)]));

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
// 選取的棋子所在的交叉點（-1 是沒有選）
let selected = -1;
// 盤面朝向：下方是哪一方
let bottom = 'r';
// 每個交叉點的按鈕，依盤面 index
let points = [];
// 鍵盤游標所在的交叉點
let cursor = 70;
let overAt = 0;
let thinkTimer = 0;
let resultTimer = 0;

const vsCpu = () => opponent !== 'duo';
const cpu = () => other(human);
const isCpuTurn = () => vsCpu() && game.status === 'playing' && game.turn === cpu();
const humanCanPlay = () => state === 'playing' && game.status === 'playing' && !isCpuTurn();
const who = (side) => (vsCpu() ? (side === human ? 'You' : 'Computer') : NAME[side]);
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const pieceName = (piece) => `${COLOR[sideOf(piece)]} ${PIECE_NAMES[typeOf(piece)]}`;
const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

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
        const restored = createXiangqi({ state: saved.game });
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

// ---------- 棋盤 ----------

// 盤面 index ↔ 畫面上的位置（執黑時整個盤面轉 180 度）
const toView = (i) => (bottom === 'r' ? i : SIZE - 1 - i);
const fromView = (row, col) => toView(row * COLS + col);

// 棋盤線：外框、9 條直線（中間 7 條在河界斷開）、10 條橫線、九宮的斜線、炮與兵的位置記號、河界的字
function drawLines() {
    const x = (c) => 5 + c * 10;
    const y = (r) => 5 + r * 10;
    const parts = [];
    const line = (x1, y1, x2, y2) => parts.push(`M${x1} ${y1}L${x2} ${y2}`);
    for (let r = 0; r < ROWS; r++) line(x(0), y(r), x(8), y(r));
    for (let c = 0; c < COLS; c++) {
        if (c === 0 || c === COLS - 1) line(x(c), y(0), x(c), y(9));
        else {
            line(x(c), y(0), x(c), y(4));
            line(x(c), y(5), x(c), y(9));
        }
    }
    line(x(3), y(0), x(5), y(2));
    line(x(5), y(0), x(3), y(2));
    line(x(3), y(7), x(5), y(9));
    line(x(5), y(7), x(3), y(9));
    // 炮與兵（卒）的起始位置：交叉點四個角的 L 形記號（盤邊那一側不畫）
    const marks = [];
    const mark = (r, c) => {
        for (const dx of [-1, 1]) {
            if ((c === 0 && dx < 0) || (c === COLS - 1 && dx > 0)) continue;
            for (const dy of [-1, 1]) {
                const cx = x(c) + dx * 1.2;
                const cy = y(r) + dy * 1.2;
                marks.push(`M${cx + dx * 2.6} ${cy}H${cx}V${cy + dy * 2.6}`);
            }
        }
    };
    for (const r of [2, 7]) for (const c of [1, 7]) mark(r, c);
    for (const r of [3, 6]) for (let c = 0; c < COLS; c += 2) mark(r, c);
    const svgNS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, text) => {
        const node = document.createElementNS(svgNS, tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        if (text) node.textContent = text;
        return node;
    };
    $('lines').replaceChildren(
        el('rect', { class: 'lines__frame', x: 2.2, y: 2.2, width: 85.6, height: 95.6 }),
        el('path', { class: 'lines__grid', d: parts.join('') }),
        el('path', { class: 'lines__marks', d: marks.join('') }),
        el('text', { class: 'lines__river', x: 25, y: 50 }, '楚 河'),
        el('text', { class: 'lines__river', x: 65, y: 50 }, '漢 界')
    );
}

function buildBoard() {
    drawLines();
    points = Array.from({ length: SIZE }, (_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'point';
        button.dataset.i = i;
        button.tabIndex = i === cursor ? 0 : -1;
        const piece = document.createElement('span');
        piece.className = 'piece';
        piece.setAttribute('aria-hidden', 'true');
        button.append(piece);
        return button;
    });
    layoutBoard();
}

// 依朝向排列交叉點與盤邊座標：下方 a–i、左邊 0–9（執黑時上下左右反過來）
function layoutBoard() {
    bottom = vsCpu() && state !== 'ready' ? human : 'r';
    const order = Array.from({ length: SIZE }, (_, k) => points[toView(k)]);
    cellsEl.replaceChildren(...order);
    const label = (text) => Object.assign(document.createElement('span'), { textContent: text });
    const files = [...'abcdefghi'];
    const ranks = Array.from({ length: ROWS }, (_, r) => String(ROWS - 1 - r));
    if (bottom === 'b') {
        files.reverse();
        ranks.reverse();
    }
    $('coords-cols').replaceChildren(...files.map(label));
    $('coords-rows').replaceChildren(...ranks.map(label));
}

// 開始畫面的示意盤面也顯示提示
const hintsOn = () => game.status === 'playing' && (state === 'ready' || humanCanPlay());

// 依 game.board 與選取狀態重畫所有交叉點
function render() {
    const hints = hintsOn();
    const targets = new Map();
    if (selected >= 0) for (const m of game.movesFrom(selected)) targets.set(m.to, m);
    const movable = new Set(hints ? game.movable() : []);
    const inCheck = game.check >= 0;
    const last = game.last();
    const mated = game.status === 'over' && game.winner ? findGeneral(other(game.winner)) : -1;

    for (let i = 0; i < SIZE; i++) {
        const el = points[i];
        const piece = game.board[i];
        if ((el.dataset.piece ?? null) !== piece) {
            if (piece) {
                el.dataset.piece = piece;
                el.dataset.color = sideOf(piece);
                el.firstChild.textContent = CHARS[piece];
            } else {
                delete el.dataset.piece;
                delete el.dataset.color;
                el.firstChild.textContent = '';
            }
        }
        const target = targets.get(i);
        el.classList.toggle('is-selected', i === selected);
        // 被將軍時，能解將的子加上黃框（平常可以動的子只在滑鼠移上去時亮起）
        el.classList.toggle('is-movable', movable.has(i) && inCheck && selected < 0);
        el.classList.toggle('can-move', movable.has(i) && i !== selected);
        el.classList.toggle('is-next', Boolean(target));
        el.classList.toggle('is-capture', Boolean(target?.captured));
        el.classList.toggle('is-from', Boolean(last) && i === last.from);
        el.classList.toggle('is-to', Boolean(last) && i === last.to);
        el.classList.toggle('is-check', i === game.check);
        el.classList.toggle('is-mated', i === mated && state !== 'ready');

        const parts = [squareName(i), piece ? pieceName(piece) : 'empty'];
        if (i === selected) parts.push('selected');
        else if (movable.has(i) && selected < 0) parts.push('can move');
        if (target) parts.push(target.captured ? 'capture' : 'move here');
        if (i === game.check) parts.push(game.reason === 'checkmate' ? 'checkmated' : 'in check');
        if (last && i === last.to) parts.push('last move');
        else if (last && i === last.from) parts.push('moved from here');
        el.setAttribute('aria-label', parts.join(', '));
    }
    root.dataset.result = game.status === 'over' ? (game.winner ?? 'draw') : '';
    root.dataset.turn = game.status === 'playing' ? game.turn : '';
    root.dataset.check = game.status === 'playing' && inCheck ? game.turn : '';
    root.dataset.input = humanCanPlay() ? 'on' : 'off';
    renderInfo();
    renderMoves();
}

const findGeneral = (side) => game.board.indexOf(side === 'r' ? 'K' : 'k');

// 棋子從 from 滑到 to（to 那一點已經畫上棋子）；回傳動畫時間
function slide(from, to) {
    if (reducedMotion.matches) return 0;
    const target = points[to];
    const source = points[from];
    const dx = source.offsetLeft - target.offsetLeft;
    const dy = source.offsetTop - target.offsetTop;
    const distance = Math.hypot(dx, dy) / (target.offsetWidth || 1);
    const duration = Math.min(SLIDE_MAX_MS, SLIDE_MS + distance * SLIDE_PER_SQUARE_MS);
    target.classList.add('is-moving');
    const animation = target.firstChild.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' }
    );
    const done = () => target.classList.remove('is-moving');
    animation.finished.then(done, done);
    return duration;
}

// 被吃的子：在原本的交叉點留一個淡出的影子，棋子快到的時候消失
function ghost(at, piece, delay) {
    const span = document.createElement('span');
    span.className = `piece ghost is-${sideOf(piece)}`;
    span.setAttribute('aria-hidden', 'true');
    span.textContent = CHARS[piece];
    span.style.setProperty('--vanish-delay', `${delay}ms`);
    points[at].append(span);
    setTimeout(() => span.remove(), delay + 400);
}

// ---------- 分數列、提示文字、棋譜 ----------

// 子力差放在帥 / 將旁邊（放不下時被裁掉的是後面的小棋子），再來是吃掉的子
function takenIcons(el, pieces, side, lead) {
    el.replaceChildren();
    if (lead > 0)
        el.append(Object.assign(document.createElement('span'), { className: 'side__lead', textContent: `+${lead}` }));
    const victim = other(side);
    let prev = null;
    for (const type of pieces) {
        const letter = victim === 'r' ? type.toUpperCase() : type;
        const span = Object.assign(document.createElement('span'), {
            className: `mini is-${victim}${prev && prev !== type ? ' is-gap' : ''}`,
            textContent: CHARS[letter],
        });
        el.append(span);
        prev = type;
    }
    const names = pieces.map((type) => PIECE_NAMES[type]);
    el.setAttribute(
        'aria-label',
        `${names.length ? `Captured ${list(names)}` : 'No captures'}${lead > 0 ? `, ahead by ${lead}` : ''}`
    );
}

function renderHud() {
    root.dataset.mode = vsCpu() ? 'cpu' : 'duo';
    const sideA = vsCpu() ? human : 'r';
    const sideB = other(sideA);
    const { taken, diff } = game.material();
    for (const [id, side] of [
        ['side-a', sideA],
        ['side-b', sideB],
    ]) {
        $(id).dataset.side = side;
        $(id).querySelector('.side__piece').textContent = side === 'r' ? CHARS.K : CHARS.k;
    }
    $('name-a').textContent = vsCpu() ? 'You' : 'Red';
    $('name-b').textContent = vsCpu() ? 'Computer' : 'Black';
    const lead = (side) => (side === 'r' ? diff : -diff);
    takenIcons($('taken-a'), taken[sideA], sideA, lead(sideA));
    takenIcons($('taken-b'), taken[sideB], sideB, lead(sideB));
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
    const check = state === 'playing' && game.status === 'playing' && game.check >= 0 && !isCpuTurn();
    if (state === 'playing' && game.status === 'playing') {
        if (isCpuTurn()) text = 'Computer is thinking…';
        else if (selected >= 0) {
            const n = game.movesFrom(selected).length;
            const name = capitalize(PIECE_NAMES[typeOf(game.board[selected])]);
            text = `${name} ${squareName(selected)} · ${n} ${n === 1 ? 'move' : 'moves'}`;
        } else {
            const subject = vsCpu() ? 'Your turn' : `${NAME[game.turn]} to move`;
            text = check ? `Check! ${subject}` : subject;
        }
    }
    turn.textContent = text;
    turn.classList.toggle('is-cpu', state === 'playing' && isCpuTurn());
    turn.classList.toggle('is-check', check && selected < 0);

    // 快要結束時提醒：60 回合沒有吃子、同一局面已經出現兩次（第三次結束，長將的一方輸）
    const note = $('note');
    let warning = '';
    if (game.status === 'playing' && state !== 'ready') {
        const left = Math.ceil((120 - game.halfmove) / 2);
        if (game.halfmove >= NO_CAPTURE_WARN)
            warning = `Draw in ${left} ${left === 1 ? 'move' : 'moves'} without a capture`;
        else if (game.repeats() >= 2) warning = 'Position repeated · once more ends the game';
    }
    note.classList.toggle('is-warning', Boolean(warning));
    if (warning) note.textContent = warning;
    else if (vsCpu()) {
        const best = bests[opponent].get() ?? 0;
        const color = `You play ${COLOR[human]}`;
        note.textContent = assisted
            ? `${color} · Undo used, this game won’t count`
            : `${color} · Unbeaten streak ${statsOf(opponent).streak} · Best ${best}`;
    } else {
        note.textContent = 'Red moves first';
    }
}

function renderMoves() {
    const el = $('moves');
    const items = [];
    let li = null;
    let number = 1;
    // 一個 <li> 是一個回合（紅、黑各一步）；第一步是黑方時（從指定局面開始）寫成「1…」
    game.history.forEach((move, k) => {
        if (move.side === 'r' || !li) {
            li = document.createElement('li');
            const num = Object.assign(document.createElement('span'), { className: 'moves__num' });
            num.textContent = move.side === 'r' ? `${number}.` : `${number}…`;
            li.append(num);
            items.push(li);
        }
        const last = k === game.history.length - 1;
        li.append(
            Object.assign(document.createElement('span'), {
                className: `moves__san is-${move.side}${last ? ' is-last' : ''}`,
                textContent: move.notation,
            })
        );
        if (move.side === 'b') {
            number++;
            li = null;
        }
    });
    el.replaceChildren(...items);
    el.scrollLeft = el.scrollWidth;
    markScrolled();
}

// 棋譜捲動過時左邊淡出，看得出前面還有
const markScrolled = () => $('moves').classList.toggle('is-scrolled', $('moves').scrollLeft > 0);
$('moves').addEventListener('scroll', markScrolled, { passive: true });

function announce(text) {
    statusText.textContent = text;
}

// 朗讀「輪到誰」；輪到電腦時不唸，等它走完再一起唸
function turnPrompt() {
    if (game.status !== 'playing' || isCpuTurn()) return '';
    const subject = vsCpu() ? 'Your turn' : `${NAME[game.turn]} to move`;
    return game.check >= 0 ? `${subject}, your general is in check.` : `${subject}.`;
}

// 一步的說法：「You: cannon h2 to e2.」「Computer: chariot a9 takes horse on a2. Check.」
function describe(result) {
    let text = `${PIECE_NAMES[typeOf(result.piece)]} ${squareName(result.from)}`;
    if (result.captured) text += ` takes ${PIECE_NAMES[typeOf(result.captured)]} on ${squareName(result.to)}`;
    else text += ` to ${squareName(result.to)}`;
    text = vsCpu() ? `${who(result.side)}: ${text}.` : `${NAME[result.side]} ${text}.`;
    if (result.mate) text += ' Checkmate.';
    else if (result.check) text += ' Check.';
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
}

function startAnnouncement() {
    if (!vsCpu()) return 'Red moves first.';
    return human === 'r' ? 'You play red and move first.' : 'You play black. Computer moves first.';
}

// 游標放在自己這一方右邊的炮
const homeCursor = () => (bottom === 'r' ? 70 : SIZE - 1 - 70);

function newGame(nextOpponent = opponent) {
    clearTimers();
    endDrag();
    opponent = nextOpponent;
    writeStorage(OPPONENT_KEY, opponent);
    game = createXiangqi();
    if (vsCpu()) {
        // 對電腦時紅黑輪流執
        human = nextHuman;
        nextHuman = other(human);
        writeStorage(SIDE_KEY, nextHuman);
    }
    assisted = false;
    selected = -1;
    setState('playing');
    layoutBoard();
    moveCursor(homeCursor(), false);
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
    render();
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
        commit(chooseMove(game, opponent));
    }, delay);
}

// 走出一步並更新畫面；dragged 時棋子已經在落點上，不用滑過去
function commit(move, { dragged = false } = {}) {
    const result = game.play(move);
    if (!result) return;
    navigator.vibrate?.(result.captured ? 14 : 8);
    selected = -1;
    render();
    const duration = dragged ? 0 : slide(result.from, result.to);
    if (result.captured) ghost(result.to, result.captured, reducedMotion.matches ? 0 : duration * 0.55);
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
    selected = i;
    render();
    const targets = game
        .movesFrom(i)
        .map((m) => `${squareName(m.to)}${m.captured ? ` (takes ${PIECE_NAMES[typeOf(m.captured)]})` : ''}`);
    announce(`${capitalize(pieceName(game.board[i]))} on ${squareName(i)} selected. Moves: ${list(targets)}.`);
}

function deselect(speak = true) {
    if (selected < 0) return;
    selected = -1;
    render();
    if (speak) announce('Selection cleared.');
}

function reject(i, text) {
    const el = points[i];
    el.classList.remove('is-rejected');
    void el.offsetWidth;
    el.classList.add('is-rejected');
    announce(text);
}

// 點一下（或 Space / Enter、拖曳放開）某一點
function activate(i, { dragged = false } = {}) {
    if (!humanCanPlay()) return;
    if (selected >= 0 && game.movesFrom(selected).some((m) => m.to === i)) {
        return commit({ from: selected, to: i }, { dragged });
    }
    const piece = game.board[i];
    if (sideOf(piece) === game.turn) {
        // 再點一次選取中的子：取消選取
        if (selected === i) return deselect();
        if (game.movable().includes(i)) return select(i);
        selected = -1;
        render();
        if (game.check >= 0) {
            return reject(i, `Your general is in check. The ${PIECE_NAMES[typeOf(piece)]} can’t help.`);
        }
        return reject(i, `${capitalize(pieceName(piece))} on ${squareName(i)} has no legal moves.`);
    }
    if (selected >= 0) return deselect();
    if (piece) return reject(i, `${squareName(i)}, ${pieceName(piece)}. Select one of your own pieces.`);
    announce(`${squareName(i)} is empty. Select one of your pieces first.`);
}

function undo() {
    if (state !== 'playing' || game.status !== 'playing') return;
    clearTimeout(thinkTimer);
    endDrag();
    selected = -1;
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
    render();
    renderHud();
    save();
    focusCursor();
    announce(`Took back ${removed === 1 ? 'one move' : `${removed} moves`}. ${turnPrompt()}`);
}

function finish(prefix, duration) {
    clearTimeout(thinkTimer);
    const winner = game.winner;
    const title = winner
        ? vsCpu()
            ? winner === human
                ? 'You win'
                : 'Computer wins'
            : `${NAME[winner]} wins`
        : 'Draw';
    const reason = REASONS[game.reason] ?? '';
    // 將死在描述那一步時已經唸過
    let spoken = game.reason === 'checkmate' ? `${title}.` : `${title}. ${reason}.`;

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
        note = `${Math.ceil(game.history.length / 2)} moves`;
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
            // 卡片放在不擋住輸的一方的帥 / 將的一側（在畫面下半部就把卡片放上面）
            const general = winner ? findGeneral(other(winner)) : -1;
            const row = general >= 0 ? Math.floor(toView(general) / COLS) : 0;
            overlays.over.classList.toggle('is-top', row >= ROWS / 2);
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
    const el = event.target.closest('.point');
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
    const el = event.target.closest('.point');
    if (!el) return;
    const i = Number(el.dataset.i);
    // 只有可以動的子可以拖
    if (sideOf(game.board[i]) !== game.turn || !game.movable().includes(i)) return;
    drag = { i, x: event.clientX, y: event.clientY, id: event.pointerId, active: false };
});

cellsEl.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        drag.active = true;
        if (selected !== drag.i) select(drag.i);
        cellsEl.setPointerCapture?.(drag.id);
        points[drag.i].classList.add('is-drag');
    }
    points[drag.i].firstChild.style.translate = `${dx}px ${dy}px`;
});

function endDrag() {
    if (!drag) return;
    const el = points[drag.i];
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
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.point');
    if (!target) return;
    const i = Number(target.dataset.i);
    // 放在可以走到的點才算數，否則棋子回到原位、保持選取
    if (selected >= 0 && game.movesFrom(selected).some((m) => m.to === i)) {
        moveCursor(i, false);
        activate(i, { dragged: true });
    }
});

cellsEl.addEventListener('pointercancel', endDrag);

// ---------- 鍵盤：方向鍵移動游標，Space / Enter 交給按鈕本身的 click ----------

function moveCursor(next, focus = true) {
    points[cursor].tabIndex = -1;
    cursor = next;
    points[cursor].tabIndex = 0;
    if (focus) points[cursor].focus({ preventScroll: true });
}

function focusCursor() {
    points[cursor].focus({ preventScroll: true });
}

// 在畫面上的位置移動
function stepCursor(key) {
    const view = toView(cursor);
    let row = Math.floor(view / COLS);
    let col = view % COLS;
    if (key === 'ArrowLeft') col = Math.max(0, col - 1);
    else if (key === 'ArrowRight') col = Math.min(COLS - 1, col + 1);
    else if (key === 'ArrowUp') row = Math.max(0, row - 1);
    else if (key === 'ArrowDown') row = Math.min(ROWS - 1, row + 1);
    else if (key === 'Home') col = 0;
    else if (key === 'End') col = COLS - 1;
    moveCursor(fromView(row, col));
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
            // newGame 會把焦點移到交叉點上；不擋掉的話這次 Enter 會接著選那一點
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

// 示意盤面：中炮對屏風馬，紅方 e2 的炮選取中（可以隔著 e3 的兵吃 e6 的卒）
const DEMO = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b9c7'];

function showDemo() {
    clearTimers();
    endDrag();
    game = createXiangqi({ state: { moves: DEMO } });
    human = nextHuman;
    setState('ready');
    layoutBoard();
    selected = 67;
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
    moveCursor(homeCursor(), false);
    render();
    renderHud();
    announce(`${OPPONENT_NAMES[opponent]}, game in progress. ${turnPrompt()}`.trim());
    scheduleCpu();
} else {
    showDemo();
}
