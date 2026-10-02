// 打磚塊：畫面與操作。遊戲規則在 core.js
import {
    WIDTH,
    HEIGHT,
    BRICK_W,
    BRICK_H,
    PADDLE_Y,
    PADDLE_H,
    BALL_R,
    CAPSULE_W,
    CAPSULE_H,
    silverHits,
    createBreakout,
} from './core.js';
import { setupCanvas, createLoop, autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 最後一顆球掉下去後，停一下再顯示結算
const OVER_DELAY_MS = 1000;
// 觸控拖曳時，手指移動距離換算成擋板移動的倍率
const DRAG_GAIN = 1.25;
const TRAIL_LENGTH = 6;

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.breakout');
const fieldArea = $('field-area');
const field = $('field');
const boardCanvas = $('board');
const callout = $('callout');
const overlays = { ready: $('overlay-ready'), paused: $('overlay-paused'), over: $('overlay-over') };

const best = highScore('breakout');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const formatNumber = (n) => n.toLocaleString('en-US');

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(`--${name}`).trim();
const C = Object.fromEntries(
    [
        'bg-top', 'bg-bottom', 'bg-pattern', 'frame', 'frame-light', 'paddle', 'paddle-dark', 'paddle-end', 'laser',
        'ball', 'ball-glow',
    ].map((name) => [name, color(name)])
);
const BRICK_COLORS = Object.fromEntries([...'wocgrbpysG'].map((k) => [k, color(`brick-${k}`)]));
const CAPSULE_COLORS = Object.fromEntries([...'ESCLDP'].map((k) => [k, color(`capsule-${k}`)]));

// ---------- 背景：漸層 + 斜格紋，尺寸改變時才重畫 ----------

const backdrop = document.createElement('canvas');

function rebuildBackdrop() {
    backdrop.width = boardCanvas.width;
    backdrop.height = boardCanvas.height;
    const g = backdrop.getContext('2d');
    const k = backdrop.width / WIDTH;
    g.setTransform(k, 0, 0, k, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, C['bg-top']);
    sky.addColorStop(1, C['bg-bottom']);
    g.fillStyle = sky;
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.strokeStyle = C['bg-pattern'];
    g.lineWidth = 0.6;
    g.beginPath();
    for (let d = -HEIGHT; d < WIDTH; d += 16) {
        g.moveTo(d, 0);
        g.lineTo(d + HEIGHT, HEIGHT);
        g.moveTo(d + HEIGHT, 0);
        g.lineTo(d, HEIGHT);
    }
    g.stroke();
    // 上、左、右的金屬框
    g.fillStyle = C.frame;
    g.fillRect(0, 0, WIDTH, 2);
    g.fillRect(0, 0, 2, HEIGHT);
    g.fillRect(WIDTH - 2, 0, 2, HEIGHT);
    g.fillStyle = C['frame-light'];
    g.globalAlpha = 0.5;
    g.fillRect(2, 2, WIDTH - 4, 0.5);
    g.fillRect(2, 2, 0.5, HEIGHT);
    g.fillRect(WIDTH - 2.5, 2, 0.5, HEIGHT);
    g.globalAlpha = 1;
}

// ---------- 磚塊 ----------

// 被打到但沒破的磚會閃一下（key：磚的座標）
const flashes = new Map();
const brickKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

function drawBrick(ctx, brick, level, now) {
    const { x, y, kind } = brick;
    const base = BRICK_COLORS[kind];
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, BRICK_W - 1, BRICK_H - 1, 1.5);
    ctx.fill();

    // 立體感：上亮下暗
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.fillRect(x + 1.5, y + 1, BRICK_W - 3, 1.6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(x + 1.5, y + BRICK_H - 2.6, BRICK_W - 3, 1.6);

    if (kind === 'G' || kind === 's') {
        // 金屬磚：斜向反光
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 0.5, y + 0.5, BRICK_W - 1, BRICK_H - 1);
        ctx.clip();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.moveTo(x + 6, y);
        ctx.lineTo(x + 10, y);
        ctx.lineTo(x + 6, y + BRICK_H);
        ctx.lineTo(x + 2, y + BRICK_H);
        ctx.fill();
        ctx.restore();
    }
    // 銀磚裂痕：打過幾下就顯示幾道
    if (kind === 's') {
        const damage = silverHits(level) - brick.hp;
        ctx.strokeStyle = 'rgba(30, 34, 42, 0.7)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (let i = 0; i < damage; i++) {
            const cx = x + 7 + i * 6;
            ctx.moveTo(cx, y + 1.5);
            ctx.lineTo(cx + 2, y + 5);
            ctx.lineTo(cx - 1, y + 7);
            ctx.lineTo(cx + 1.5, y + BRICK_H - 1.5);
        }
        ctx.stroke();
    }

    const flash = flashes.get(brickKey(x + BRICK_W / 2, y + BRICK_H / 2));
    if (flash !== undefined) {
        const p = (now - flash) / 0.2;
        if (p >= 1) flashes.delete(brickKey(x + BRICK_W / 2, y + BRICK_H / 2));
        else {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * (1 - p)})`;
            ctx.fillRect(x + 0.5, y + 0.5, BRICK_W - 1, BRICK_H - 1);
        }
    }
}

// ---------- 擋板、球、膠囊、雷射 ----------

function drawPaddle(ctx, x, w, mode) {
    const y = PADDLE_Y;
    const h = PADDLE_H;
    const body = ctx.createLinearGradient(0, y, 0, y + h);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.35, C.paddle);
    body.addColorStop(1, C['paddle-dark']);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();

    // 兩端紅色電極
    ctx.fillStyle = C['paddle-end'];
    ctx.beginPath();
    ctx.roundRect(x, y, 7, h, [h / 2, 1, 1, h / 2]);
    ctx.roundRect(x + w - 7, y, 7, h, [1, h / 2, h / 2, 1]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(x + 2, y + 1.2, 4, 1.2);
    ctx.fillRect(x + w - 6, y + 1.2, 4, 1.2);

    if (mode === 'laser') {
        ctx.fillStyle = C['paddle-dark'];
        ctx.fillRect(x + 3.5, y - 3, 3, 3.5);
        ctx.fillRect(x + w - 6.5, y - 3, 3, 3.5);
        ctx.fillStyle = C.laser;
        ctx.fillRect(x + 4.2, y - 3.6, 1.6, 1.2);
        ctx.fillRect(x + w - 5.8, y - 3.6, 1.6, 1.2);
    } else if (mode === 'catch') {
        ctx.fillStyle = CAPSULE_COLORS.C;
        ctx.fillRect(x + 9, y + 0.6, w - 18, 1.4);
    }
}

// 每顆球最近幾個位置，用來畫拖尾
const trails = new WeakMap();

function drawBall(ctx, ball) {
    if (!reduceMotion.matches && !ball.stuck) {
        const trail = trails.get(ball) ?? [];
        trail.push([ball.x, ball.y]);
        if (trail.length > TRAIL_LENGTH) trail.shift();
        trails.set(ball, trail);
        trail.forEach(([x, y], i) => {
            ctx.globalAlpha = ((i + 1) / trail.length) * 0.25;
            ctx.fillStyle = C['ball-glow'];
            ctx.beginPath();
            ctx.arc(x, y, BALL_R * (0.5 + (0.5 * (i + 1)) / trail.length), 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
    }
    const glow = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, BALL_R * 2.6);
    glow.addColorStop(0, C['ball-glow']);
    glow.addColorStop(1, 'rgba(160, 210, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
}

function drawCapsule(ctx, capsule, now) {
    const { x, y, kind } = capsule;
    ctx.save();
    ctx.fillStyle = CAPSULE_COLORS[kind];
    ctx.beginPath();
    ctx.roundRect(x, y, CAPSULE_W, CAPSULE_H, CAPSULE_H / 2);
    ctx.fill();
    ctx.clip();
    // 旋轉中的反光帶
    const band = reduceMotion.matches ? 0.3 : (now * 1.6) % 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(x, y + band * CAPSULE_H - 1.5, CAPSULE_W, 2.2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(x, y + CAPSULE_H - 2, CAPSULE_W, 2);
    ctx.restore();
    ctx.font = '800 7px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillText(kind, x + CAPSULE_W / 2, y + CAPSULE_H / 2 + 0.9);
    ctx.fillStyle = '#fff';
    ctx.fillText(kind, x + CAPSULE_W / 2, y + CAPSULE_H / 2 + 0.4);
}

function drawLaser(ctx, laser) {
    ctx.fillStyle = C.laser;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(laser.x - 1.5, laser.y - 1, 3, 9);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffe1e1';
    ctx.fillRect(laser.x - 0.5, laser.y, 1, 7);
}

// ---------- 特效：磚塊碎片、火花 ----------

let bits = [];
let lastFxTime = 0;

function burst(x, y, count, colors, { speed = 60, gravity = 260, size = 1.6 } = {}) {
    if (reduceMotion.matches) return;
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.9);
        const life = 0.4 + Math.random() * 0.4;
        bits.push({
            x: x + (Math.random() - 0.5) * BRICK_W * 0.6,
            y: y + (Math.random() - 0.5) * BRICK_H * 0.4,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v - 30,
            gravity,
            size: size * (0.6 + Math.random() * 0.8),
            color: colors[i % colors.length],
            t: 0,
            life,
        });
    }
}

function renderBits(ctx, now) {
    const dt = Math.min(now - lastFxTime, 0.05);
    lastFxTime = now;
    bits = bits.filter((b) => (b.t += dt) < b.life);
    for (const b of bits) {
        b.vy += b.gravity * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        ctx.globalAlpha = 1 - b.t / b.life;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
    }
    ctx.globalAlpha = 1;
}

function shake() {
    if (reduceMotion.matches) return;
    field.animate(
        [
            { transform: 'translate(0, 0)' },
            { transform: 'translate(-4px, 3px)' },
            { transform: 'translate(4px, -2px)' },
            { transform: 'translate(-2px, 1px)' },
            { transform: 'translate(0, 0)' },
        ],
        { duration: 350, easing: 'ease-out' }
    );
}

// ---------- 狀態 ----------

let state = 'ready';
let game = null;
let ctx = null;
let scale = 1;
let overAt = 0;
let overStart = 0;
// 擋板畫面寬度：加長 / 縮短時以動畫過渡
let shownPaddleW = null;
const input = { dir: 0, target: null, launch: false, fire: false };
const shown = {};

// ---------- 繪圖 ----------

function render(now) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.drawImage(backdrop, 0, 0, WIDTH, HEIGHT);

    for (const brick of game.bricks) drawBrick(ctx, brick, game.level, now);
    for (const capsule of game.capsules) drawCapsule(ctx, capsule, now);
    for (const laser of game.lasers) drawLaser(ctx, laser);

    const { paddle } = game;
    if (shownPaddleW === null || reduceMotion.matches) shownPaddleW = paddle.w;
    else shownPaddleW += (paddle.w - shownPaddleW) * 0.25;
    const center = paddle.x + paddle.w / 2;
    drawPaddle(ctx, center - shownPaddleW / 2, shownPaddleW, game.mode);

    for (const ball of game.balls) drawBall(ctx, ball);
    renderBits(ctx, now);
    ctx.restore();
}

const draw = () => render(performance.now() / 1000);

function setText(key, value, element) {
    if (shown[key] === value) return;
    shown[key] = value;
    element.textContent = value;
}

function renderHud() {
    setText('score', formatNumber(game.score), $('score'));
    const record = best.get();
    setText('best', record === null ? '–' : formatNumber(record), $('best'));
    setText('level', String(game.level), $('level'));
    const lives = Math.max(game.lives, 0);
    if (shown.lives !== lives) {
        shown.lives = lives;
        const element = $('lives');
        // 5 條命以內畫小球，再多就顯示數字
        const dots = Array.from({ length: Math.min(lives, 5) }, () => document.createElement('i'));
        const extra = lives > 5 ? [Object.assign(document.createElement('span'), { textContent: `+${lives - 5}` })] : [];
        element.replaceChildren(...dots, ...extra);
        element.setAttribute('aria-label', `${lives} ${lives === 1 ? 'life' : 'lives'}`);
    }
}

// ---------- 版面尺寸：直向場地，盡量大 ----------

function layout() {
    const dpr = devicePixelRatio || 1;
    const available = Math.min(fieldArea.clientWidth / WIDTH, fieldArea.clientHeight / HEIGHT);
    const next = Math.max(0.75, Math.floor(available * dpr * 4) / (dpr * 4));
    if (next !== scale || !ctx) {
        scale = next;
        const w = Math.round(WIDTH * scale);
        const h = Math.round(HEIGHT * scale);
        field.style.width = `${w}px`;
        field.style.height = `${h}px`;
        root.style.setProperty('--board-width', `${w}px`);
        ctx = setupCanvas(boardCanvas, w, h);
        rebuildBackdrop();
    }
    draw();
}

new ResizeObserver(layout).observe(fieldArea);

// ---------- 遊戲事件 → 畫面特效 ----------

const PICKUP_TEXT = {
    E: 'Expand',
    S: 'Slow',
    C: 'Catch',
    L: 'Laser',
    D: 'Disrupt',
    P: 'Extra life',
};

function showCallout(title, detail = '', { pickup = false } = {}) {
    const small = detail ? [Object.assign(document.createElement('small'), { textContent: detail })] : [];
    callout.replaceChildren(title, ...small);
    callout.classList.toggle('is-pickup', pickup);
    callout.classList.remove('is-showing');
    void callout.offsetWidth;
    callout.classList.add('is-showing');
}

function handleEvents() {
    const now = performance.now() / 1000;
    for (const event of game.takeEvents()) {
        switch (event.type) {
            case 'level-start':
                showCallout(`Level ${event.level}`, game.balls[0]?.stuck ? 'Launch when ready' : '');
                break;
            case 'level-clear':
                showCallout('Level clear');
                break;
            case 'brick-hit':
                flashes.set(brickKey(event.x, event.y), now);
                burst(event.x, event.y, 3, ['#ffffff', BRICK_COLORS[event.kind]], { speed: 40, size: 1 });
                break;
            case 'brick-break': {
                const base = BRICK_COLORS[event.kind];
                burst(event.x, event.y, 10, [base, base, '#ffffff']);
                break;
            }
            case 'pickup':
                showCallout(PICKUP_TEXT[event.kind], '', { pickup: true });
                burst(event.x, event.y, 8, [CAPSULE_COLORS[event.kind], '#ffffff'], { speed: 50, gravity: 0 });
                break;
            case 'ball-lost':
                burst(event.x, HEIGHT - 2, 8, [C['paddle-end'], '#ffffff'], { speed: 70, gravity: 120 });
                break;
            case 'life-lost':
                shake();
                break;
            case 'game-over':
                overStart = performance.now();
                break;
        }
    }
}

// ---------- 遊戲流程 ----------

let launchPulse = false;

const loop = createLoop({
    update(dt) {
        if (state !== 'playing') return;
        if (game.over) {
            if (performance.now() - overStart > OVER_DELAY_MS) finish();
            return;
        }
        input.launch = keyLaunch || launchPulse;
        input.fire = keyLaunch || pointerHeld;
        game.update(dt, input);
        launchPulse = false;
        handleEvents();
    },
    render() {
        draw();
        renderHud();
    },
});

function releaseInputs() {
    heldDirs.length = 0;
    keyLaunch = false;
    pointerHeld = false;
    launchPulse = false;
    drag = null;
    input.dir = 0;
}

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
    if (next === 'playing') {
        if (!loop.running) lastFxTime = performance.now() / 1000;
        loop.start();
    } else {
        loop.stop();
        releaseInputs();
    }
}

function start() {
    game = createBreakout();
    bits = [];
    flashes.clear();
    shownPaddleW = null;
    input.target = null;
    for (const key of Object.keys(shown)) delete shown[key];
    document.activeElement?.blur();
    handleEvents();
    renderHud();
    setState('playing');
}

function pause() {
    if (state !== 'playing' || game.over) return;
    setState('paused');
    draw();
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
    note.textContent = isRecord ? `Level ${game.level} · New best score` : `Level ${game.level} · Best ${formatNumber(record ?? 0)}`;
    note.classList.toggle('is-record', isRecord);
    overAt = performance.now();
    setState('over');
    renderHud();
    draw();
}

// ---------- 操作：鍵盤 ----------

const DIR_KEYS = { ArrowLeft: -1, a: -1, ArrowRight: 1, d: 1 };
const LAUNCH_KEYS = new Set([' ', 'ArrowUp', 'w']);
const keyOf = (event) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);
const heldDirs = [];
let keyLaunch = false;

addEventListener('keydown', (event) => {
    const key = keyOf(event);
    const dir = DIR_KEYS[key];
    if (state === 'playing') {
        if (dir) {
            event.preventDefault();
            // 改用鍵盤時放掉滑鼠位置，直到滑鼠再移動
            input.target = null;
            if (heldDirs.at(-1) !== dir) {
                const i = heldDirs.indexOf(dir);
                if (i >= 0) heldDirs.splice(i, 1);
                heldDirs.push(dir);
            }
            input.dir = heldDirs.at(-1) ?? 0;
        } else if (LAUNCH_KEYS.has(key)) {
            event.preventDefault();
            keyLaunch = true;
        } else if ((key === 'p' || key === 'Escape') && !event.repeat) {
            pause();
        }
        return;
    }
    if ((key === 'p' || key === 'Escape') && state === 'paused' && !event.repeat) {
        resume();
        return;
    }
    const onButton = event.target instanceof HTMLButtonElement;
    if ((key === 'Enter' || key === ' ') && !onButton) {
        event.preventDefault();
        if (event.repeat || (state === 'over' && performance.now() - overAt < RESTART_GRACE_MS)) return;
        if (state === 'paused') resume();
        else start();
    }
});

addEventListener('keyup', (event) => {
    const key = keyOf(event);
    const dir = DIR_KEYS[key];
    if (dir) {
        const i = heldDirs.indexOf(dir);
        if (i >= 0) heldDirs.splice(i, 1);
        input.dir = heldDirs.at(-1) ?? 0;
    }
    if (LAUNCH_KEYS.has(key)) keyLaunch = false;
});

document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'start' || action === 'restart') start();
    else if (action === 'resume') resume();
});

$('pause-btn').addEventListener('click', pause);

// ---------- 操作：滑鼠與觸控 ----------
// 滑鼠：擋板跟著游標，按住開火、放開發射
// 觸控：整個畫面都能拖曳（相對移動，手指不會擋住擋板），按住開火、放開發射

let pointerHeld = false;
let drag = null;

const toLogicalX = (clientX) => (clientX - field.getBoundingClientRect().left) / scale;

root.addEventListener('pointermove', (event) => {
    if (state !== 'playing') return;
    if (event.pointerType === 'mouse') {
        input.target = toLogicalX(event.clientX);
    } else if (drag && event.pointerId === drag.id) {
        input.target = drag.center + ((event.clientX - drag.x) / scale) * DRAG_GAIN;
    }
});

root.addEventListener('pointerdown', (event) => {
    if (state !== 'playing' || event.target.closest('button')) return;
    pointerHeld = true;
    if (event.pointerType === 'mouse') {
        input.target = toLogicalX(event.clientX);
    } else {
        event.preventDefault();
        root.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, x: event.clientX, center: game.paddle.x + game.paddle.w / 2 };
    }
});

function release(event) {
    if (!pointerHeld) return;
    if (drag && event.pointerId !== drag.id) return;
    pointerHeld = false;
    drag = null;
    if (state === 'playing' && event.type === 'pointerup') launchPulse = true;
}

root.addEventListener('pointerup', release);
root.addEventListener('pointercancel', release);
root.addEventListener('contextmenu', (event) => {
    if (state === 'playing') event.preventDefault();
});

autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動：示意盤面 ----------

function demoGame() {
    const demo = createBreakout({ random: () => 0.5 });
    demo.takeEvents();
    // 打掉一些磚，看起來像玩到一半
    const gone = new Set(['5,1', '6,1', '5,2', '6,2', '7,2', '4,3', '5,3', '6,3', '7,3', '2,5', '9,4', '10,5']);
    demo.bricks = demo.bricks.filter((b) => !gone.has(`${b.col},${b.row}`));
    demo.bricks.find((b) => b.kind === 's' && b.col === 3).hp = 1;
    demo.paddle.x = 120;
    Object.assign(demo.balls[0], { x: 186, y: 250, vx: 80, vy: -200, stuck: null });
    demo.capsules.push({ kind: 'L', x: 70, y: 210 });
    return demo;
}

game = demoGame();
setState('ready');
layout();
renderHud();
