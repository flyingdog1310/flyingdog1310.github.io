// 俄羅斯方塊：畫面與操作。遊戲規則在 core.js
import { COLS, VISIBLE_ROWS, HIDDEN_ROWS, CLEAR_DURATION, TYPES, createTetris, pieceCells } from './core.js';
import { setupCanvas, createLoop, autoPause, highScore } from '../../shared/game-utils.js';

// 左右連續移動：按住 DAS 秒後開始，每 ARR 秒移動一格
const DAS = 0.17;
const ARR = 0.05;
// Game over 後這段時間內不接受鍵盤重新開始，避免連按硬降時直接跳過結算畫面
const RESTART_GRACE_MS = 800;

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.tetris');
const wellArea = $('well-area');
const well = $('well');
const boardCanvas = $('board');
const holdCanvas = $('hold');
const nextCanvas = $('next');
const holdSlot = $('hold-slot');
const callout = $('callout');
const overlays = { ready: $('overlay-ready'), paused: $('overlay-paused'), over: $('overlay-over') };
const hud = { score: $('score'), level: $('level'), lines: $('lines'), best: $('best') };

const best = highScore('tetris');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const styles = getComputedStyle(document.documentElement);
const COLORS = Object.fromEntries(TYPES.map((t) => [t, styles.getPropertyValue(`--piece-${t.toLowerCase()}`).trim()]));
const GRID_COLOR = styles.getPropertyValue('--well-grid').trim();

const formatNumber = (n) => n.toLocaleString('en-US');

// ---------- 方塊外觀 ----------

