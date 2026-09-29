// 太空侵略者：畫面與操作。遊戲規則在 core.js
import { WIDTH, HEIGHT, PLAYER_Y, SPRITES, createInvaders } from './core.js';
import { setupCanvas, createLoop, autoPause, highScore } from '../../shared/game-utils.js';

// Game over 後這段時間內不接受鍵盤重新開始
const RESTART_GRACE_MS = 800;
// 觸控拖曳的移動倍率：手指移動 1 單位，飛船移動 TOUCH_GAIN 單位
const TOUCH_GAIN = 1.4;
const GROUND_Y = PLAYER_Y + 12;

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.invaders');
const fieldArea = $('field-area');
const field = $('field');
const boardCanvas = $('board');
const callout = $('callout');
const overlays = { ready: $('overlay-ready'), paused: $('overlay-paused'), over: $('overlay-over') };
const hud = { score: $('score'), wave: $('wave'), lives: $('lives'), best: $('best') };

const best = highScore('space-invaders');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const styles = getComputedStyle(document.documentElement);
const color = (name) => styles.getPropertyValue(name).trim();
const C = {
    top: color('--space-top'),
    bottom: color('--space-bottom'),
    squid: color('--alien-squid'),
    crab: color('--alien-crab'),
    octopus: color('--alien-octopus'),
    player: color('--ship'),
    ufo: color('--ufo'),
    shield: color('--shield'),
    bomb: color('--bomb'),
};

const formatNumber = (n) => n.toLocaleString('en-US');

// ---------- 像素圖 → 預先繪製（含光暈） ----------

let scale = 2;
const sprites = new Map();

// 光暈邊距（邏輯像素）
const GLOW = 3;

function paintPixels(ctx, rows, fill, ox = 0, oy = 0) {
    ctx.fillStyle = fill;
    rows.forEach((row, y) => {
        // 同一列連續的實心格合併成一個矩形
        let start = -1;
        for (let x = 0; x <= row.length; x++) {
            if (row[x] === '#' && start < 0) start = x;
            if (row[x] !== '#' && start >= 0) {
                ctx.fillRect(ox + start, oy + y, x - start, 1);
                start = -1;
            }
        }
    });
}

function sprite(name, frame = 0, tint = C[name]) {
    const key = `${name}:${frame}:${scale}:${tint}`;
    let canvas = sprites.get(key);
    if (canvas) return canvas;
    const rows = SPRITES[name][frame % SPRITES[name].length];
    const w = rows[0].length + GLOW * 2;
    const h = rows.length + GLOW * 2;
    canvas = document.createElement('canvas');
    const ctx = setupCanvas(canvas, w * scale, h * scale, { setStyle: false });
    ctx.scale(scale, scale);
    ctx.shadowColor = tint;
    ctx.shadowBlur = 2.5 * scale * (devicePixelRatio || 1);
    paintPixels(ctx, rows, tint, GLOW, GLOW);
    ctx.shadowBlur = 0;
    // 上半部稍亮，增加一點立體感
    ctx.globalAlpha = 0.25;
    paintPixels(ctx, rows.slice(0, Math.ceil(rows.length / 2)), '#fff', GLOW, GLOW);
    sprites.set(key, canvas);
    return canvas;
}

function drawSprite(ctx, name, frame, x, y, tint) {
    const image = sprite(name, frame, tint);
    ctx.drawImage(image, x - GLOW, y - GLOW, image.width / (devicePixelRatio || 1) / scale, image.height / (devicePixelRatio || 1) / scale);
}

// 分數說明表裡的小圖
function drawPointIcons() {
    for (const canvas of document.querySelectorAll('.points__icon')) {
        const name = canvas.dataset.sprite;
        const rows = SPRITES[name][0];
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w) continue;
        const ctx = setupCanvas(canvas, w, h, { setStyle: false });
        const size = Math.floor(Math.min(w / rows[0].length, h / rows.length) * 4) / 4;
        ctx.translate((w - rows[0].length * size) / 2, (h - rows.length * size) / 2);
        ctx.scale(size, size);
        paintPixels(ctx, rows, C[name]);
    }
}

// 命數圖示：飛船像素圖轉成 SVG path
const SHIP_PATH = SPRITES.player[0]
    .flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `M${x} ${y}h1v1h-1z` : '')))
    .join('');

// ---------- 背景星空 ----------

