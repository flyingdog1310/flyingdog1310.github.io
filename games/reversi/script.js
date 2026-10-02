// 黑白棋：畫面與操作。遊戲規則與電腦對手在 core.js
import { LEVELS, N, SIZE, cellName, chooseMove, createReversi, indexOf, other } from './core.js';
import { highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 電腦「想一下」再下，也讓玩家看完上一步的翻面（實際計算時間另外算，hard 最多二十幾毫秒）
const THINK_MS = [450, 750];
// 翻面動畫：每往外一格延後一點，從下的那一格往外翻
const FLIP_STAGGER_MS = 70;
// 最後一步翻完之後再顯示結果
const RESULT_DELAY_MS = 1300;
// 「Pass」提示停留的時間
const PASS_CHIP_MS = 1600;

const SAVE_KEY = 'jsgames:reversi:game';
const OPPONENT_KEY = 'jsgames:reversi:opponent';
const SIDE_KEY = 'jsgames:reversi:side';
const STATS_KEY = 'jsgames:reversi:stats';

// 對手：電腦的三種難度，或兩人同一台裝置輪流下
const OPPONENTS = [...LEVELS, 'duo'];
const OPPONENT_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', duo: '2 players' };
const NAME = { B: 'Black', W: 'White' };
const COLOR = { B: 'black', W: 'white' };

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.reversi');
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
const bests = Object.fromEntries(LEVELS.map((level) => [level, highScore(`reversi:${level}`)]));

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
let cursor = indexOf(2, 3);
// 預覽的格子（滑鼠滑過或鍵盤聚焦的合法步）
let preview = -1;
// 剛剛被跳過的一方（顯示在提示文字裡，直到下一步）
let passed = null;
let overAt = 0;
let thinkTimer = 0;
let resultTimer = 0;
let chipTimer = 0;

const vsCpu = () => opponent !== 'duo';
const cpu = () => other(human);
const isCpuTurn = () => vsCpu() && game.status === 'playing' && game.turn === cpu();
const humanCanPlay = () => state === 'playing' && game.status === 'playing' && !isCpuTurn();
const who = (mark) => (vsCpu() ? (mark === human ? 'You' : 'Computer') : NAME[mark]);

// 朗讀「輪到誰」；輪到電腦時不唸，等它下完再一起唸
function turnPrompt() {
    if (game.status !== 'playing' || isCpuTurn()) return '';
    const count = game.moves.length;
    const options = `${count} ${count === 1 ? 'move' : 'moves'} available.`;
    return vsCpu() ? `Your turn, ${options}` : `${NAME[game.turn]} to move, ${options}`;
}

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
        const restored = createReversi({ state: saved.game });
        if (restored.status !== 'playing' || restored.history.length === 0) return null;
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

function buildBoard() {
    cells = Array.from({ length: SIZE }, (_, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell';
        button.dataset.i = i;
        button.tabIndex = i === cursor ? 0 : -1;
        // 結束時贏的一方的棋子由左上往右下依序跳一下
        button.style.setProperty('--wave', `${(Math.floor(i / N) + (i % N)) * 35}ms`);
        const disc = document.createElement('span');
        disc.className = 'disc';
        button.append(disc);
        return button;
    });
    cellsEl.replaceChildren(...cells);

    // 盤邊的座標：上方 A–H、左邊 1–8
    const label = (text) => Object.assign(document.createElement('span'), { textContent: text });
    $('coords-cols').replaceChildren(...[...'ABCDEFGH'].map(label));
    $('coords-rows').replaceChildren(...Array.from({ length: N }, (_, r) => label(r + 1)));
}

// 這一局現在可以點的合法步（輪到電腦、結束、開始畫面之外）；開始畫面的示意盤面也顯示
const hintsOn = () => game.status === 'playing' && (state === 'ready' || humanCanPlay());

function cellLabel(i, last, legal) {
    const mark = game.board[i];
    const parts = [cellName(i)];
    if (mark) parts.push(`${COLOR[mark]} disc`);
    else if (legal) {
        const n = game.flipsOf(i).length;
        parts.push(`empty, legal move, flips ${n}`);
    } else parts.push('empty');
    if (i === last) parts.push('last move');
    return parts.join(', ');
}

// 依 game.board 重畫所有棋子；move 是剛下的一步（{ index, flips }），翻面依距離由近到遠播放
function renderBoard(move = null) {
    const last = game.lastIndex();
    const legal = new Set(hintsOn() ? game.moves.map((m) => m.index) : []);
    const flipped = new Map();
    if (move && !reducedMotion.matches) {
        const r0 = Math.floor(move.index / N);
        const c0 = move.index % N;
        for (const i of move.flips) {
            const dist = Math.max(Math.abs(Math.floor(i / N) - r0), Math.abs((i % N) - c0));
            flipped.set(i, dist);
        }
    }
    cells.forEach((el, i) => {
        const mark = game.board[i];
        if ((el.dataset.mark ?? null) !== mark) {
            if (mark) el.dataset.mark = mark;
            else delete el.dataset.mark;
        }
        el.classList.toggle('is-new', move?.index === i);
        const flip = flipped.get(i);
        // 重新觸發動畫：先移除 class、強制 reflow 再加回去
        if (el.classList.contains('is-flip')) el.classList.remove('is-flip');
        if (flip !== undefined) {
            void el.offsetWidth;
            el.style.setProperty('--flip-delay', `${80 + (flip - 1) * FLIP_STAGGER_MS}ms`);
            el.classList.add('is-flip');
        }
        el.classList.toggle('is-last', i === last);
        el.classList.toggle('is-legal', legal.has(i));
        el.setAttribute('aria-label', cellLabel(i, last, legal.has(i)));
        el.setAttribute('aria-disabled', String(!legal.has(i)));
    });
    root.dataset.result = game.status === 'over' ? (game.winner ?? 'draw') : '';
    root.dataset.turn = game.status === 'playing' ? game.turn : '';
    renderPreview();
}

// 預覽：合法步顯示半透明的棋子與會翻幾子，會被翻的棋子加上外框
function renderPreview() {
    const active = preview >= 0 && humanCanPlay() && game.isLegal(preview) ? preview : -1;
    const flips = new Set(active >= 0 ? game.flipsOf(active) : []);
    cells.forEach((el, i) => {
        el.classList.toggle('is-preview', i === active);
        el.classList.toggle('is-target', flips.has(i));
    });
    if (active >= 0) cells[active].firstChild.dataset.gain = flips.size;
    renderInfo();
}

function setPreview(i) {
    preview = i;
    renderPreview();
}

// ---------- 分數列與提示文字 ----------

function renderHud() {
    root.dataset.mode = vsCpu() ? 'cpu' : 'duo';
    root.dataset.turn = game.status === 'playing' ? game.turn : '';
    // 玩家現在可以下棋（給預覽與游標樣式用）
    root.dataset.input = humanCanPlay() ? 'on' : 'off';
    const sideA = vsCpu() ? human : 'B';
    const sideB = other(sideA);
    const score = game.score();
    $('side-a').dataset.mark = sideA;
    $('side-b').dataset.mark = sideB;
    $('name-a').textContent = vsCpu() ? 'You' : 'Black';
    $('name-b').textContent = vsCpu() ? 'Computer' : 'White';
    $('count-a').textContent = score[sideA];
    $('count-b').textContent = score[sideB];
    let wins;
    if (vsCpu()) {
        const stats = statsOf(opponent);
        wins = [stats.win, stats.loss, stats.draw];
    } else {
        wins = [duoTally.B, duoTally.W, duoTally.draw];
    }
    const winsText = (n) => `${n} ${n === 1 ? 'win' : 'wins'}`;
    $('wins-a').textContent = `· ${winsText(wins[0])}`;
    $('wins-b').textContent = `· ${winsText(wins[1])}`;
    $('draws').textContent = wins[2];
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(button.dataset.opponent === opponent));
    }
    const humanMoves = vsCpu() ? game.history.filter((m) => m.mark === human).length : game.history.length;
    $('undo-btn').disabled = !(state === 'playing' && game.status === 'playing' && humanMoves > 0);
    renderPreview();
}