// 與白色（amount > 0）或黑色（amount < 0）混合
function shade(hex, amount) {
    const n = Number.parseInt(hex.slice(1), 16);
    const target = amount > 0 ? 255 : 0;
    const t = Math.abs(amount);
    const mix = (c) => Math.round(c + (target - c) * t);
    return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

// 一格方塊：外框漸層 + 上亮下暗的斜面 + 內面 + 左上角光點
function paintBlock(ctx, x, y, size, color) {
    const inset = Math.max(0.75, size * 0.04);
    const bx = x + inset;
    const by = y + inset;
    const bs = size - inset * 2;
    const radius = Math.max(1.5, size * 0.14);

    const body = ctx.createLinearGradient(0, by, 0, by + bs);
    body.addColorStop(0, shade(color, 0.22));
    body.addColorStop(1, shade(color, -0.28));
    ctx.fillStyle = body;
    roundRect(ctx, bx, by, bs, bs, radius);
    ctx.fill();

    const bevel = bs * 0.16;
    const face = ctx.createLinearGradient(0, by + bevel, 0, by + bs - bevel);
    face.addColorStop(0, shade(color, 0.08));
    face.addColorStop(1, shade(color, -0.1));
    ctx.fillStyle = face;
    roundRect(ctx, bx + bevel, by + bevel, bs - bevel * 2, bs - bevel * 2, radius * 0.6);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    roundRect(ctx, bx + bevel * 1.25, by + bevel * 1.25, bs * 0.22, bs * 0.1, bs * 0.05);
    ctx.fill();
}

// 每種顏色 × 尺寸預先畫好一張，逐格 drawImage
const sprites = new Map();
function sprite(type, size) {
    const dpr = devicePixelRatio || 1;
    const key = `${type}:${size}:${dpr}`;
    let canvas = sprites.get(key);
    if (!canvas) {
        canvas = document.createElement('canvas');
        const ctx = setupCanvas(canvas, size, size, { dpr, setStyle: false });
        paintBlock(ctx, 0, 0, size, COLORS[type]);
        sprites.set(key, canvas);
    }
    return canvas;
}

const drawBlock = (ctx, type, x, y, size) => ctx.drawImage(sprite(type, size), x, y, size, size);

// ---------- 狀態 ----------

let state = 'ready';
let game = null;
let cell = 24;
let boardCtx = null;
const input = { left: false, right: false, down: false, dir: null, das: 0, arr: 0 };
// 畫面特效：{ kind, start, ... }
let effects = [];
let particles = [];
let lastRenderTime = 0;
let overAt = 0;
const shown = {};

// 開始畫面後方的示意盤面（也是首頁縮圖的畫面）
const DEMO_ROWS = [
    '......T...',
    'L....TTTOO',
    'L.SS.JJJOO',
    'LSSZZ.IJ..',
    'IIIIZZIJJ.',
];
function demoGame() {
    const demo = createTetris({ random: () => 0.42 });
    demo.board.splice(-DEMO_ROWS.length, DEMO_ROWS.length, ...DEMO_ROWS.map((row) => [...row].map((c) => (c === '.' ? null : c))));
    demo.active = { type: 'I', rotation: 1, x: 7, y: 7 };
    demo.held = 'T';
    demo.queue = ['S', 'O', 'L', 'Z', 'J'];
    return demo;
}

// ---------- 繪圖 ----------

let gridLayer = null;
function buildGridLayer() {
    gridLayer = document.createElement('canvas');
    const ctx = setupCanvas(gridLayer, cell * COLS, cell * VISIBLE_ROWS, { setStyle: false });
    ctx.fillStyle = GRID_COLOR;
    const dot = Math.max(1.5, cell * 0.07);
    for (let x = 1; x < COLS; x++) {
        for (let y = 1; y < VISIBLE_ROWS; y++) {
            ctx.fillRect(x * cell - dot / 2, y * cell - dot / 2, dot, dot);
        }
    }
}

const toScreenY = (row) => (row - HIDDEN_ROWS) * cell;
const easeOut = (t) => 1 - (1 - t) ** 3;

function renderBoard(now) {
    const ctx = boardCtx;
    const width = cell * COLS;
    const height = cell * VISIBLE_ROWS;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(gridLayer, 0, 0, width, height);
    if (!game) return;

    const clearingRows = new Set(game.clearing?.rows ?? []);
    const clearT = game.clearing ? 1 - game.clearing.time / CLEAR_DURATION : 0;

    game.board.forEach((row, y) => {
        if (y < HIDDEN_ROWS - 1) return;
        if (clearingRows.has(y) && clearT > 0.25) return;
        row.forEach((type, x) => type && drawBlock(ctx, type, x * cell, toScreenY(y), cell));
    });

    // 消行：先整列變白，再往中間收起
    for (const y of clearingRows) {
        const sy = toScreenY(y);
        if (clearT <= 0.25) {
            ctx.fillStyle = `rgba(255, 255, 255, ${(clearT / 0.25) * 0.85})`;
            ctx.fillRect(0, sy, width, cell);
        } else {
            const t = easeOut((clearT - 0.25) / 0.75);
            const w = width * (1 - t);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * (1 - t * 0.6)})`;
            ctx.fillRect((width - w) / 2, sy + cell * 0.1 * t, w, cell * (1 - 0.2 * t));
        }
    }

    const piece = game.active;
    if (piece) {
        const cells = pieceCells(piece.type, piece.rotation);
        const ghostY = game.ghostY();
        if (ghostY !== piece.y) {
            ctx.strokeStyle = shade(COLORS[piece.type], 0.1);
            ctx.fillStyle = COLORS[piece.type];
            ctx.lineWidth = Math.max(1, cell * 0.06);
            for (const [cx, cy] of cells) {
                const x = (piece.x + cx) * cell;
                const y = toScreenY(ghostY + cy);
                const inset = cell * 0.1;
                ctx.globalAlpha = 0.12;
                roundRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.12);
                ctx.fill();
                ctx.globalAlpha = 0.55;
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
        for (const [cx, cy] of cells) {
            drawBlock(ctx, piece.type, (piece.x + cx) * cell, toScreenY(piece.y + cy), cell);
        }
    }

    renderEffects(ctx, now);
}

function renderEffects(ctx, now) {
    effects = effects.filter((effect) => now - effect.start < effect.duration);
    for (const effect of effects) {
        const t = (now - effect.start) / effect.duration;
        if (effect.kind === 'trail') {
            // 硬降：每一欄從起點拉一條漸淡的光軌到落點
            for (const { x, top, bottom } of effect.columns) {
                const y0 = toScreenY(top);
                const y1 = toScreenY(bottom);
                const gradient = ctx.createLinearGradient(0, y0, 0, y1);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
                gradient.addColorStop(1, effect.color);
                ctx.globalAlpha = 0.35 * (1 - t);
                ctx.fillStyle = gradient;
                ctx.fillRect(x * cell + cell * 0.15, y0, cell * 0.7, y1 - y0);
            }
        } else if (effect.kind === 'flash') {
            ctx.globalAlpha = 0.45 * (1 - t);
            ctx.fillStyle = '#fff';
            for (const [x, y] of effect.cells) {
                roundRect(ctx, x * cell + 1, toScreenY(y) + 1, cell - 2, cell - 2, cell * 0.14);
                ctx.fill();
            }
        }
    }
    ctx.globalAlpha = 1;

    const dt = Math.min(now - lastRenderTime, 0.05);
    lastRenderTime = now;
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
        p.vy += cell * 40 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(1, p.life / p.maxLife + 0.2);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

// 預覽（Hold / Next）：畫布較寬時橫排、較高時直排，第一個較大
function renderPreview(canvas, types) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const ctx = setupCanvas(canvas, w, h, { setStyle: false });
    ctx.clearRect(0, 0, w, h);
    const horizontal = w > h;
    const weights = types.map((_, i) => (i === 0 && types.length > 1 ? 1.35 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let offset = 0;
    types.forEach((type, i) => {
        if (!type) return;
        const share = ((horizontal ? w : h) * weights[i]) / total;
        const slotW = horizontal ? share : w;
        const slotH = horizontal ? h : share;
        const cells = pieceCells(type, 0);
        const xs = cells.map(([x]) => x);
        const ys = cells.map(([, y]) => y);
        const size = Math.floor(Math.min(slotW / 4.6, slotH / 2.8) * (weights[i] > 1 ? 1 : 0.85));
        const pw = (Math.max(...xs) - Math.min(...xs) + 1) * size;
        const ph = (Math.max(...ys) - Math.min(...ys) + 1) * size;
        const ox = (horizontal ? offset : 0) + (slotW - pw) / 2 - Math.min(...xs) * size;
        const oy = (horizontal ? 0 : offset) + (slotH - ph) / 2 - Math.min(...ys) * size;
        for (const [cx, cy] of cells) drawBlock(ctx, type, ox + cx * size, oy + cy * size, size);
        offset += share;
    });
}

function renderPreviews() {
    if (!game) return;
    const narrow = nextCanvas.clientWidth > nextCanvas.clientHeight;
    renderPreview(holdCanvas, [game.held]);
    renderPreview(nextCanvas, game.queue.slice(0, narrow ? 3 : 5));
    holdSlot.classList.toggle('is-locked', !game.canHold);
}

function setText(key, value) {
    if (shown[key] === value) return;
    shown[key] = value;
    hud[key].textContent = value;
}

function renderHud() {
    setText('score', formatNumber(game.score));
    setText('level', String(game.level));
    setText('lines', String(game.lines));
    const record = best.get();
    setText('best', record === null ? '–' : formatNumber(record));
}

// ---------- 版面尺寸 ----------

function layout() {
    const width = wellArea.clientWidth;
    const height = wellArea.clientHeight;
    const next = Math.max(8, Math.floor(Math.min(width / COLS, height / VISIBLE_ROWS)));
    if (next !== cell || !boardCtx) {
        cell = next;
        well.style.width = `${cell * COLS}px`;
        well.style.height = `${cell * VISIBLE_ROWS}px`;
        boardCtx = setupCanvas(boardCanvas, cell * COLS, cell * VISIBLE_ROWS);
        sprites.clear();
        buildGridLayer();
    }
    renderBoard(performance.now() / 1000);
    renderPreviews();
}

new ResizeObserver(layout).observe(wellArea);
new ResizeObserver(renderPreviews).observe(nextCanvas);

// ---------- 遊戲事件 → 畫面特效 ----------

function bump() {
    if (reduceMotion.matches) return;
    well.classList.remove('is-bump');
    void well.offsetWidth;
    well.classList.add('is-bump');
}

function showCallout(title, details = []) {
    callout.replaceChildren(title, ...details.map((text) => Object.assign(document.createElement('small'), { textContent: text })));
    callout.classList.remove('is-showing');
    void callout.offsetWidth;
    callout.classList.add('is-showing');
}

const LINE_NAMES = ['', 'Single', 'Double', 'Triple', 'Tetris'];

function describeClear({ lines, tspin }) {
    if (tspin === 'full') return lines ? `T-spin ${LINE_NAMES[lines].toLowerCase()}` : 'T-spin';
    if (tspin === 'mini') return lines ? `Mini T-spin ${LINE_NAMES[lines].toLowerCase()}` : 'Mini T-spin';
    return LINE_NAMES[lines];
}

function handleEvents(now) {
    for (const event of game.takeEvents()) {
        switch (event.type) {
            case 'hardDrop': {
                if (event.distance < 1) break;
                const columns = new Map();
                for (const [cx, cy] of pieceCells(event.piece.type, event.piece.rotation)) {
                    const x = event.piece.x + cx;
                    const top = event.fromY + cy;
                    const bottom = event.piece.y + cy;
                    const current = columns.get(x);
                    if (!current || bottom < current.bottom) columns.set(x, { x, top, bottom });
                }
                effects.push({ kind: 'trail', start: now, duration: 0.2, color: COLORS[event.piece.type], columns: [...columns.values()] });
                bump();
                break;
            }
            case 'lock':
                effects.push({ kind: 'flash', start: now, duration: 0.18, cells: event.cells });
                break;
            case 'clear': {
                // 這些列正在消除，不需要鎖定閃光
                if (event.lines > 0) effects = effects.filter((effect) => effect.kind !== 'flash');
                const title = describeClear(event);
                const details = [];
                if (event.backToBack) details.push('Back-to-back');
                if (event.combo > 0) details.push(`Combo ${event.combo}`);
                // 單行消除不打斷畫面，除非有其他加成
                if (event.lines > 1 || event.tspin || details.length) {
                    details.push(`+${formatNumber(event.points)}`);
                    showCallout(title || 'Combo', details);
                }
                if (event.lines >= 4 || event.tspin) bump();
                spawnParticles(event.rows);
                break;
            }
            case 'levelUp':
                showCallout(`Level ${event.level}`);
                break;
            case 'gameOver':
                finish();
                break;
        }
    }
}

function spawnParticles(rows) {
    if (reduceMotion.matches) return;
    for (const y of rows) {
        game.board[y].forEach((type, x) => {
            for (let i = 0; i < 3; i++) {
                const life = 0.45 + Math.random() * 0.35;
                particles.push({
                    x: (x + 0.5) * cell,
                    y: toScreenY(y) + cell / 2,
                    vx: (Math.random() - 0.5) * cell * 14,
                    vy: -(0.3 + Math.random()) * cell * 10,
                    size: cell * (0.12 + Math.random() * 0.12),
                    color: COLORS[type],
                    life,
                    maxLife: life,
                });
            }
        });
    }
}

// ---------- 遊戲流程 ----------

const loop = createLoop({
    update(dt) {
        if (state !== 'playing') return;
        if (input.dir) {
            input.das += dt;
            if (input.das >= DAS) {
                input.arr += dt;
                while (input.arr >= ARR) {
                    input.arr -= ARR;
                    if (!game.move(input.dir === 'left' ? -1 : 1)) {
                        input.arr = 0;
                        break;
                    }
                }
            }
        }
        game.tick(dt, { softDropping: input.down });
        handleEvents(performance.now() / 1000);
    },
    render() {
        const now = performance.now() / 1000;
        renderBoard(now);
        renderHud();
        if (shown.queue !== game.queue.join() + game.held + game.canHold) {
            shown.queue = game.queue.join() + game.held + game.canHold;
            renderPreviews();
        }
    },
});

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
    if (next === 'playing') {
        lastRenderTime = performance.now() / 1000;
        loop.start();
    } else {
        loop.stop();
        releaseAll();
    }
}

function start() {
    game = createTetris();
    effects = [];
    particles = [];
    shown.queue = null;
    callout.classList.remove('is-showing');
    renderHud();
    renderPreviews();
    document.activeElement?.blur();
    setState('playing');
}

function pause() {
    if (state !== 'playing') return;
    setState('paused');
    renderBoard(performance.now() / 1000);
}

function resume() {
    if (state !== 'paused') return;
    document.activeElement?.blur();
    setState('playing');
}

function finish() {
    const isRecord = best.submit(game.score);
    $('final-score').textContent = formatNumber(game.score);
    const note = $('final-note');
    const record = best.get();
    note.textContent = isRecord ? 'New best score' : `${game.lines} lines, level ${game.level}. Best ${formatNumber(record ?? 0)}`;
    note.classList.toggle('is-record', isRecord);
    shown.best = null;
    overAt = performance.now();
    setState('over');
    renderHud();
    renderBoard(performance.now() / 1000);
}

// ---------- 操作 ----------

function press(action) {
    if (state !== 'playing') return;
    switch (action) {
        case 'left':
        case 'right':
            input[action] = true;
            input.dir = action;
            input.das = 0;
            input.arr = 0;
            game.move(action === 'left' ? -1 : 1);
            break;
        case 'down':
            input.down = true;
            game.softDrop();
            break;
        case 'cw':
            game.rotate(1);
            break;
        case 'ccw':
            game.rotate(-1);
            break;
        case 'drop':
            game.hardDrop();
            break;
        case 'hold':
            game.hold();
            break;
        case 'pause':
            pause();
            break;
    }
}

function release(action) {
    if (action === 'down') input.down = false;
    if (action !== 'left' && action !== 'right') return;
    input[action] = false;
    if (input.dir === action) {
        const other = action === 'left' ? 'right' : 'left';
        input.dir = input[other] ? other : null;
        input.das = 0;
        input.arr = 0;
    }
}

function releaseAll() {
    Object.assign(input, { left: false, right: false, down: false, dir: null, das: 0, arr: 0 });
    for (const button of document.querySelectorAll('.pad__btn.is-pressed')) button.classList.remove('is-pressed');
}

const KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'down',
    ArrowUp: 'cw',
    x: 'cw',
    z: 'ccw',
    Control: 'ccw',
    ' ': 'drop',
    c: 'hold',
    Shift: 'hold',
    p: 'pause',
    Escape: 'pause',
};
const keyAction = (event) => KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];

addEventListener('keydown', (event) => {
    const action = keyAction(event);
    if (state === 'playing') {
        if (!action) return;
        event.preventDefault();
        if (!event.repeat) press(action);
        return;
    }
    // 開始 / 暫停 / 結束畫面：Enter 或空白鍵執行主要按鈕（焦點在按鈕上時交給瀏覽器）
    const onButton = event.target instanceof HTMLButtonElement;
    if ((event.key === 'Enter' || event.key === ' ') && !onButton) {
        event.preventDefault();
        if (event.repeat || (state === 'over' && performance.now() - overAt < RESTART_GRACE_MS)) return;
        if (state === 'paused') resume();
        else start();
    } else if (state === 'paused' && action === 'pause' && !event.repeat) {
        resume();
    }
});

addEventListener('keyup', (event) => {
    const action = keyAction(event);
    if (action) release(action);
});

document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'start' || action === 'restart') start();
    else if (action === 'resume') resume();
});

$('pause-btn').addEventListener('click', pause);
holdSlot.addEventListener('click', () => press('hold'));

// 觸控按鈕：左右 / 軟降按住連續，其餘按下即觸發
for (const button of document.querySelectorAll('.pad__btn')) {
    const held = button.dataset.hold;
    const tap = button.dataset.tap;
    button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        button.classList.add('is-pressed');
        if (held) press(held);
        else press(tap === 'rotate' ? 'cw' : tap);
    });
    const up = () => {
        button.classList.remove('is-pressed');
        if (held) release(held);
    };
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
}

// 場地手勢：點一下旋轉、拖曳左右移動、慢慢往下拖軟降、快速下滑硬降、快速上滑 hold
let gesture = null;
well.addEventListener('pointerdown', (event) => {
    if (state !== 'playing' || event.pointerType === 'mouse') return;
    well.setPointerCapture(event.pointerId);
    gesture = { x: event.clientX, y: event.clientY, time: performance.now(), movedX: 0, movedY: 0, moved: false };
});

well.addEventListener('pointermove', (event) => {
    if (!gesture || state !== 'playing') return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const stepsX = Math.trunc(dx / (cell * 0.9));
    while (gesture.movedX !== stepsX) {
        const dir = Math.sign(stepsX - gesture.movedX);
        game.move(dir);
        gesture.movedX += dir;
        gesture.moved = true;
    }
    if (dy > Math.abs(dx)) {
        const stepsY = Math.floor(dy / cell);
        while (gesture.movedY < stepsY) {
            game.softDrop();
            gesture.movedY++;
            gesture.moved = true;
        }
    }
});

well.addEventListener('pointerup', (event) => {
    if (!gesture || state !== 'playing') {
        gesture = null;
        return;
    }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const elapsed = Math.max(performance.now() - gesture.time, 1);
    const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
    const speed = Math.abs(dy) / elapsed;
    if (vertical && dy > cell * 1.5 && speed > 0.6) game.hardDrop();
    else if (vertical && dy < -cell * 1.5 && speed > 0.4) game.hold();
    else if (!gesture.moved && Math.hypot(dx, dy) < 12 && elapsed < 300) game.rotate(1);
    gesture = null;
});

well.addEventListener('pointercancel', () => {
    gesture = null;
});

// 切換分頁或視窗失焦時暫停；回來後由玩家自己按繼續
autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動 ----------

game = demoGame();
setState('ready');
layout();
renderHud();
