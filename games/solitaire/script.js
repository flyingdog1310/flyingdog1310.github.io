// 接龍（Klondike）：畫面與操作。遊戲規則在 core.js
//
// 52 張牌各是一個常駐的 <button>，位置用 transform 決定；換位置時 CSS transition 自然滑過去，翻牌是內層的 rotateY
// 滑鼠 / 觸控：點一下牌自動放到最好的位置（能收就收），想放別的地方就拖曳；雙擊的第二下會被忽略
// 鍵盤：方向鍵在各堆之間移動，Space / Enter 拿起、到目標再按一次放下（在原地再按一次則自動放）
import {
    COLUMNS,
    DRAW_MODES,
    FOUNDATIONS,
    RANKS,
    cardName,
    createSolitaire,
    isColumn,
    isFoundation,
    isRed,
    rankOf,
    suitOf,
} from './core.js';
import { autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 牌滑動的時間（與 style.css 的 --move-ms 相同）
const MOVE_MS = 240;
// 發牌時每張牌間隔多久
const DEAL_STEP_MS = 40;
// 自動完成時每收一張的間隔
const AUTO_STEP_MS = 110;
// 贏了之後牌一張張飛散的間隔，以及飛完多久顯示結果
const CELEBRATE_STEP_MS = 35;
const CELEBRATE_MS = 900;
// 按住移動超過這個距離才算拖曳（否則是點一下）
const DRAG_PX = 6;
// 雙擊的第二下在這段時間內不再動作（習慣雙擊收牌的人，第一下就已經收了）
const DOUBLE_MS = 350;
// 牌的長寬比與最大寬度
const RATIO = 1.4;
const MAX_W = 100;
// 牌桌一列的間距（牌高的比例）：翻開的牌最少要露出點數那一條，蓋著的牌最少露一小條
const MIN_UP = 0.22;
const MIN_DOWN = 0.045;
// 高度大約要放得下幾張牌高：上排 + 間隔 + 一張牌 + 6 × MIN_DOWN + 12 × MIN_UP
const HEIGHT_IN_CARDS = 5;

const SAVE_KEY = 'jsgames:solitaire:game';
const DRAW_KEY = 'jsgames:solitaire:draw';
const STATS_KEY = 'jsgames:solitaire:stats';

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.solitaire');
const tableArea = $('table-area');
const tableEl = $('table');
const finishBtn = $('finish-btn');
const statusText = $('status');
const overlays = {
    ready: $('overlay-ready'),
    paused: $('overlay-paused'),
    won: $('overlay-won'),
    confirm: $('overlay-confirm'),
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- 存檔與紀錄 ----------

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

// 各翻牌模式分開記錄：最快時間（秒）與最少步數用 highScore，玩過 / 贏過幾局存在 stats
const bestTime = Object.fromEntries(DRAW_MODES.map((n) => [n, highScore(`solitaire:draw${n}`, { order: 'asc' })]));
const bestMoves = Object.fromEntries(
    DRAW_MODES.map((n) => [n, highScore(`solitaire:draw${n}:moves`, { order: 'asc' })])
);
const allStats = readJSON(STATS_KEY) ?? {};
const statsOf = (n) => ({ played: 0, won: 0, ...allStats[`draw${n}`] });

function bumpStat(n, field) {
    const stats = statsOf(n);
    stats[field] += 1;
    stats.played = Math.max(stats.played, stats.won);
    allStats[`draw${n}`] = stats;
    writeStorage(STATS_KEY, JSON.stringify(allStats));
}

// ---------- 狀態 ----------

let state = 'ready';
let drawMode = DRAW_MODES.includes(Number(readStorage(DRAW_KEY))) ? Number(readStorage(DRAW_KEY)) : 1;
let pendingDraw = null;
let game = null;
// 這局是否已經算進「玩過」（第一個動作時才算）
let counted = false;
// 發牌、自動完成、勝利動畫進行中不接受操作
let busy = false;
// 鍵盤拿起的牌：{ from, count }
let held = null;
// 鍵盤游標：哪一堆、第幾張（只有牌桌的列會指到中間的牌）
let cursor = { pile: 't0', index: 0 };
let overAt = 0;
let lastMoveAt = 0;
let autoTimer = 0;
let resultTimer = 0;
let busyTimer = 0;

// 計時：累積的毫秒 + 目前這段開始的時間（暫停時不計）
let elapsed = 0;
let runningSince = null;
let tick = 0;

// 最近一次操作是鍵盤還是滑鼠 / 觸控：用滑鼠或觸控開始時不要把焦點框畫在牌上
let keyboardUser = false;
addEventListener('keydown', () => (keyboardUser = true), true);
addEventListener('pointerdown', () => (keyboardUser = false), true);

function focusTable() {
    if (keyboardUser) cursorEl().focus({ preventScroll: true });
    else if (overlays[state]?.contains(document.activeElement)) document.activeElement.blur();
}

const canPlay = () => state === 'playing' && !busy && game.status === 'playing';

// ---------- 計時 ----------

const currentSeconds = () => (elapsed + (runningSince === null ? 0 : performance.now() - runningSince)) / 1000;

function formatTime(seconds) {
    const s = Math.floor(seconds);
    const mm = String(Math.floor((s % 3600) / 60));
    const ss = String(s % 60).padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function startClock() {
    if (runningSince !== null || state !== 'playing') return;
    runningSince = performance.now();
    tick = setInterval(renderTime, 250);
}

function stopClock() {
    if (runningSince === null) return;
    elapsed += performance.now() - runningSince;
    runningSince = null;
    clearInterval(tick);
}

function resetClock(seconds = 0) {
    stopClock();
    elapsed = seconds * 1000;
    renderTime();
}

function renderTime() {
    $('time').textContent = formatTime(currentSeconds());
}

// ---------- 牌與空位的元素 ----------

const cardEls = [];
const slotEls = {};
const PILE_IDS = ['stock', 'waste', ...FOUNDATIONS, ...COLUMNS];

function suitSvg(card, className) {
    return `<svg class="${className}" aria-hidden="true"><use href="#suit-${suitOf(card)}" /></svg>`;
}

function buildCard(card) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'card';
    el.dataset.card = card;
    el.dataset.color = isRed(card) ? 'red' : 'black';
    el.tabIndex = -1;
    const rank = rankOf(card);
    const letter = RANKS[rank - 1];
    // 中間：A 是大花色、J Q K 是框起來的字母、數字牌是中等大小的花色
    const center =
        rank > 10
            ? `<span class="card__art"><span class="card__letter">${letter}</span>${suitSvg(card, 'card__art-suit')}</span>`
            : suitSvg(card, rank === 1 ? 'card__pip card__pip--ace' : 'card__pip');
    el.innerHTML =
        '<span class="card__inner">' +
        `<span class="card__face card__front"><span class="card__rank">${letter}</span>${suitSvg(card, 'card__mini')}${center}</span>` +
        '<span class="card__face card__back"></span>' +
        '</span>';
    return el;
}

function buildTable() {
    for (const id of PILE_IDS) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'slot';
        el.dataset.pile = id;
        el.tabIndex = -1;
        if (id === 'stock') el.innerHTML = '<svg aria-hidden="true"><use href="#i-recycle" /></svg>';
        else if (isFoundation(id)) el.innerHTML = '<span class="slot__mark">A</span>';
        else if (isColumn(id)) el.innerHTML = '<span class="slot__mark">K</span>';
        slotEls[id] = el;
    }
    for (let card = 0; card < 52; card++) cardEls[card] = buildCard(card);
    tableEl.replaceChildren(...Object.values(slotEls), ...cardEls);
}

// ---------- 版面：牌的大小與每張牌的位置 ----------

let geo = null;

// 依可用空間決定牌的大小：7 列要放得下；高度要放得下上排 + 最深的一列（6 張蓋著 + 12 張翻開，壓到最緊時）
function measure() {
    const style = getComputedStyle(tableArea);
    const width = tableArea.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = tableArea.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const gx = Math.max(3, Math.min(14, Math.round(width * 0.012)));
    const byWidth = (width - 6 * gx) / 7;
    const byHeight = height / (RATIO * HEIGHT_IN_CARDS);
    const w = Math.max(24, Math.floor(Math.min(MAX_W, byWidth, byHeight)));
    const h = Math.round(w * RATIO);
    const gy = Math.max(8, Math.round(h * 0.16));
    geo = { w, h, gx, gy, width: 7 * w + 6 * gx, height, colTop: h + gy };
    tableEl.style.width = `${geo.width}px`;
    tableEl.style.height = `${height}px`;
    tableEl.style.setProperty('--w', `${w}px`);
    tableEl.style.setProperty('--h', `${h}px`);
    root.style.setProperty('--table-w', `${geo.width}px`);
}

const colX = (c) => c * (geo.w + geo.gx);

// 牌桌一列的間距：翻開的牌露出點數那一條，蓋著的牌露一小條；放不下時依序壓縮
function columnSpacing(id) {
    const i = COLUMNS.indexOf(id);
    const n = game.pile(id).length;
    const downs = game.hidden[i];
    const ups = Math.max(0, n - downs - 1);
    const avail = geo.height - geo.colTop - geo.h - 4;
    let down = geo.h * 0.11;
    let up = geo.h * 0.3;
    if (downs * down + ups * up > avail && ups > 0) up = Math.max(geo.h * MIN_UP, (avail - downs * down) / ups);
    if (downs * down + ups * up > avail && downs > 0) down = Math.max(geo.h * MIN_DOWN, (avail - ups * up) / downs);
    const need = downs * down + ups * up;
    if (need > avail && need > 0) {
        const scale = Math.max(0, avail) / need;
        up *= scale;
        down *= scale;
    }
    return { down, up };
}

const PILE_LABEL = (id) =>
    id === 'stock'
        ? 'stock'
        : id === 'waste'
          ? 'waste'
          : isFoundation(id)
            ? `foundation ${Number(id[1]) + 1}`
            : `column ${Number(id[1]) + 1}`;

// 每張牌的位置、層次、正反面與朗讀文字
function layoutCards() {
    const out = new Map();
    const stock = game.pile('stock');
    stock.forEach((card, i) => {
        const last = i === stock.length - 1;
        out.set(card, {
            pile: 'stock',
            index: i,
            x: colX(0),
            y: 0,
            z: 1 + i,
            up: false,
            label: last ? `Stock, ${stock.length} ${stock.length === 1 ? 'card' : 'cards'}. Draw` : null,
        });
    });
    const waste = game.pile('waste');
    const fan = game.drawCount === 3 ? Math.min(3, waste.length) : 1;
    const fanDx = geo.w * 0.3;
    waste.forEach((card, i) => {
        const slot = Math.max(0, i - (waste.length - fan));
        const last = i === waste.length - 1;
        out.set(card, {
            pile: 'waste',
            index: i,
            x: colX(1) + slot * fanDx,
            y: 0,
            z: 1 + i,
            up: true,
            label: last ? `${cardName(card)}, waste` : null,
        });
    });
    FOUNDATIONS.forEach((id, f) => {
        const pile = game.pile(id);
        pile.forEach((card, i) => {
            out.set(card, {
                pile: id,
                index: i,
                x: colX(3 + f),
                y: 0,
                z: 1 + i,
                up: true,
                label: i === pile.length - 1 ? `${cardName(card)}, ${PILE_LABEL(id)}` : null,
            });
        });
    });
    COLUMNS.forEach((id, c) => {
        const pile = game.pile(id);
        const hidden = game.hidden[c];
        const { down, up } = columnSpacing(id);
        let y = geo.colTop;
        pile.forEach((card, i) => {
            const faceUp = i >= hidden;
            const place = `column ${c + 1}`;
            out.set(card, {
                pile: id,
                index: i,
                x: colX(c),
                y,
                z: 10 + i,
                up: faceUp,
                label: faceUp ? `${cardName(card)}, ${place}` : `Face-down card, ${place}`,
            });
            y += faceUp ? up : down;
        });
    });
    return out;
}

let positions = new Map();

function slotPosition(id) {
    if (id === 'stock') return [colX(0), 0];
    if (id === 'waste') return [colX(1), 0];
    if (isFoundation(id)) return [colX(3 + Number(id[1])), 0];
    return [colX(Number(id[1])), geo.colTop];
}

function setTransform(el, x, y, extra = '') {
    el.style.transform = `translate(${x}px, ${y}px)${extra}`;
}

// 牌移動時暫時放到最上層，落定後恢復
function fly(el, z) {
    clearTimeout(el._flyTimer);
    el._z = z;
    el._flying = true;
    el.style.zIndex = 500 + z;
    el._flyTimer = setTimeout(
        () => {
            el._flying = false;
            el.style.zIndex = el._z;
        },
        MOVE_MS + (parseFloat(el.style.getPropertyValue('--delay')) || 0) + 40
    );
}

// 依目前的局面擺好每張牌；animate 為 false 時直接跳到位置（調整視窗大小、讀檔）
function render({ animate = true } = {}) {
    if (!geo) return;
    const hadFocus = tableEl.contains(document.activeElement);
    if (!animate) tableEl.classList.add('is-still');
    positions = layoutCards();
    for (const [card, p] of positions) {
        const el = cardEls[card];
        const prev = el._pos;
        const moved = !prev || prev.x !== p.x || prev.y !== p.y;
        setTransform(el, p.x, p.y);
        el._pos = { x: p.x, y: p.y };
        el._z = p.z;
        if (animate && moved && prev) fly(el, p.z);
        else if (!el._flying) el.style.zIndex = p.z;
        el.classList.toggle('is-up', p.up);
        if (p.label) {
            el.setAttribute('aria-label', p.label);
            el.removeAttribute('aria-hidden');
        } else {
            el.removeAttribute('aria-label');
            el.setAttribute('aria-hidden', 'true');
        }
        el.tabIndex = -1;
    }
    for (const id of PILE_IDS) {
        const el = slotEls[id];
        const [x, y] = slotPosition(id);
        setTransform(el, x, y);
        el.tabIndex = -1;
        const empty = game.pile(id).length === 0;
        el.toggleAttribute('aria-hidden', !empty);
        el.setAttribute('aria-label', slotLabel(id));
    }
    slotEls.stock.dataset.recycle = String(game.pile('waste').length > 0);
    renderMarks();
    syncCursor();
    if (hadFocus) cursorEl().focus({ preventScroll: true });
    if (!animate) {
        void tableEl.offsetWidth;
        tableEl.classList.remove('is-still');
    }
    renderHud();
}

function slotLabel(id) {
    if (id === 'stock') return game.pile('waste').length ? 'Stock empty. Turn the waste over' : 'Stock empty';
    if (id === 'waste') return 'Waste, empty';
    if (isFoundation(id)) return `Foundation ${Number(id[1]) + 1}, empty`;
    return `Column ${Number(id[1]) + 1}, empty`;
}

// 鍵盤拿起的牌與可以放的位置
function renderMarks() {
    for (const el of tableEl.querySelectorAll('.is-held, .is-target')) el.classList.remove('is-held', 'is-target');
    if (!held) return;
    const pile = game.pile(held.from);
    for (const card of pile.slice(pile.length - held.count)) cardEls[card].classList.add('is-held');
    for (const to of game.targets(held.from, held.count)) {
        const el = topEl(to);
        el.classList.add('is-target');
        const label = el.getAttribute('aria-label');
        if (label) el.setAttribute('aria-label', `${label}, place here`);
    }
}

// 一堆最上面的元素：有牌是最上面那張，沒牌是空位
function topEl(id) {
    const card = game.top(id);
    return card === undefined ? slotEls[id] : cardEls[card];
}

// ---------- 鍵盤游標（roving tabindex） ----------

// 上排的順序與對應的欄位
const TOP_ROW = ['stock', 'waste', ...FOUNDATIONS];
const TOP_COL = { stock: 0, waste: 1, f0: 3, f1: 4, f2: 5, f3: 6 };
const ABOVE = ['stock', 'waste', 'waste', 'f0', 'f1', 'f2', 'f3'];

function syncCursor() {
    const pile = game.pile(cursor.pile);
    if (isColumn(cursor.pile)) {
        const first = game.hidden[COLUMNS.indexOf(cursor.pile)];
        if (pile.length === 0) cursor.index = 0;
        else cursor.index = Math.min(pile.length - 1, Math.max(first, cursor.index));
    } else {
        cursor.index = Math.max(0, pile.length - 1);
    }
    cursorEl().tabIndex = 0;
}

function cursorEl() {
    const card = game.pile(cursor.pile)[cursor.index];
    return card === undefined ? slotEls[cursor.pile] : cardEls[card];
}

function moveCursor(pile, index = Infinity, focus = true) {
    cursorEl().tabIndex = -1;
    cursor = { pile, index };
    syncCursor();
    if (focus) cursorEl().focus({ preventScroll: true });
}

function stepCursor(key) {
    const { pile, index } = cursor;
    if (isColumn(pile)) {
        const c = COLUMNS.indexOf(pile);
        const first = game.hidden[c];
        if (key === 'ArrowLeft') moveCursor(COLUMNS[Math.max(0, c - 1)]);
        else if (key === 'ArrowRight') moveCursor(COLUMNS[Math.min(6, c + 1)]);
        else if (key === 'ArrowDown') moveCursor(pile, index + 1);
        else if (key === 'ArrowUp') {
            if (game.pile(pile).length > 0 && index - 1 >= first) moveCursor(pile, index - 1);
            else moveCursor(ABOVE[c]);
        }
        return;
    }
    const t = TOP_ROW.indexOf(pile);
    if (key === 'ArrowLeft') moveCursor(TOP_ROW[Math.max(0, t - 1)]);
    else if (key === 'ArrowRight') moveCursor(TOP_ROW[Math.min(TOP_ROW.length - 1, t + 1)]);
    else if (key === 'ArrowDown') moveCursor(COLUMNS[TOP_COL[pile]]);
}

// 元素在哪一堆、第幾張
function locate(el) {
    if (el.classList.contains('slot')) return { pile: el.dataset.pile, index: 0, card: null };
    const card = Number(el.dataset.card);
    const p = positions.get(card);
    return p ? { pile: p.pile, index: p.index, card } : null;
}

// ---------- 分數列與朗讀 ----------

function renderHud() {
    $('moves').textContent = state === 'ready' ? 0 : game.moves;
    const record = bestTime[drawMode].get();
    $('best').textContent = record === null ? '–' : formatTime(record);
    renderTime();
    for (const button of document.querySelectorAll('.level')) {
        button.setAttribute('aria-pressed', String(Number(button.dataset.draw) === drawMode));
    }
    $('undo-btn').disabled = !(state === 'playing' && game.status === 'playing' && game.canUndo() && !busy);
    finishBtn.hidden = !(state === 'playing' && !busy && game.canAutoComplete());
}

function announce(text) {
    statusText.textContent = text;
}

const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

function describe(result) {
    if (result.type === 'draw') return `Drew ${result.cards.map(cardName).join(', ')}.`;
    if (result.type === 'recycle') {
        const n = game.pile('stock').length;
        return `Turned the waste over. ${n} ${n === 1 ? 'card' : 'cards'} in stock.`;
    }
    const [first] = result.cards;
    const more = result.cards.length > 1 ? ` and ${result.cards.length - 1} more` : '';
    let where;
    if (isFoundation(result.to)) where = 'to the foundation';
    else {
        const pile = game.pile(result.to);
        const below = pile[pile.length - result.cards.length - 1];
        where =
            below === undefined
                ? `to empty ${PILE_LABEL(result.to)}`
                : `to ${PILE_LABEL(result.to)}, on ${cardName(below)}`;
    }
    let text = `${capitalize(cardName(first))}${more} ${where}.`;
    if (result.flipped !== null) text += ` Revealed ${cardName(result.flipped)}.`;
    if (game.canAutoComplete()) text += ' All cards are face up — auto-complete is available.';
    return text;
}

// ---------- 遊戲流程 ----------

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
    if (game) renderHud();
}

