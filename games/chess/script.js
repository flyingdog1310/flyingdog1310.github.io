// 西洋棋：畫面與操作。遊戲規則與電腦對手在 core.js
// 走一步分兩段：先選子（亮出可以走到的格子），再選落點；也可以拖曳。兵走到底線時在那一行跳出升變的選擇
import { LEVELS, N, SIZE, chooseMove, createChess, isLight, other, sideOf, squareName, typeOf } from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 電腦「想一下」再走，也讓玩家看完上一步（實際計算時間另外算，hard 在桌機上約 20 ms）
const THINK_MS = [450, 750];
// 棋子滑過去的時間：基本時間 + 每格多一點
const SLIDE_MS = 150;
const SLIDE_PER_SQUARE_MS = 22;
const SLIDE_MAX_MS = 320;
// 最後一步走完之後再顯示結果
const RESULT_DELAY_MS = 1100;
// 按住棋子移動超過這個距離才算拖曳（否則是點一下）
const DRAG_PX = 6;

const SAVE_KEY = 'jsgames:chess:game';
const OPPONENT_KEY = 'jsgames:chess:opponent';
const SIDE_KEY = 'jsgames:chess:side';
const STATS_KEY = 'jsgames:chess:stats';

// 對手：電腦的三種難度，或兩人同一台裝置輪流下
const OPPONENTS = [...LEVELS, 'duo'];
const OPPONENT_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', duo: '2 players' };
const NAME = { w: 'White', b: 'Black' };
const COLOR = { w: 'white', b: 'black' };
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PROMOTIONS = ['q', 'r', 'b', 'n'];
const REASONS = {
    checkmate: 'Checkmate',
    stalemate: 'Stalemate',
    repetition: 'Threefold repetition',
    fifty: 'Fifty-move rule',
    material: 'Insufficient material',
};

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.chess');
const cellsEl = $('cells');
const statusText = $('status');
const promoEl = $('promo');
const promoList = $('promo-list');
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
const bests = Object.fromEntries(LEVELS.map((level) => [level, highScore(`chess:${level}`)]));

// 兩人對戰的比數只記在這次開啟的期間
const duoTally = { w: 0, b: 0, draw: 0 };

// ---------- 狀態 ----------

let state = 'ready';
let opponent = OPPONENTS.includes(readStorage(OPPONENT_KEY)) ? readStorage(OPPONENT_KEY) : 'normal';
// 對電腦時玩家這一局執哪一色：白永遠先走，每局黑白輪流；玩家的棋子永遠在下方
let human = 'w';
let nextHuman = readStorage(SIDE_KEY) === 'b' ? 'b' : 'w';
let pendingOpponent = null;
let game = null;
// 這局對電腦時收回過棋，結果就不記入戰績
let assisted = false;
// 選取的棋子所在的格子（-1 是沒有選）
let selected = -1;
// 升變選擇中：{ from, to, dragged }
let promotion = null;
// 盤面朝向：下方是哪一方
let bottom = 'w';
// 每一格的按鈕，依盤面 index
let squares = [];
// 鍵盤游標所在的格子
let cursor = 52;
let overAt = 0;
let thinkTimer = 0;
let resultTimer = 0;

const vsCpu = () => opponent !== 'duo';
const cpu = () => other(human);
const isCpuTurn = () => vsCpu() && game.status === 'playing' && game.turn === cpu();
const humanCanPlay = () => state === 'playing' && game.status === 'playing' && !isCpuTurn() && !promotion;
const who = (side) => (vsCpu() ? (side === human ? 'You' : 'Computer') : NAME[side]);
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const pieceName = (piece) => `${COLOR[sideOf(piece)]} ${PIECE_NAMES[typeOf(piece)]}`;

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
        const restored = createChess({ state: saved.game });
        if (restored.status !== 'playing' || restored.history.length === 0) return null;
        return {
            opponent: saved.opponent,
            human: saved.human === 'b' ? 'b' : 'w',
            assisted: Boolean(saved.assisted),
            game: restored,
        };
    } catch {
        return null;
    }
}

// ---------- 盤面 ----------

// 盤面 index ↔ 畫面上的位置（執黑時整個盤面轉 180 度）
const toView = (i) => (bottom === 'w' ? i : SIZE - 1 - i);
const fromView = (row, col) => toView(row * N + col);