function renderInfo() {
    const turn = $('turn');
    let text = '';
    if (state === 'playing' && game.status === 'playing') {
        const passText = passed ? `${who(passed)} ${passed === human && vsCpu() ? 'have' : 'has'} no moves · ` : '';
        const active = preview >= 0 && humanCanPlay() && game.isLegal(preview) ? preview : -1;
        if (active >= 0) {
            const n = game.flipsOf(active).length;
            text = `${cellName(active)} flips ${n} ${n === 1 ? 'disc' : 'discs'}`;
        } else if (vsCpu()) text = passText + (game.turn === human ? 'Your turn' : 'Computer is thinking…');
        else text = `${passText}${NAME[game.turn]} to move`;
    }
    turn.textContent = text;
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

// 盤面上方短暫顯示「White passes」
function showPassChip(mark) {
    const chip = $('pass-chip');
    chip.textContent = vsCpu() ? (mark === human ? 'You pass' : 'Computer passes') : `${NAME[mark]} passes`;
    chip.classList.remove('is-on');
    void chip.offsetWidth;
    chip.classList.add('is-on');
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => chip.classList.remove('is-on'), PASS_CHIP_MS);
}

function hidePassChip() {
    clearTimeout(chipTimer);
    $('pass-chip').classList.remove('is-on');
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
    hidePassChip();
}