function clearTimers() {
    clearTimeout(autoTimer);
    clearTimeout(resultTimer);
    clearTimeout(busyTimer);
    busy = false;
}

// 只存進行中、已經動過的局；結束就清掉
function save() {
    if (!game || state === 'ready') return;
    if (game.status !== 'playing' || game.moves === 0) writeStorage(SAVE_KEY, null);
    else {
        writeStorage(SAVE_KEY, JSON.stringify({ seconds: Math.floor(currentSeconds()), counted, game: game.toJSON() }));
    }
}

function loadSaved() {
    const saved = readJSON(SAVE_KEY);
    if (!saved?.game) return null;
    try {
        const restored = createSolitaire({ state: saved.game });
        if (restored.status !== 'playing' || restored.moves === 0) return null;
        const seconds = Number(saved.seconds);
        return {
            game: restored,
            seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
            counted: Boolean(saved.counted),
        };
    } catch {
        return null;
    }
}

function newGame(nextDraw = drawMode) {
    clearTimers();
    tableEl.classList.remove('is-celebrating');
    drawMode = nextDraw;
    writeStorage(DRAW_KEY, String(drawMode));
    game = createSolitaire({ draw: drawMode });
    counted = false;
    held = null;
    resetClock();
    cursor = { pile: 't0', index: 0 };
    setState('playing');
    writeStorage(SAVE_KEY, null);
    const duration = dealAnimation();
    announce(`New game, draw ${drawMode}. ${game.pile('stock').length} cards in the stock.`);
    if (duration > 0) {
        busy = true;
        renderHud();
        busyTimer = setTimeout(() => {
            busy = false;
            renderHud();
        }, duration);
    }
    focusTable();
}