const svgNS = 'http://www.w3.org/2000/svg';
function pieceSvg(className) {
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 45 45');
    svg.setAttribute('aria-hidden', 'true');
    svg.append(document.createElementNS(svgNS, 'use'));
    return svg;
}
const setPieceType = (svg, piece) => svg.firstChild.setAttribute('href', `#p-${typeOf(piece)}`);

function buildBoard() {
    squares = Array.from({ length: SIZE }, (_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = isLight(i) ? 'cell' : 'cell is-dark';
        button.dataset.i = i;
        button.tabIndex = i === cursor ? 0 : -1;
        button.append(pieceSvg('piece'));
        return button;
    });
    layoutBoard();
}

// 依朝向排列格子與盤邊座標：下方 a–h、左邊 1–8
function layoutBoard() {
    bottom = vsCpu() && state !== 'ready' ? human : 'w';
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

// 開始畫面的示意盤面也顯示提示
const hintsOn = () => game.status === 'playing' && (state === 'ready' || humanCanPlay() || promotion);

// 依 game.board 與選取狀態重畫所有格子
function render() {
    const hints = hintsOn();
    const targets = new Map();
    if (selected >= 0) for (const m of game.movesFrom(selected)) targets.set(m.to, m);
    const movable = new Set(hints ? game.movable() : []);
    const inCheck = game.check >= 0;
    const last = game.last();
    const mated = game.reason === 'checkmate' ? game.check : -1;

    for (let i = 0; i < SIZE; i++) {
        const el = squares[i];
        const piece = game.board[i];
        if ((el.dataset.piece ?? null) !== piece) {
            if (piece) {
                el.dataset.piece = piece;
                el.dataset.color = sideOf(piece);
                setPieceType(el.firstChild, piece);
            } else {
                delete el.dataset.piece;
                delete el.dataset.color;
            }
        }
        const target = targets.get(i);
        el.classList.toggle('is-selected', i === selected);
        // 被將軍時，能解將的子加上黃框（平常可以動的子只在滑鼠移上去時亮起）
        el.classList.toggle('is-movable', movable.has(i) && inCheck && selected < 0);
        el.classList.toggle('can-move', movable.has(i) && i !== selected);
        el.classList.toggle('is-next', Boolean(target));
        el.classList.toggle('is-capture', Boolean(target?.captured));
        el.classList.toggle('is-trail', Boolean(last) && (i === last.from || i === last.to));
        el.classList.toggle('is-check', i === game.check);
        el.classList.toggle('is-mated', i === mated && state !== 'ready');

        const parts = [squareName(i), piece ? pieceName(piece) : 'empty'];
        if (i === selected) parts.push('selected');
        else if (movable.has(i) && selected < 0) parts.push('can move');
        if (target) {
            if (target.castle) parts.push(`castle ${target.castle}side`);
            else if (target.enPassant) parts.push('capture en passant');
            else parts.push(target.captured ? 'capture' : 'move here');
            if (target.promotion) parts.push('promotes');
        }
        if (i === game.check) parts.push(mated >= 0 ? 'checkmated' : 'in check');
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

// 棋子從 from 滑到 to（to 那一格已經畫上棋子）；回傳動畫時間
function slide(from, to) {
    if (reducedMotion.matches) return 0;
    const target = squares[to];
    const source = squares[from];
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

// 被吃的子：在原本的格子留一個淡出的影子，棋子快到的時候消失
function ghost(at, piece, delay) {
    const svg = pieceSvg(`ghost is-${sideOf(piece)}`);
    setPieceType(svg, piece);
    svg.style.setProperty('--vanish-delay', `${delay}ms`);
    squares[at].append(svg);
    setTimeout(() => svg.remove(), delay + 400);
}

// ---------- 分數列、提示文字、棋譜 ----------

// 子力差放在王旁邊（放不下時被裁掉的是後面的小棋子），再來是吃掉的子
function takenIcons(el, pieces, side, lead) {
    el.replaceChildren();
    if (lead > 0)
        el.append(Object.assign(document.createElement('span'), { className: 'side__lead', textContent: `+${lead}` }));
    let prev = null;
    for (const type of pieces) {
        const svg = pieceSvg(`is-${other(side)}${prev && prev !== type ? ' is-gap' : ''}`);
        setPieceType(svg, type);
        el.append(svg);
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
    const sideA = vsCpu() ? human : 'w';
    const sideB = other(sideA);
    const { taken, diff } = game.material();
    $('side-a').dataset.side = sideA;
    $('side-b').dataset.side = sideB;
    $('name-a').textContent = vsCpu() ? 'You' : 'White';
    $('name-b').textContent = vsCpu() ? 'Computer' : 'Black';
    const lead = (side) => (side === 'w' ? diff : -diff);
    takenIcons($('taken-a'), taken[sideA], sideA, lead(sideA));
    takenIcons($('taken-b'), taken[sideB], sideB, lead(sideB));
    const wins = vsCpu()
        ? (({ win, loss, draw }) => [win, loss, draw])(statsOf(opponent))
        : [duoTally.w, duoTally.b, duoTally.draw];
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
        else if (promotion) text = 'Choose a piece to promote to';
        else if (selected >= 0) {
            const n = game.movesFrom(selected).filter((m) => !m.promotion || m.promotion === 'q').length;
            text = `${PIECE_NAMES[typeOf(game.board[selected])]} ${squareName(selected)} · ${n} ${n === 1 ? 'move' : 'moves'}`;
            text = text[0].toUpperCase() + text.slice(1);
        } else {
            const subject = vsCpu() ? 'Your turn' : `${NAME[game.turn]} to move`;
            text = check ? `Check! ${subject}` : subject;
        }
    }
    turn.textContent = text;
    turn.classList.toggle('is-cpu', state === 'playing' && isCpuTurn());
    turn.classList.toggle('is-check', check && selected < 0 && !promotion);

    // 快要和局時提醒：50 回合規則、同一局面已經出現兩次
    const note = $('note');
    let warning = '';
    if (game.status === 'playing' && state !== 'ready') {
        const left = Math.ceil((100 - game.halfmove) / 2);
        if (game.halfmove >= 80)
            warning = `Draw in ${left} ${left === 1 ? 'move' : 'moves'} without a capture or pawn move`;
        else if (game.repeats() >= 2) warning = 'Position repeated · once more is a draw';
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
        note.textContent = 'White moves first';
    }
}

function renderMoves() {
    const el = $('moves');
    const items = [];
    let li = null;
    let number = 1;
    // 一個 <li> 是一個回合（白、黑各一步）；第一步是黑方時（從指定局面開始）寫成「1…」
    game.history.forEach((move, k) => {
        if (move.side === 'w' || !li) {
            li = document.createElement('li');
            const num = Object.assign(document.createElement('span'), { className: 'moves__num' });
            num.textContent = move.side === 'w' ? `${number}.` : `${number}…`;
            li.append(num);
            items.push(li);
        }
        const last = k === game.history.length - 1;
        li.append(
            Object.assign(document.createElement('span'), {
                className: `moves__san${last ? ' is-last' : ''}`,
                textContent: move.san,
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
    return game.check >= 0 ? `${subject}, your king is in check.` : `${subject}.`;
}

// 一步的說法：「You: knight g1 to f3.」「Computer: bishop c4 takes pawn on f7. Check.」
function describe(result) {
    let text;
    if (result.castle) text = `castles ${result.castle}side`;
    else {
        text = `${PIECE_NAMES[typeOf(result.piece)]} ${squareName(result.from)}`;
        if (result.captured) {
            text += ` takes ${PIECE_NAMES[typeOf(result.captured)]} on ${squareName(result.capturedAt)}`;
            if (result.enPassant) text += ' en passant';
        } else text += ` to ${squareName(result.to)}`;
        if (result.promotion) text += `, promotes to ${PIECE_NAMES[result.promotion]}`;
    }
    text = `${who(result.side)}: ${text}.`;
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
    if (!vsCpu()) return 'White moves first.';
    return human === 'w' ? 'You play white and move first.' : 'You play black. Computer moves first.';
}

function newGame(nextOpponent = opponent) {
    clearTimers();
    closePromotion(false);
    opponent = nextOpponent;
    writeStorage(OPPONENT_KEY, opponent);
    game = createChess();
    if (vsCpu()) {
        // 對電腦時黑白輪流執
        human = nextHuman;
        nextHuman = other(human);
        writeStorage(SIDE_KEY, nextHuman);
    }
    assisted = false;
    selected = -1;
    setState('playing');
    layoutBoard();
    // 游標放在自己這一方 e 兵的位置
    moveCursor(bottom === 'w' ? 52 : 12, false);
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
        closePromotion(false);
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
    if (result.castle) {
        // 車跟著王移過去
        const rookFrom = result.to > result.from ? result.to + 1 : result.to - 2;
        const rookTo = result.to > result.from ? result.to - 1 : result.to + 1;
        slide(rookFrom, rookTo);
    }
    if (result.captured) ghost(result.capturedAt, result.captured, reducedMotion.matches ? 0 : duration * 0.55);
    const to = squares[result.to];
    to.classList.remove('is-promoted');
    if (result.promotion) {
        void to.offsetWidth;
        to.style.setProperty('--promo-delay', `${duration}ms`);
        to.classList.add('is-promoted');
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
    selected = i;
    render();
    const moves = game.movesFrom(i);
    // 升變的四種走法算成一個落點
    const targets = [...new Set(moves.map((m) => m.to))].map((to) => {
        const m = moves.find((x) => x.to === to);
        return m.castle
            ? `${squareName(to)} (castle)`
            : `${squareName(to)}${m.captured ? ` (takes ${PIECE_NAMES[typeOf(m.captured)]})` : ''}`;
    });
    announce(`${pieceName(game.board[i])} on ${squareName(i)} selected. Moves: ${list(targets)}.`);
}

function deselect(speak = true) {
    if (selected < 0) return;
    selected = -1;
    render();
    if (speak) announce('Selection cleared.');
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
    if (!humanCanPlay()) return;
    if (selected >= 0) {
        const move = game.movesFrom(selected).find((m) => m.to === i);
        if (move) {
            if (move.promotion) return openPromotion(selected, i, dragged);
            return commit({ from: selected, to: i }, { dragged });
        }
    }
    const piece = game.board[i];
    if (sideOf(piece) === game.turn) {
        // 再點一次選取中的子：取消選取
        if (selected === i) return deselect();
        if (game.movable().includes(i)) return select(i);
        selected = -1;
        render();
        if (game.check >= 0) return reject(i, `Your king is in check. ${squareName(i)} can’t help.`);
        return reject(i, `${pieceName(piece)} on ${squareName(i)} has no legal moves.`);
    }
    if (selected >= 0) return deselect();
    if (piece) return reject(i, `${squareName(i)}, ${pieceName(piece)}. Select one of your own pieces.`);
    announce(`${squareName(i)} is empty. Select one of your pieces first.`);
}

// ---------- 升變：在落點那一行由盤邊往內排出后、車、象、馬 ----------

function openPromotion(from, to, dragged) {
    promotion = { from, to, dragged };
    const side = game.turn;
    const view = toView(to);
    const row = Math.floor(view / N);
    const col = view % N;
    promoList.className = `promo__list is-${side}`;
    promoList.style.left = `${col * 12.5}%`;
    promoList.style.top = row === 0 ? '0' : '';
    promoList.style.bottom = row === 0 ? '' : '0';
    // 盤邊那一格放后：落點在上方時由上往下排，在下方時由下往上排
    const order = row === 0 ? PROMOTIONS : [...PROMOTIONS].reverse();
    promoList.replaceChildren(
        ...order.map((type) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'promo__btn';
            button.dataset.promote = type;
            button.setAttribute('aria-label', `Promote to ${PIECE_NAMES[type]}`);
            button.title = `${PIECE_NAMES[type][0].toUpperCase()}${PIECE_NAMES[type].slice(1)} (${type.toUpperCase()})`;
            const svg = pieceSvg('');
            setPieceType(svg, type);
            button.append(svg);
            return button;
        })
    );
    promoEl.hidden = false;
    render();
    promoList.querySelector('[data-promote="q"]').focus({ preventScroll: true });
    announce(`Promote to which piece? Queen, rook, bishop or knight. Escape to cancel.`);
}

function closePromotion(refocus = true) {
    if (!promotion) return;
    promotion = null;
    promoEl.hidden = true;
    if (game) render();
    if (refocus) focusCursor();
}

function choosePromotion(type) {
    if (!promotion) return;
    const { from, to, dragged } = promotion;
    closePromotion(false);
    moveCursor(to, true);
    commit({ from, to, promotion: type }, { dragged });
}

function undo() {
    if (state !== 'playing' || game.status !== 'playing') return;
    clearTimeout(thinkTimer);
    endDrag();
    closePromotion(false);
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
        detail = `White ${duoTally.w} · Draws ${duoTally.draw} · Black ${duoTally.b}`;
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
            // 卡片放在不擋住被將死的王的一側（王在畫面下半部就把卡片放上面）
            const king = game.check >= 0 ? Math.floor(toView(game.check) / N) : 0;
            overlays.over.classList.toggle('is-top', king >= N / 2);
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
    const el = event.target.closest('.cell');
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
    const el = event.target.closest('.cell');
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
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.cell');
    if (!target) return;
    const i = Number(target.dataset.i);
    // 放在可以走到的格子才算數，否則棋子回到原位、保持選取
    if (selected >= 0 && game.movesFrom(selected).some((m) => m.to === i)) {
        moveCursor(i, false);
        activate(i, { dragged: true });
    }
});

cellsEl.addEventListener('pointercancel', endDrag);

// ---------- 鍵盤：方向鍵移動游標，Space / Enter 交給按鈕本身的 click ----------

function moveCursor(next, focus = true) {
    squares[cursor].tabIndex = -1;
    cursor = next;
    squares[cursor].tabIndex = 0;
    if (focus) squares[cursor].focus({ preventScroll: true });
}

function focusCursor() {
    squares[cursor].focus({ preventScroll: true });
}

// 在畫面上的位置移動
function stepCursor(key) {
    const view = toView(cursor);
    let row = Math.floor(view / N);
    let col = view % N;
    if (key === 'ArrowLeft') col = Math.max(0, col - 1);
    else if (key === 'ArrowRight') col = Math.min(N - 1, col + 1);
    else if (key === 'ArrowUp') row = Math.max(0, row - 1);
    else if (key === 'ArrowDown') row = Math.min(N - 1, row + 1);
    else if (key === 'Home') col = 0;
    else if (key === 'End') col = N - 1;
    moveCursor(fromView(row, col));
}

// 升變選擇中的按鍵：上下移動、字母直接選、Esc 取消
function promotionKey(event, key) {
    const buttons = [...promoList.querySelectorAll('.promo__btn')];
    const index = buttons.indexOf(document.activeElement);
    if (key === 'Escape') {
        closePromotion();
        announce('Promotion cancelled.');
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab'].includes(key)) {
        event.preventDefault();
        let next = index < 0 ? 0 : index;
        if (key === 'Home') next = 0;
        else if (key === 'End') next = buttons.length - 1;
        else if (key === 'ArrowUp' || key === 'ArrowLeft' || (key === 'Tab' && event.shiftKey)) next -= 1;
        else next += 1;
        buttons[(next + buttons.length) % buttons.length].focus();
    } else if (PROMOTIONS.includes(key) && !event.repeat) {
        choosePromotion(key);
    }
}

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing' && promotion) {
        promotionKey(event, key);
        return;
    }
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
    const promoButton = event.target.closest('.promo__btn');
    if (promoButton) {
        choosePromotion(promoButton.dataset.promote);
        return;
    }
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
        case 'promo-cancel':
            closePromotion();
            announce('Promotion cancelled.');
            break;
    }
});

$('undo-btn').addEventListener('click', undo);
$('new-btn').addEventListener('click', () => requestNewGame());
addEventListener('pagehide', save);

// ---------- 啟動：有進行中的局面就直接接著玩，否則顯示開始畫面與示意盤面 ----------

// 示意盤面：雙馬防禦，黑剛走 d7-d5，白的 c4 象選取中（可以吃 d5）
const DEMO = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'f3g5', 'd7d5'];

function showDemo() {
    clearTimers();
    closePromotion(false);
    game = createChess({ state: { moves: DEMO } });
    human = nextHuman;
    setState('ready');
    layoutBoard();
    selected = 34;
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
    moveCursor(bottom === 'w' ? 52 : 12, false);
    render();
    renderHud();
    announce(`${OPPONENT_NAMES[opponent]}, game in progress. ${turnPrompt()}`.trim());
    scheduleCpu();
} else {
    showDemo();
}
