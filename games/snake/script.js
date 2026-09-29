// 貪食蛇：畫面與操作。遊戲規則在 core.js
import { COLS, ROWS, BONUS_DURATION, createSnake } from './core.js';
import { setupCanvas, createLoop, autoPause, highScore } from '../../shared/game-utils.js';

// 撞到後停留多久才顯示結算畫面
const DEATH_PAUSE = 0.9;
// Game over 後這段時間內不接受鍵盤重新開始
const RESTART_GRACE_MS = 800;

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.snake');
const fieldArea = $('field-area');
const field = $('field');
const boardCanvas = $('board');
const callout = $('callout');
const overlays = { ready: $('overlay-ready'), paused: $('overlay-paused'), over: $('overlay-over') };
const hud = { score: $('score'), length: $('length'), best: $('best') };

const best = highScore('snake');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const styles = getComputedStyle(document.documentElement);
const color = (name) => styles.getPropertyValue(name).trim();
const C = {
    fieldA: color('--field-a'),
    fieldB: color('--field-b'),
    head: color('--snake-head'),
    tail: color('--snake-tail'),
    outline: color('--snake-outline'),
    fruit: color('--fruit'),
    leaf: color('--fruit-leaf'),
    stem: color('--fruit-stem'),
    bonus: color('--bonus'),
};

const formatNumber = (n) => n.toLocaleString('en-US');

// ---------- 圖形 ----------

// 果實與星星：24×24 的 SVG 路徑
const APPLE = new Path2D(
    'M12 7.2c-1.6-1.2-4.7-1.6-6.6.4C3.3 9.8 3.6 14.2 5.6 17.4c1.3 2.1 3 3.6 4.6 3.2.7-.2 1.2-.5 1.8-.5s1.1.3 1.8.5c1.6.4 3.3-1.1 4.6-3.2 2-3.2 2.3-7.6.2-9.8-1.9-2-5-1.6-6.6-.4z'
);
const STEM = new Path2D('M12 7.6c0-2 .5-3.4 1.6-4.6');
const LEAF = new Path2D('M13.2 5.3c.8-1.8 2.6-2.7 4.7-2.3-.5 2-2.4 3.1-4.7 2.3z');
const SHINE = new Path2D('M7.6 10.2c.5-1 1.3-1.6 2.1-1.8');
const STAR = new Path2D('M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z');

function hexToRgb(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
}

function mixColor(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return `rgb(${ca.map((v, i) => Math.round(v + (cb[i] - v) * t)).join(', ')})`;
}

const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

// ---------- 狀態 ----------

let state = 'ready';
let game = null;
let cell = 20;
let ctx = null;
let fieldLayer = null;
let deathTime = 0;
let overAt = 0;
let effects = [];
let particles = [];
let lastRenderTime = 0;
// 果實出現的時間（出現時彈出）與被吃掉的位置（頭抵達前逐漸縮小）
let foodKey = '';
let foodBorn = 0;
let swallowed = null;
let nextBlink = 2;
const shown = {};

// 開始畫面後方的示意畫面（也是首頁縮圖）
function demoGame() {
    const demo = createSnake({ random: () => 0.3 });
    const path = [];
    for (let x = 12; x >= 4; x--) path.push({ x, y: 16 });
    for (let y = 17; y <= 18; y++) path.push({ x: 4, y });
    for (let x = 5; x <= 10; x++) path.push({ x, y: 18 });
    demo.body = path;
    demo.dir = { x: 1, y: 0 };
    demo.food = { x: 16, y: 16 };
    demo.bonus = { x: 15, y: 3, time: BONUS_DURATION * 0.7 };
    demo.bulges = [5];
    return demo;
}

// ---------- 繪圖 ----------