// 已經動過的局，換翻牌模式或開新局要先確認
function requestNewGame(nextDraw = drawMode) {
    if (state === 'ready') {
        // 開始畫面：只換模式與示意盤面，按 Deal 才開始
        drawMode = nextDraw;
        writeStorage(DRAW_KEY, String(drawMode));
        showDemo();
        return;
    }
    if (state === 'confirm') return;
    if ((state === 'playing' || state === 'paused') && game.status === 'playing' && game.moves > 0) {
        pendingDraw = nextDraw;
        stopClock();
        setState('confirm');
        overlays.confirm.querySelector('.btn').focus({ preventScroll: true });
        return;
    }
    newGame(nextDraw);
}

function cancelConfirm() {
    pendingDraw = null;
    setState('playing');
    if (game.moves > 0) startClock();
    focusTable();
}

function pause() {
    if (state !== 'playing' || game.status !== 'playing') return;
    stopClock();
    clearTimeout(autoTimer);
    busy = false;
    held = null;
    renderMarks();
    $('paused-note').textContent = '';
    setState('paused');
    save();
}

function resume() {
    if (state !== 'paused') return;
    setState('playing');
    if (game.moves > 0) startClock();
    render({ animate: false });
    focusTable();
}

// 每個動作之後：開始計時、算一局、重畫、朗讀、存檔、檢查勝利
function afterAction(result, { speak = true } = {}) {
    if (!counted) {
        counted = true;
        bumpStat(drawMode, 'played');
    }
    startClock();
    held = null;
    render();
    if (speak) announce(describe(result));
    if (result.won) win();
    else save();
}