const stars = Array.from({ length: 70 }, () => ({
    x: Math.random() * WIDTH,
    y: Math.random() * (GROUND_Y - 8),
    size: Math.random() < 0.15 ? 1 : 0.5,
    phase: Math.random() * Math.PI * 2,
    speed: 0.6 + Math.random() * 1.6,
}));

// ---------- 狀態 ----------

let state = 'ready';
let game = null;
let ctx = null;
let overAt = 0;
let effects = [];
let particles = [];
let lastRenderTime = 0;
let invincibleUntil = 0;
const input = { left: false, right: false, fire: false, touchFire: false, targetX: undefined };
const shown = {};

// ---------- 繪圖 ----------

function renderBackground(now) {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, C.top);
    gradient.addColorStop(1, C.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = '#fff';
    for (const star of stars) {
        const twinkle = reduceMotion.matches ? 0.6 : 0.35 + 0.35 * Math.sin(now * star.speed + star.phase);
        ctx.globalAlpha = twinkle * (star.size === 1 ? 1 : 0.7);
        ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    // 地面
    ctx.fillStyle = C.shield;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(4, GROUND_Y, WIDTH - 8, 0.75);
    ctx.globalAlpha = 1;
}

function renderShields() {
    ctx.fillStyle = C.shield;
    ctx.shadowColor = C.shield;
    ctx.shadowBlur = 4 * scale;
    for (const shield of game.shields) {
        for (let y = 0; y < shield.h; y++) {
            let start = -1;
            for (let x = 0; x <= shield.w; x++) {
                const on = x < shield.w && shield.cells[y * shield.w + x] === 1;
                if (on && start < 0) start = x;
                if (!on && start >= 0) {
                    ctx.fillRect(shield.x + start, shield.y + y, x - start, 1);
                    start = -1;
                }
            }
        }
    }
    ctx.shadowBlur = 0;
}

function render(now) {
    ctx.save();
    ctx.scale(scale, scale);
    renderBackground(now);
    if (!game) {
        ctx.restore();
        return;
    }

    renderShields();

    for (const alien of game.aliens) {
        if (alien.alive) drawSprite(ctx, alien.type, game.frame, alien.x, alien.y);
    }
    if (game.ufo) drawSprite(ctx, 'ufo', 0, game.ufo.x, game.ufo.y);

    // 玩家：重生後短暫閃爍
    const blinking = now < invincibleUntil && Math.floor(now * 12) % 2 === 0;
    if (game.phase !== 'respawn' && !(game.phase === 'over' && game.lives <= 0) && !blinking) {
        drawSprite(ctx, 'player', 0, game.player.x, game.player.y);
    }

    ctx.shadowBlur = 4 * scale;
    ctx.shadowColor = '#fff';
    ctx.fillStyle = '#fff';
    for (const shot of game.shots) ctx.fillRect(shot.x, shot.y, 1, shot.h);

    ctx.shadowColor = C.bomb;
    ctx.fillStyle = C.bomb;
    for (const bomb of game.bombs) drawBomb(bomb, now);
    ctx.shadowBlur = 0;

    renderEffects(now);
    ctx.restore();
}

// 兩種炸彈：鋸齒（左右擺動）與十字（橫槓上下移動）
function drawBomb(bomb, now) {
    const t = Math.floor(now * 14 + bomb.x) % 4;
    if (bomb.kind === 'zigzag') {
        for (let i = 0; i < bomb.h; i++) {
            const offset = [0, 1, 0, -1][(i + t) % 4];
            ctx.fillRect(bomb.x + offset, bomb.y + i, 1, 1);
        }
    } else {
        ctx.fillRect(bomb.x, bomb.y, 1, bomb.h);
        ctx.fillRect(bomb.x - 1, bomb.y + 1 + (t % 3) * 2, 3, 1);
    }
}

function renderEffects(now) {
    effects = effects.filter((effect) => now - effect.start < effect.duration);
    for (const effect of effects) {
        const t = (now - effect.start) / effect.duration;
        ctx.globalAlpha = 1 - t;
        if (effect.kind === 'flash') {
            ctx.fillStyle = effect.color;
            const r = effect.radius * (0.4 + t);
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, r, 0, Math.PI * 2);
            ctx.fill();
        } else if (effect.kind === 'text') {
            ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
            ctx.fillStyle = effect.color;
            ctx.font = `800 8px ${styles.getPropertyValue('--font-sans')}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(effect.text, effect.x, effect.y - t * 6);
        }
    }
    ctx.globalAlpha = 1;

    const dt = Math.min(now - lastRenderTime, 0.05);
    lastRenderTime = now;
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 1.4);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

function renderHud() {
    setText('score', formatNumber(game.score));
    setText('wave', String(game.wave));
    if (shown.lives !== game.lives) {
        shown.lives = game.lives;
        const icons = Math.max(game.lives, 0);
        hud.lives.innerHTML =
            icons === 0
                ? '0'
                : Array.from(
                      { length: Math.min(icons, 6) },
                      () => `<svg viewBox="0 0 13 8" aria-hidden="true"><path d="${SHIP_PATH}"/></svg>`
                  ).join('');
        hud.lives.setAttribute('aria-label', `${icons} ${icons === 1 ? 'life' : 'lives'}`);
    }
    const record = best.get();
    setText('best', record === null ? '–' : formatNumber(record));
}

function setText(key, value) {
    if (shown[key] === value) return;
    shown[key] = value;
    hud[key].textContent = value;
}

const draw = () => render(performance.now() / 1000);

// ---------- 版面尺寸 ----------

function layout() {
    const dpr = devicePixelRatio || 1;
    const raw = Math.min(fieldArea.clientWidth / WIDTH, fieldArea.clientHeight / HEIGHT);
    // 盡量讓每個邏輯像素對齊整數個裝置像素（像素圖較銳利），但縮小超過 15% 時寧可用小數倍率
    const snapped = Math.floor(raw * dpr) / dpr;
    const next = Math.max(snapped >= raw * 0.85 ? snapped : raw, 1 / dpr);
    if (next !== scale || !ctx) {
        scale = next;
        const w = Math.round(WIDTH * scale);
        const h = Math.round(HEIGHT * scale);
        field.style.width = `${w}px`;
        field.style.height = `${h}px`;
        root.style.setProperty('--board-width', `${w}px`);
        ctx = setupCanvas(boardCanvas, w, h);
        sprites.clear();
    }
    draw();
    drawPointIcons();
}

new ResizeObserver(layout).observe(fieldArea);

// ---------- 遊戲事件 → 畫面特效 ----------

function explode(x, y, tint, count, { speed = 60, gravity = 40, size = 1 } = {}) {
    if (reduceMotion.matches) return;
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.7);
        const life = 0.3 + Math.random() * 0.4;
        particles.push({
            x,
            y,
            vx: Math.cos(angle) * v,
            vy: Math.sin(angle) * v - speed * 0.2,
            gravity,
            size,
            color: tint,
            life,
            maxLife: life,
        });
    }
}

function shake() {
    if (reduceMotion.matches) return;
    field.classList.remove('is-shake');
    void field.offsetWidth;
    field.classList.add('is-shake');
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
            case 'alienKilled': {
                const tint = C[event.alien];
                effects.push({ kind: 'flash', x: event.x, y: event.y, radius: 7, color: tint, start: now, duration: 0.18 });
                explode(event.x, event.y, tint, 14);
                break;
            }
            case 'ufoKilled':
                effects.push({ kind: 'flash', x: event.x, y: event.y, radius: 12, color: C.ufo, start: now, duration: 0.3 });
                effects.push({ kind: 'text', x: event.x, y: event.y, text: String(event.points), color: C.ufo, start: now, duration: 1.4 });
                explode(event.x, event.y, C.ufo, 24, { speed: 80 });
                break;
            case 'shieldHit':
                explode(event.x, event.y, C.shield, 4, { speed: 30, gravity: 60 });
                break;
            case 'clash':
                effects.push({ kind: 'flash', x: event.x, y: event.y, radius: 4, color: '#fff', start: now, duration: 0.15 });
                explode(event.x, event.y, C.bomb, 6, { speed: 40 });
                break;
            case 'bombLanded':
                explode(event.x, event.y, C.bomb, 3, { speed: 20, gravity: 30 });
                break;
            case 'playerHit':
                effects.push({ kind: 'flash', x: event.x, y: event.y, radius: 14, color: C.player, start: now, duration: 0.35 });
                explode(event.x, event.y, C.player, 30, { speed: 70, gravity: 50 });
                shake();
                break;
            case 'respawn':
                invincibleUntil = now + 1;
                break;
            case 'waveClear':
                showCallout(`Wave ${event.wave + 1}`);
                break;
            case 'extraLife':
                showCallout('Extra life');
                break;
            case 'gameOver':
                if (event.cause === 'invaded') shake();
                // 等爆炸播完再顯示結算
                setTimeout(finish, event.cause === 'invaded' ? 900 : 1100);
                break;
        }
    }
}

// ---------- 遊戲流程 ----------

const loop = createLoop({
    update(dt) {
        if (state !== 'playing' || !game) return;
        game.update(dt, {
            left: input.left,
            right: input.right,
            fire: input.fire || input.touchFire,
            targetX: input.targetX,
        });
        handleEvents(performance.now() / 1000);
    },
    render() {
        draw();
        renderHud();
    },
});

function setState(next) {
    state = next;
    root.dataset.state = next;
    for (const [name, element] of Object.entries(overlays)) element.hidden = name !== next;
    if (next === 'playing') {
        if (!loop.running) lastRenderTime = performance.now() / 1000;
        loop.start();
    } else {
        loop.stop();
        Object.assign(input, { left: false, right: false, fire: false, touchFire: false, targetX: undefined });
    }
}

function start() {
    game = createInvaders();
    effects = [];
    particles = [];
    invincibleUntil = 0;
    callout.classList.remove('is-showing');
    game.takeEvents();
    renderHud();
    document.activeElement?.blur();
    setState('playing');
}

function pause() {
    if (state !== 'playing' || game.phase === 'over') return;
    setState('paused');
    draw();
}

function resume() {
    if (state !== 'paused') return;
    document.activeElement?.blur();
    setState('playing');
}

function finish() {
    if (state !== 'playing' || game.phase !== 'over') return;
    const isRecord = best.submit(game.score);
    $('final-score').textContent = formatNumber(game.score);
    const note = $('final-note');
    const record = best.get();
    note.textContent = isRecord ? 'New best score' : `Reached wave ${game.wave}. Best ${formatNumber(record ?? 0)}`;
    note.classList.toggle('is-record', isRecord);
    $('over-title').textContent = game.lives > 0 ? 'Invaded' : 'Game over';
    shown.best = null;
    overAt = performance.now();
    setState('over');
    renderHud();
    draw();
}

// ---------- 操作 ----------

const KEYS = {
    ArrowLeft: 'left',
    a: 'left',
    ArrowRight: 'right',
    d: 'right',
    ' ': 'fire',
    ArrowUp: 'fire',
    w: 'fire',
};
const keyOf = (event) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);

addEventListener('keydown', (event) => {
    const key = keyOf(event);
    if (state === 'playing') {
        const action = KEYS[key];
        if (action) {
            event.preventDefault();
            input[action] = true;
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
    const action = KEYS[keyOf(event)];
    if (action) input[action] = false;
});

document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'start' || action === 'restart') start();
    else if (action === 'resume') resume();
});

$('pause-btn').addEventListener('click', pause);

// 觸控 / 滑鼠拖曳：整個畫面都能拖（手機上可以在場地下方操作，不擋住畫面）
// 飛船跟著手指的位移移動，按住時自動射擊
let drag = null;
root.addEventListener('pointerdown', (event) => {
    if (state !== 'playing' || event.target.closest('button, .overlay')) return;
    root.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, shipX: game.player.x + game.player.w / 2 };
    input.targetX = drag.shipX;
    input.touchFire = true;
    root.classList.add('is-dragging');
});

root.addEventListener('pointermove', (event) => {
    if (!drag || state !== 'playing') return;
    input.targetX = drag.shipX + ((event.clientX - drag.x) / scale) * TOUCH_GAIN;
    // 飛船已經貼邊時重設起點，手指往回拉能立刻反應
    const clamped = Math.min(Math.max(input.targetX, 8), WIDTH - 8);
    if (clamped !== input.targetX) {
        drag = { x: event.clientX, shipX: clamped };
        input.targetX = clamped;
    }
});

const endDrag = () => {
    drag = null;
    input.targetX = undefined;
    input.touchFire = false;
    root.classList.remove('is-dragging');
};
root.addEventListener('pointerup', endDrag);
root.addEventListener('pointercancel', endDrag);

// 切換分頁或視窗失焦時暫停；回來後由玩家自己按繼續
autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動：開始畫面後方顯示第一波的陣型 ----------

game = createInvaders({ random: () => 0.4 });
game.takeEvents();
setState('ready');
layout();
const record = best.get();
if (record !== null) hud.best.textContent = formatNumber(record);
shown.lives = null;
renderHud();
hud.score.textContent = '0';