function startAnnouncement() {
    if (!vsCpu()) return 'Black goes first.';
    return human === 'B' ? 'You play black and go first.' : 'You play white. Computer goes first.';
}

function newGame(nextOpponent = opponent) {
    clearTimers();
    opponent = nextOpponent;
    writeStorage(OPPONENT_KEY, opponent);
    game = createReversi();
    if (vsCpu()) {
        // 對電腦時黑白輪流執
        human = nextHuman;
        nextHuman = other(human);
        writeStorage(SIDE_KEY, nextHuman);
    }
    assisted = false;
    passed = null;
    preview = -1;
    setState('playing');
    renderBoard();
    renderHud();
    save();
    focusCursor();
    announce(`${OPPONENT_NAMES[opponent]}. ${startAnnouncement()} ${turnPrompt()}`.trim());
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
    if (state === 'playing' && game.status === 'playing' && game.history.length > 0) {
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
    const delay = game.history.length === 0 ? min : min + Math.random() * (max - min);
    thinkTimer = setTimeout(() => {
        if (state !== 'playing' || !isCpuTurn()) return;
        const index = chooseMove(game.board, cpu(), opponent);
        place(index);
    }, delay);
}

// 下一步並更新畫面、朗讀這一步
function place(index) {
    const result = game.play(index);
    if (!result) return;
    navigator.vibrate?.(8);
    preview = -1;
    passed = result.passed ?? null;
    hidePassChip();
    renderBoard(result);
    renderHud();
    save();

    const n = result.flips.length;
    const verb = vsCpu() && result.mark === human ? 'play' : 'plays';
    const score = game.score();
    const parts = [
        `${who(result.mark)} ${verb} ${cellName(index)}, flipping ${n}.`,
        `Black ${score.B}, white ${score.W}.`,
    ];
    if (result.over) {
        finish(parts.join(' '));
        return;
    }
    if (passed) {
        showPassChip(passed);
        const subject = who(passed);
        parts.push(`${subject} ${vsCpu() && passed === human ? 'have no moves and pass' : 'has no moves and passes'}.`);
    }
    parts.push(turnPrompt());
    announce(parts.filter(Boolean).join(' '));
    scheduleCpu();
}

function reject(i) {
    // 不是合法步：輕輕搖一下
    const el = cells[i];
    el.classList.remove('is-rejected');
    void el.offsetWidth;
    el.classList.add('is-rejected');
    announce(game.board[i] ? `${cellName(i)} is taken.` : `${cellName(i)} doesn’t flip anything.`);
}

function play(i) {
    if (!humanCanPlay()) return;
    if (!game.isLegal(i)) {
        reject(i);
        return;
    }
    place(i);
}

function undo() {
    if (state !== 'playing' || game.status !== 'playing') return;
    clearTimeout(thinkTimer);
    let removed = 0;
    if (vsCpu()) {
        // 收回到玩家上一次下的那一步之前：連同之後電腦的回應（可能好幾步，玩家被 pass 時）一起收回
        if (!game.history.some((m) => m.mark === human)) return scheduleCpu();
        let last;
        do {
            last = game.undo();
            removed += 1;
        } while (last.mark !== human);
        assisted = true;
    } else if (game.undo()) {
        removed = 1;
    }
    if (!removed) return;
    preview = -1;
    passed = null;
    hidePassChip();
    renderBoard();
    renderHud();
    save();
    announce(`Took back ${removed === 1 ? 'one move' : `${removed} moves`}. ${turnPrompt()}`);
}

function finish(prefix) {
    clearTimeout(thinkTimer);
    const winner = game.winner;
    const score = game.score();
    const title = winner
        ? vsCpu()
            ? winner === human
                ? 'You win'
                : 'Computer wins'
            : `${NAME[winner]} wins`
        : 'Draw';
    const high = Math.max(score.B, score.W);
    const low = Math.min(score.B, score.W);
    let spoken = winner ? `No more moves. ${title}, ${high} to ${low}.` : `No more moves. Draw, ${high} each.`;

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
        detail = `Black ${duoTally.B} · Draws ${duoTally.draw} · White ${duoTally.W}`;
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
            // 結果卡片上的比分：對電腦時玩家在左，兩人對戰時黑在左
            const left = vsCpu() ? human : 'B';
            const scoreEl = $('over-score');
            scoreEl.replaceChildren(
                ...[left, null, other(left)].map((mark) => {
                    const span = document.createElement('span');
                    if (!mark) {
                        span.className = 'final-score__dash';
                        span.textContent = '–';
                    } else {
                        span.className = 'final-score__side';
                        span.dataset.mark = mark;
                        span.textContent = score[mark];
                    }
                    return span;
                })
            );
            scoreEl.setAttribute('aria-label', `Black ${score.B}, white ${score.W}`);
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
        reducedMotion.matches ? 600 : RESULT_DELAY_MS
    );
}