function drawCard() {
    if (!canPlay()) return;
    const result = game.draw();
    if (!result) {
        announce('The stock and the waste are both empty.');
        return;
    }
    afterAction(result);
}

function tryMove(from, count, to) {
    const result = game.move(from, count, to);
    if (!result) return false;
    lastMoveAt = performance.now();
    afterAction(result);
    return true;
}

function reject(el, text) {
    announce(text);
    if (reducedMotion.matches) return;
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
}

function undo() {
    if (!canPlay() || !game.undo()) return;
    held = null;
    lastMoveAt = 0;
    render();
    announce(`Undone. ${game.moves} ${game.moves === 1 ? 'move' : 'moves'}.`);
    save();
}

// 點一下的自動移動：能收就收，否則放到牌桌上
function autoMove(from, count, el) {
    const to = game.bestTarget(from, count);
    if (to) return tryMove(from, count, to);
    const card = game.pile(from)[game.pile(from).length - count];
    reject(el, `No place for ${cardName(card)}${count > 1 ? ` and ${count - 1} more` : ''}.`);
    return false;
}

function sendToFoundation(from) {
    if (!canPlay()) return;
    const to = FOUNDATIONS.find((f) => game.canMove(from, 1, f));
    if (to) tryMove(from, 1, to);
    else {
        const card = game.top(from);
        reject(
            topEl(from),
            card === undefined ? 'Nothing to send.' : `${capitalize(cardName(card))} can't go to the foundation yet.`
        );
    }
}