function buildFieldLayer() {
    fieldLayer = document.createElement('canvas');
    const layer = setupCanvas(fieldLayer, cell * COLS, cell * ROWS, { setStyle: false });
    layer.fillStyle = C.fieldA;
    layer.fillRect(0, 0, cell * COLS, cell * ROWS);
    layer.fillStyle = C.fieldB;
    for (let y = 0; y < ROWS; y++) {
        for (let x = (y % 2) ^ 1; x < COLS; x += 2) layer.fillRect(x * cell, y * cell, cell, cell);
    }
}

const center = ({ x, y }) => ({ x: (x + 0.5) * cell, y: (y + 0.5) * cell });

function drawIcon(path, x, y, size, draw) {
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    draw(path);
    ctx.restore();
}

function drawApple(x, y, size) {
    drawIcon(APPLE, x, y, size, () => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(12, 21.6, 6, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.fruit;
        ctx.fill(APPLE);
        ctx.lineCap = 'round';
        ctx.strokeStyle = C.stem;
        ctx.lineWidth = 1.6;
        ctx.stroke(STEM);
        ctx.fillStyle = C.leaf;
        ctx.fill(LEAF);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1.4;
        ctx.stroke(SHINE);
    });
}

function drawStar(x, y, size, remaining, now) {
    // 剩餘時間環
    ctx.strokeStyle = C.bonus;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(1.5, cell * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining);
    ctx.stroke();
    ctx.globalAlpha = remaining < 0.25 && Math.sin(now * 20) < 0 ? 0.35 : 1;
    drawIcon(STAR, x, y, size, () => {
        ctx.shadowColor = C.bonus;
        ctx.shadowBlur = 8;
        ctx.fillStyle = C.bonus;
        ctx.fill(STAR);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke(STAR);
    });
    ctx.globalAlpha = 1;
}

// 蛇的中心線：頭在上一格與目前格之間、尾巴在舊尾巴與目前尾巴之間，隨進度平滑移動
function snakePoints(progress) {
    const body = game.body;
    const points = [];
    if (body.length < 2) return body.map(center);
    const head = center(body[0]);
    const neck = center(body[1]);
    points.push({ x: lerp(neck.x, head.x, progress), y: lerp(neck.y, head.y, progress) });
    for (let i = 1; i < body.length; i++) points.push(center(body[i]));
    if (game.prevTail) {
        const tail = center(body.at(-1));
        const old = center(game.prevTail);
        points.push({ x: lerp(old.x, tail.x, progress), y: lerp(old.y, tail.y, progress) });
    }
    return points;
}

function drawSnake(now, progress) {
    const points = snakePoints(progress);
    const n = points.length;
    const dead = game.over && !game.won;
    // 死亡時閃爍
    const flash = dead && !reduceMotion.matches && Math.floor((now - deathTime) * 8) % 2 === 0;
    const widthAt = (i) => cell * lerp(0.8, 0.46, i / Math.max(n - 1, 1));
    const colorAt = (i) => (flash ? '#d8d8d8' : mixColor(C.head, C.tail, i / Math.max(n - 1, 1)));

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 外框先畫完，再由尾到頭畫身體，頭在最上層
    for (let pass = 0; pass < 2; pass++) {
        for (let i = n - 2; i >= 0; i--) {
            ctx.strokeStyle = pass === 0 ? C.outline : colorAt(i);
            ctx.lineWidth = widthAt(i) + (pass === 0 ? cell * 0.14 : 0);
            ctx.beginPath();
            ctx.moveTo(points[i + 1].x, points[i + 1].y);
            ctx.lineTo(points[i].x, points[i].y);
            ctx.stroke();
        }
    }

    // 吞下的果實：在身體裡鼓起一塊，尾巴經過後消失
    for (const index of game.bulges) {
        if (index < 1 || index >= game.body.length - 1) continue;
        const { x, y } = center(game.body[index]);
        const t = index / Math.max(n - 1, 1);
        ctx.fillStyle = C.outline;
        ctx.beginPath();
        ctx.arc(x, y, widthAt(index) * 0.5 + cell * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = flash ? '#d8d8d8' : mixColor(C.head, C.tail, t);
        ctx.beginPath();
        ctx.arc(x, y, widthAt(index) * 0.5 + cell * 0.09, 0, Math.PI * 2);
        ctx.fill();
    }

    // 背上的亮線
    if (!flash) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = cell * 0.12;
        ctx.beginPath();
        points.slice(0, Math.max(2, Math.floor(n * 0.7))).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
    }

    drawHead(points[0], now, dead);
}