// ---------- 操作 ----------

// 格子夠大（手機上約 44px），點一下就下；滑鼠滑過與鍵盤聚焦時預覽
cellsEl.addEventListener('click', (event) => {
    const el = event.target.closest('.cell');
    if (!el) return;
    const i = Number(el.dataset.i);
    moveCursor(i, false);
    play(i);
});

cellsEl.addEventListener('pointerover', (event) => {
    const el = event.target.closest('.cell');
    if (el && event.pointerType === 'mouse') setPreview(Number(el.dataset.i));
});
cellsEl.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') setPreview(-1);
});
// 鍵盤聚焦時預覽游標所在的格子
cellsEl.addEventListener('focusin', (event) => {
    const i = Number(event.target.closest('.cell')?.dataset.i);
    if (Number.isNaN(i)) return;
    if (i !== cursor) moveCursor(i, false);
    if (event.target.matches(':focus-visible')) setPreview(i);
});
cellsEl.addEventListener('focusout', (event) => {
    if (!cellsEl.contains(event.relatedTarget)) setPreview(-1);
});

function moveCursor(next, focus = true) {
    cells[cursor].tabIndex = -1;
    cursor = next;
    cells[cursor].tabIndex = 0;
    if (focus) {
        cells[cursor].focus({ preventScroll: true });
        setPreview(cursor);
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
            moveCursor(indexOf(r, c));
        } else if (key === 'Home' || key === 'End') {
            event.preventDefault();
            moveCursor(indexOf(Math.floor(cursor / N), key === 'Home' ? 0 : N - 1));
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

// 示意盤面：中盤、輪到白，盤上標出白的合法步
const DEMO = { moves: [37, 29, 21, 45, 44, 13, 46, 53, 38, 42, 5, 47, 61, 39, 30, 52, 43, 23, 31, 20, 51, 22, 18] };

function showDemo() {
    clearTimers();
    game = createReversi({ state: DEMO });
    human = nextHuman;
    passed = null;
    setState('ready');
    renderBoard();
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
    renderBoard();
    renderHud();
    announce(`${OPPONENT_NAMES[opponent]}, game in progress. ${turnPrompt()}`.trim());
    scheduleCpu();
} else {
    showDemo();
}