function autoComplete() {
    if (!canPlay() || !game.canAutoComplete()) return;
    busy = true;
    held = null;
    announce('Finishing the game.');
    renderHud();
    const step = () => {
        if (state !== 'playing') {
            busy = false;
            return;
        }
        const result = game.autoStep();
        if (!result) {
            busy = false;
            render();
            return;
        }
        afterAction(result, { speak: false });
        if (!result.won) autoTimer = setTimeout(step, reducedMotion.matches ? 0 : AUTO_STEP_MS);
    };
    step();
}

// ---------- 動畫：發牌與勝利 ----------

// 所有牌從牌庫的位置一排一排發出去，最上面那張落定後翻開；回傳動畫總長（毫秒）
function dealAnimation() {
    if (!geo) return 0;
    if (reducedMotion.matches) {
        for (const el of cardEls) el._pos = null;
        render({ animate: false });
        return 0;
    }
    tableEl.classList.add('is-still');
    for (const el of cardEls) {
        setTransform(el, colX(0), 0);
        el._pos = { x: colX(0), y: 0 };
        el.classList.remove('is-up');
        el.style.removeProperty('--delay');
        el.style.removeProperty('--flip-delay');
    }
    void tableEl.offsetWidth;
    tableEl.classList.remove('is-still');
    let k = 0;
    for (let row = 0; row < COLUMNS.length; row++) {
        for (let c = row; c < COLUMNS.length; c++) {
            const el = cardEls[game.pile(COLUMNS[c])[row]];
            el.style.setProperty('--delay', `${k * DEAL_STEP_MS}ms`);
            el.style.setProperty('--flip-delay', `${k * DEAL_STEP_MS + MOVE_MS - 60}ms`);
            k++;
        }
    }
    render();
    const total = k * DEAL_STEP_MS + MOVE_MS + 200;
    clearTimeout(dealCleanup);
    dealCleanup = setTimeout(() => {
        for (const el of cardEls) {
            el.style.removeProperty('--delay');
            el.style.removeProperty('--flip-delay');
        }
    }, total);
    return total;
}
let dealCleanup = 0;