function drawHead(point, now, dead) {
    const { dir } = game;
    const size = cell * 0.46;
    ctx.fillStyle = C.outline;
    ctx.beginPath();
    ctx.arc(point.x, point.y, size + cell * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dead ? '#d8d8d8' : C.head;
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.fill();

    // 眼睛：位在前進方向兩側，瞳孔看向果實
    const side = { x: -dir.y, y: dir.x };
    const forward = cell * 0.12;
    const spread = cell * 0.22;
    const eyeR = cell * 0.13;
    const target = game.food ? center(game.food) : { x: point.x + dir.x, y: point.y + dir.y };
    const look = Math.hypot(target.x - point.x, target.y - point.y) || 1;
    if (now > nextBlink + 0.14) nextBlink = now + 2 + Math.random() * 3;
    const blinking = now > nextBlink;

    for (const s of [-1, 1]) {
        const ex = point.x + dir.x * forward + side.x * spread * s;
        const ey = point.y + dir.y * forward + side.y * spread * s;
        if (dead) {
            ctx.strokeStyle = C.outline;
            ctx.lineWidth = cell * 0.06;
            const r = eyeR * 0.8;
            ctx.beginPath();
            ctx.moveTo(ex - r, ey - r);
            ctx.lineTo(ex + r, ey + r);
            ctx.moveTo(ex + r, ey - r);
            ctx.lineTo(ex - r, ey + r);
            ctx.stroke();
            continue;
        }
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(ex, ey, eyeR, blinking ? eyeR * 0.15 : eyeR, 0, 0, Math.PI * 2);
        ctx.fill();
        if (blinking) continue;
        ctx.fillStyle = '#10150f';
        ctx.beginPath();
        ctx.arc(
            ex + ((target.x - point.x) / look) * eyeR * 0.4,
            ey + ((target.y - point.y) / look) * eyeR * 0.4,
            eyeR * 0.55,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }
}

function render(now, progress) {
    const width = cell * COLS;
    const height = cell * ROWS;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(fieldLayer, 0, 0, width, height);

    // 果實：出現時彈出，平常輕輕上下浮動
    if (game.food) {
        const key = `${game.food.x},${game.food.y}`;
        if (key !== foodKey) {
            foodKey = key;
            foodBorn = now;
        }
        const born = state === 'playing' ? Math.min((now - foodBorn) / 0.3, 1) : 1;
        const bob = reduceMotion.matches ? 0 : Math.sin(now * 3) * cell * 0.04;
        const { x, y } = center(game.food);
        drawApple(x, y + bob, cell * 1.2 * easeOutBack(born));
    }
    if (game.bonus) {
        const { x, y } = center(game.bonus);
        drawStar(x, y, cell * 1.1, Math.max(game.bonus.time / BONUS_DURATION, 0), now);
    }
    // 頭還沒抵達的那一步，被吃掉的果實留在原地縮小
    if (swallowed && progress < 1 && swallowed.step === stepCount) {
        const { x, y } = center(swallowed.at);
        const size = cell * 1.2 * (1 - progress);
        if (swallowed.kind === 'food') drawApple(x, y, size);
        else drawStar(x, y, size, 0, now);
    }

    drawSnake(now, progress);
    renderEffects(now);
}

function renderEffects(now) {
    effects = effects.filter((effect) => now - effect.start < effect.duration);
    for (const effect of effects) {
        const t = (now - effect.start) / effect.duration;
        const { x, y } = center(effect.at);
        if (effect.kind === 'ring') {
            ctx.strokeStyle = effect.color;
            ctx.globalAlpha = 1 - t;
            ctx.lineWidth = cell * 0.12 * (1 - t) + 1;
            ctx.beginPath();
            ctx.arc(x, y, cell * (0.4 + t * 0.9), 0, Math.PI * 2);
            ctx.stroke();
        } else if (effect.kind === 'points') {
            ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
            ctx.fillStyle = effect.color;
            ctx.font = `800 ${Math.round(cell * 0.7)}px ${styles.getPropertyValue('--font-sans')}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 6;
            ctx.fillText(effect.text, x, y - cell * (0.6 + t * 0.9));
            ctx.shadowBlur = 0;
        }
    }
    ctx.globalAlpha = 1;

    const dt = Math.min(now - lastRenderTime, 0.05);
    lastRenderTime = now;
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.9;
        p.vy *= 0.9;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function renderHud() {
    setText('score', formatNumber(game.score));
    setText('length', String(game.body.length));
    const record = best.get();
    setText('best', record === null ? '–' : formatNumber(record));
}

function setText(key, value) {
    if (shown[key] === value) return;
    shown[key] = value;
    hud[key].textContent = value;
}

function currentProgress() {
    if (state === 'dying' || state === 'over' || state === 'ready') return 1;
    return game.started ? game.progress : 1;
}

function draw() {
    render(performance.now() / 1000, currentProgress());
}

// ---------- 版面尺寸 ----------

function layout() {
    const size = Math.min(fieldArea.clientWidth, fieldArea.clientHeight);
    const next = Math.max(10, Math.floor(size / COLS));
    if (next !== cell || !ctx) {
        cell = next;
        field.style.width = `${cell * COLS}px`;
        field.style.height = `${cell * ROWS}px`;
        root.style.setProperty('--board-size', `${cell * COLS}px`);
        ctx = setupCanvas(boardCanvas, cell * COLS, cell * ROWS);
        buildFieldLayer();
    }
    draw();
}

new ResizeObserver(layout).observe(fieldArea);

// ---------- 遊戲事件 → 畫面特效 ----------

let stepCount = 0;

function burst(at, colorValue, count) {
    if (reduceMotion.matches) return;
    const { x, y } = center(at);
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const speed = cell * (3 + Math.random() * 4);
        const life = 0.35 + Math.random() * 0.25;
        particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: cell * (0.06 + Math.random() * 0.06),
            color: colorValue,
            life,
            maxLife: life,
        });
    }
}

function showCallout(text) {
    callout.textContent = text;
    callout.classList.remove('is-showing');
    void callout.offsetWidth;
    callout.classList.add('is-showing');
}

function handleEvents(now) {
    for (const event of game.takeEvents()) {
        switch (event.type) {
            case 'eat': {
                const tint = event.kind === 'bonus' ? C.bonus : C.fruit;
                swallowed = { at: event.at, kind: event.kind, step: stepCount };
                effects.push({ kind: 'ring', at: event.at, start: now, duration: 0.35, color: tint });
                effects.push({ kind: 'points', at: event.at, start: now, duration: 0.8, color: tint, text: `+${event.points}` });
                burst(event.at, tint, event.kind === 'bonus' ? 14 : 8);
                break;
            }
            case 'bonus':
                effects.push({ kind: 'ring', at: event.at, start: now, duration: 0.5, color: C.bonus });
                break;
            case 'die':
                deathTime = now;
                setState('dying');
                if (!reduceMotion.matches) {
                    field.classList.remove('is-shake');
                    void field.offsetWidth;
                    field.classList.add('is-shake');
                }
                break;
            case 'win':
                showCallout('You filled the field');
                deathTime = now;
                setState('dying');
                break;
        }
    }
}

// ---------- 遊戲流程 ----------

const loop = createLoop({
    update(dt) {
        if (state === 'dying') {
            if (performance.now() / 1000 - deathTime >= DEATH_PAUSE) finish();
            return;
        }
        if (state !== 'playing') return;
        stepCount += game.update(dt);
        handleEvents(performance.now() / 1000);
    },
    render() {
        draw();
        if (game) renderHud();
    },
});

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
    if (next === 'playing' || next === 'dying') {
        if (!loop.running) lastRenderTime = performance.now() / 1000;
        loop.start();
    } else {
        loop.stop();
    }
}

function start(direction) {
    game = createSnake();
    effects = [];
    particles = [];
    swallowed = null;
    stepCount = 0;
    callout.classList.remove('is-showing');
    if (direction) game.turn(direction);
    game.start();
    renderHud();
    document.activeElement?.blur();
    setState('playing');
}

function pause() {
    if (state !== 'playing') return;
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
    $('over-title').textContent = game.won ? 'You win' : 'Game over';
    $('final-score').textContent = formatNumber(game.score);
    const note = $('final-note');
    const record = best.get();
    note.textContent = isRecord
        ? 'New best score'
        : `Length ${game.body.length}. Best ${formatNumber(record ?? 0)}`;
    note.classList.toggle('is-record', isRecord);
    shown.best = null;
    overAt = performance.now();
    setState('over');
    renderHud();
    draw();
}

// 開始畫面 / 結束畫面按方向鍵或滑動：直接用那個方向開始新的一局
function steer(direction) {
    if (state === 'playing') {
        game.turn(direction);
    } else if (state === 'ready' || (state === 'over' && performance.now() - overAt >= RESTART_GRACE_MS)) {
        start(direction);
    } else if (state === 'paused') {
        resume();
        game.turn(direction);
    }
}

// ---------- 操作 ----------

const KEYS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
};

addEventListener('keydown', (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const direction = KEYS[key];
    if (direction) {
        event.preventDefault();
        steer(direction);
        return;
    }
    if (key === 'p' || key === 'Escape') {
        if (event.repeat) return;
        if (state === 'playing') pause();
        else if (state === 'paused') resume();
        return;
    }
    const onButton = event.target instanceof HTMLButtonElement;
    if ((key === 'Enter' || key === ' ') && !onButton && state !== 'playing') {
        event.preventDefault();
        if (event.repeat || (state === 'over' && performance.now() - overAt < RESTART_GRACE_MS)) return;
        if (state === 'paused') resume();
        else if (state === 'ready' || state === 'over') start();
    } else if (key === ' ' && state === 'playing') {
        event.preventDefault();
    }
});

document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'start' || action === 'restart') start();
    else if (action === 'resume') resume();
});

$('pause-btn').addEventListener('click', pause);

for (const button of document.querySelectorAll('.pad__btn')) {
    button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.classList.add('is-pressed');
        steer(button.dataset.dir);
    });
    const up = () => button.classList.remove('is-pressed');
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
}

// 場地滑動：手指不用放開，每滑過一段距離就轉向一次
let swipe = null;
field.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || event.target.closest('button')) return;
    swipe = { x: event.clientX, y: event.clientY };
});

field.addEventListener('pointermove', (event) => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < Math.max(18, cell * 0.8)) return;
    const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    steer(direction);
    swipe = { x: event.clientX, y: event.clientY };
});

const endSwipe = () => {
    swipe = null;
};
field.addEventListener('pointerup', endSwipe);
field.addEventListener('pointercancel', endSwipe);

// 切換分頁或視窗失焦時暫停；回來後由玩家自己按繼續
autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動 ----------

game = demoGame();
setState('ready');
layout();
// 示意畫面的分數 / 長度不顯示，只顯示最佳紀錄
const record = best.get();
if (record !== null) hud.best.textContent = formatNumber(record);