// 贏了：收牌區的牌從 K 開始一張張飛散到桌面各處
function celebrate() {
    if (reducedMotion.matches || !geo) return 0;
    const order = [];
    for (let rank = 13; rank >= 1; rank--) {
        for (const id of FOUNDATIONS) {
            const card = game.pile(id).find((c) => rankOf(c) === rank);
            if (card !== undefined) order.push(card);
        }
    }
    tableEl.classList.add('is-celebrating');
    order.forEach((card, k) => {
        const el = cardEls[card];
        const x = Math.random() * (geo.width - geo.w);
        const y = geo.h * 0.4 + Math.random() * Math.max(0, geo.height - geo.h * 1.4);
        const turn = (Math.random() - 0.5) * 50;
        el.style.setProperty('--delay', `${k * CELEBRATE_STEP_MS}ms`);
        el.style.zIndex = 600 + k;
        setTransform(el, x, y, ` rotate(${turn.toFixed(1)}deg)`);
        el._pos = { x, y };
    });
    return order.length * CELEBRATE_STEP_MS + CELEBRATE_MS;
}

function win() {
    stopClock();
    busy = true;
    const seconds = Math.max(1, Math.round(currentSeconds()));
    const moves = game.moves;
    const timeRecord = bestTime[drawMode].submit(seconds);
    const movesRecord = bestMoves[drawMode].submit(moves);
    bumpStat(drawMode, 'won');
    writeStorage(SAVE_KEY, null);
    renderHud();

    let note;
    if (timeRecord && movesRecord) note = 'New best time and fewest moves';
    else if (timeRecord) note = 'New best time';
    else if (movesRecord) note = 'Fewest moves yet';
    else note = `Best ${formatTime(bestTime[drawMode].get())} · Fewest ${bestMoves[drawMode].get()} moves`;
    const stats = statsOf(drawMode);
    announce(`You won in ${formatTime(seconds)} with ${moves} moves. ${note}.`);

    resultTimer = setTimeout(() => {
        const duration = celebrate();
        resultTimer = setTimeout(
            () => {
                busy = false;
                $('won-time').textContent = formatTime(seconds);
                $('won-detail').textContent = `${moves} moves · Draw ${drawMode}`;
                const noteEl = $('won-note');
                noteEl.textContent = note;
                noteEl.classList.toggle('is-record', timeRecord || movesRecord);
                $('won-stats').textContent =
                    `Won ${stats.won} of ${stats.played} ${stats.played === 1 ? 'game' : 'games'}`;
                overAt = performance.now();
                setState('won');
                overlays.won.querySelector('.btn').focus({ preventScroll: true });
            },
            duration + (reducedMotion.matches ? 300 : 200)
        );
    }, MOVE_MS + 60);
}

// ---------- 滑鼠 / 觸控：點一下自動移動，按住拖曳 ----------

let drag = null;
// 拖曳放開後瀏覽器可能還會送一次 click，要忽略
let swallowClick = false;

tableEl.addEventListener('click', (event) => {
    const el = event.target.closest('.card, .slot');
    if (swallowClick) {
        swallowClick = false;
        return;
    }
    if (!el || !canPlay()) return;
    const loc = locate(el);
    if (!loc) return;
    // 鍵盤（Space / Enter）觸發的 click：detail 為 0
    if (event.detail === 0) keyActivate(loc, el);
    else pointerActivate(loc, el, event);
});

function pointerActivate(loc, el, event) {
    moveCursor(loc.pile, loc.index, false);
    if (loc.pile === 'stock') {
        drawCard();
        return;
    }
    // 鍵盤拿著牌時點到可以放的位置，就放過去
    if (held) {
        const { from, count } = held;
        held = null;
        if (game.canMove(from, count, loc.pile)) {
            tryMove(from, count, loc.pile);
            return;
        }
        renderMarks();
    }
    if (loc.card === null || !game.isFaceUp(loc.pile, loc.index)) return;
    // 收牌區的牌點一下不動作（避免誤點拿回來），要拿回牌桌請用拖曳
    if (isFoundation(loc.pile)) return;
    if (event.detail >= 2 && performance.now() - lastMoveAt < DOUBLE_MS) return;
    const count = game.pile(loc.pile).length - loc.index;
    if (!game.canPick(loc.pile, count)) {
        reject(el, `${capitalize(cardName(loc.card))} can't be moved.`);
        return;
    }
    autoMove(loc.pile, count, el);
}

tableEl.addEventListener('pointerdown', (event) => {
    swallowClick = false;
    if (event.button !== 0 || !canPlay() || drag) return;
    const el = event.target.closest('.card');
    if (!el) return;
    const loc = locate(el);
    if (!loc || loc.pile === 'stock' || !game.isFaceUp(loc.pile, loc.index)) return;
    const pile = game.pile(loc.pile);
    const count = pile.length - loc.index;
    if (!game.canPick(loc.pile, count)) return;
    drag = {
        from: loc.pile,
        count,
        els: pile.slice(loc.index).map((card) => cardEls[card]),
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        active: false,
        over: null,
        legal: [],
    };
});

tableEl.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        drag.active = true;
        held = null;
        renderMarks();
        tableEl.setPointerCapture?.(drag.id);
        drag.legal = game.targets(drag.from, drag.count);
        for (const to of drag.legal) topEl(to).classList.add('is-candidate');
        drag.els.forEach((el, k) => {
            clearTimeout(el._flyTimer);
            el.classList.add('is-drag');
            el.style.zIndex = 700 + k;
        });
    }
    for (const el of drag.els) setTransform(el, el._pos.x + dx, el._pos.y + dy);
    const over = hitTest(drag.els[0]._pos.x + dx, drag.els[0]._pos.y + dy, drag.from);
    if (over !== drag.over) {
        if (drag.over) topEl(drag.over).classList.remove('is-over');
        drag.over = over;
        if (over && drag.legal.includes(over)) topEl(over).classList.add('is-over');
    }
});

// 拖著的牌和哪一堆重疊最多
function hitTest(x, y, from) {
    let best = null;
    let bestArea = 0;
    for (const id of [...FOUNDATIONS, ...COLUMNS]) {
        if (id === from) continue;
        const [px, py] = slotPosition(id);
        let bottom = py + geo.h;
        if (isColumn(id)) {
            const top = game.top(id);
            if (top !== undefined) bottom = positions.get(top).y + geo.h;
        }
        const w = Math.min(x + geo.w, px + geo.w) - Math.max(x, px);
        const h = Math.min(y + geo.h, bottom) - Math.max(y, py);
        const area = w > 0 && h > 0 ? w * h : 0;
        if (area > bestArea) {
            bestArea = area;
            best = id;
        }
    }
    return best;
}

function endDrag() {
    if (!drag) return null;
    const ended = drag;
    drag = null;
    for (const el of tableEl.querySelectorAll('.is-candidate, .is-over'))
        el.classList.remove('is-candidate', 'is-over');
    for (const el of ended.els) el.classList.remove('is-drag');
    return ended;
}

// 放不下（或取消）時彈回原位
function snapBack(ended) {
    ended.els.forEach((el) => {
        const p = el._pos;
        setTransform(el, p.x, p.y);
        const card = Number(el.dataset.card);
        fly(el, positions.get(card).z);
    });
}

tableEl.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const ended = endDrag();
    if (!ended.active) return;
    swallowClick = true;
    const { from, count, over } = ended;
    if (over && game.canMove(from, count, over)) {
        // 放開的位置就是動畫起點：從手指的位置滑進定位
        for (const el of ended.els) el._pos = { x: NaN, y: NaN };
        tryMove(from, count, over);
        return;
    }
    snapBack(ended);
    if (over) {
        const card = game.pile(from)[game.pile(from).length - count];
        const target = game.top(over);
        announce(
            target === undefined
                ? `${capitalize(cardName(card))} can't go to the empty ${isFoundation(over) ? 'foundation' : 'column'}.`
                : `${capitalize(cardName(card))} can't go on ${cardName(target)}.`
        );
    }
});

tableEl.addEventListener('pointercancel', () => {
    const ended = endDrag();
    if (ended?.active) snapBack(ended);
});

tableEl.addEventListener('contextmenu', (event) => event.preventDefault());

// ---------- 鍵盤 ----------

function keyActivate(loc, el) {
    moveCursor(loc.pile, loc.index, false);
    if (held) {
        const { from, count } = held;
        if (loc.pile === from) {
            held = null;
            renderMarks();
            autoMove(from, count, el);
            return;
        }
        if (game.canMove(from, count, loc.pile)) {
            held = null;
            tryMove(from, count, loc.pile);
            cursor = { pile: loc.pile, index: Infinity };
            syncCursor();
            cursorEl().focus({ preventScroll: true });
            return;
        }
        reject(el, `Can't place it on ${PILE_LABEL(loc.pile)}. Press Escape to put it back.`);
        return;
    }
    if (loc.pile === 'stock') {
        drawCard();
        return;
    }
    if (loc.card === null || !game.isFaceUp(loc.pile, loc.index)) return;
    const count = game.pile(loc.pile).length - loc.index;
    if (!game.canPick(loc.pile, count)) {
        reject(el, `${capitalize(cardName(loc.card))} can't be moved.`);
        return;
    }
    held = { from: loc.pile, count };
    renderMarks();
    const targets = game.targets(loc.pile, count).map(PILE_LABEL);
    const what = `${cardName(loc.card)}${count > 1 ? ` and ${count - 1} more` : ''}`;
    announce(
        targets.length
            ? `Picked up ${what}. It can go to ${targets.join(', ')}. Press Space again here to move it automatically.`
            : `Picked up ${what}. There is nowhere to put it right now. Press Escape to put it back.`
    );
}

addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (state === 'playing') {
        if (key.startsWith('Arrow')) {
            event.preventDefault();
            if (!tableEl.contains(document.activeElement)) cursorEl().focus({ preventScroll: true });
            else stepCursor(key);
            return;
        }
        if (key === 'Escape' && held) {
            held = null;
            renderMarks();
            announce('Put back.');
            return;
        }
        if (busy) return;
        if (key === 'd') drawCard();
        else if (key === 'f') sendToFoundation(cursor.pile === 'stock' ? 'waste' : cursor.pile);
        else if (key === 'u') undo();
        else if (key === 'n') requestNewGame();
        else if (key === 'p' || key === 'Escape') pause();
        // Space / Enter 由牌本身的 click 處理
        return;
    }
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
        if (state === 'ready' || state === 'won') {
            // newGame 會把焦點移到牌上；不擋掉的話這次 Enter 會接著拿起那張牌
            event.preventDefault();
            newGame();
        }
    }
});

document.addEventListener('click', (event) => {
    const levelButton = event.target.closest('.level');
    if (levelButton) {
        const next = Number(levelButton.dataset.draw);
        if (next !== drawMode || state !== 'playing') requestNewGame(next);
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
        case 'resume':
            resume();
            break;
        case 'confirm':
            newGame(pendingDraw ?? drawMode);
            pendingDraw = null;
            break;
        case 'cancel':
            cancelConfirm();
            break;
    }
});

$('undo-btn').addEventListener('click', undo);
$('new-btn').addEventListener('click', () => requestNewGame());
$('pause-btn').addEventListener('click', pause);
finishBtn.addEventListener('click', autoComplete);
addEventListener('pagehide', save);

// 切到背景或失焦就暫停（盤面被蓋住、時間停止），回來由玩家按繼續
autoPause({ pause, resume() {} });
addEventListener('blur', pause);

new ResizeObserver(() => {
    measure();
    if (game && !tableEl.classList.contains('is-celebrating')) render({ animate: false });
}).observe(tableArea);

// ---------- 啟動：有進行中的局面就接著玩（先停在暫停畫面），否則顯示開始畫面與示意盤面 ----------

function seeded(seed) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// 示意盤面：固定的一局，用簡單的策略走幾十步，看起來像玩到一半
function showDemo() {
    clearTimers();
    tableEl.classList.remove('is-celebrating');
    game = createSolitaire({ draw: drawMode, random: seeded(20) });
    for (let step = 0; step < 34; step++) {
        let done = false;
        for (const from of ['waste', ...COLUMNS]) {
            const pile = game.pile(from);
            for (let count = game.faceUpCount(from); count >= 1 && !done; count--) {
                const to = game.bestTarget(from, count);
                // 只做有進展的移動：收牌、翻開蓋著的牌、或從 waste 拿出來
                const useful =
                    to &&
                    (isFoundation(to) ||
                        from === 'waste' ||
                        count === pile.length - game.hidden[COLUMNS.indexOf(from)]);
                if (useful && !(isColumn(from) && count === pile.length)) done = Boolean(game.move(from, count, to));
            }
            if (done) break;
        }
        if (!done) game.draw();
    }
    held = null;
    resetClock();
    for (const el of cardEls) {
        el._pos = null;
        el.style.removeProperty('--delay');
    }
    setState('ready');
    render({ animate: false });
}

buildTable();
measure();
const saved = loadSaved();
if (saved) {
    game = saved.game;
    drawMode = game.drawCount;
    counted = saved.counted;
    resetClock(saved.seconds);
    setState('paused');
    $('paused-note').textContent = `Game in progress · ${formatTime(saved.seconds)} · ${game.moves} moves`;
    render({ animate: false });
    announce('Game in progress. Press Resume to continue.');
    overlays.paused.querySelector('.btn').focus({ preventScroll: true });
} else {
    showDemo();
}
