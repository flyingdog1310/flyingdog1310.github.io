// 恐龍快跑：畫面與操作。遊戲規則在 core.js
import {
    WIDTH,
    HEIGHT,
    GROUND_Y,
    DINO_X,
    DINO_HEIGHT,
    DUCK_HEIGHT,
    OBSTACLES,
    BIRD_HEIGHTS,
    createRunner,
} from './core.js';
import { setupCanvas, createLoop, autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 600;
// 一個日夜循環的分數長度
const DAY_LENGTH = 800;
// 場地最多放大到這個倍率（太寬的螢幕上不要無限放大）
const MAX_SCALE = 1.7;
// 窄螢幕（直向手機）時把天空往上延伸，場地最高到 4:3；地面與遊戲判定不變
const NARROW_WIDTH = 700;
const MAX_VIEW_HEIGHT = WIDTH * 0.75;

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.runner');
const hudBar = document.querySelector('.hud');
const pad = document.querySelector('.pad');
const fieldArea = $('field-area');
const field = $('field');
const boardCanvas = $('board');
const scoreText = $('score');
const overlays = { ready: $('overlay-ready'), paused: $('overlay-paused'), over: $('overlay-over') };

const best = highScore('dino-runner');
// 舊版把最高分存在 dinoHighScore，第一次開啟時搬過來
try {
    const legacy = Number.parseInt(localStorage.getItem('dinoHighScore'), 10);
    if (Number.isFinite(legacy) && legacy > 0) best.submit(legacy);
} catch {
    // localStorage 不可用時略過
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const formatNumber = (n) => n.toLocaleString('en-US');

// ---------- 日夜色票：依循環位置（0–1）在關鍵影格之間插值 ----------

const PALETTES = [
    [0, { skyTop: '#79b4dc', skyBottom: '#f5e2b8', far: '#d8b08a', near: '#c48a5c', sand: '#e9c893', sandDark: '#cfa56c', stars: 0 }],
    [0.45, { skyTop: '#79b4dc', skyBottom: '#f5e2b8', far: '#d8b08a', near: '#c48a5c', sand: '#e9c893', sandDark: '#cfa56c', stars: 0 }],
    [0.55, { skyTop: '#3d3c78', skyBottom: '#f39a63', far: '#a8606a', near: '#7d4458', sand: '#d69c6e', sandDark: '#b77b52', stars: 0.2 }],
    [0.63, { skyTop: '#0a1030', skyBottom: '#243160', far: '#2e3560', near: '#222747', sand: '#4a4868', sandDark: '#3a3854', stars: 1 }],
    [0.88, { skyTop: '#0a1030', skyBottom: '#243160', far: '#2e3560', near: '#222747', sand: '#4a4868', sandDark: '#3a3854', stars: 1 }],
    [0.95, { skyTop: '#5a6aa8', skyBottom: '#f5b58f', far: '#b78a8a', near: '#936673', sand: '#d9b08a', sandDark: '#bb8f6a', stars: 0.1 }],
    [1, { skyTop: '#79b4dc', skyBottom: '#f5e2b8', far: '#d8b08a', near: '#c48a5c', sand: '#e9c893', sandDark: '#cfa56c', stars: 0 }],
];

const DINO = { body: '#4f8a5b', dark: '#2c5438', light: '#79b184', eye: '#fff' };
const CACTUS = { body: '#3e8a55', dark: '#2a6340', light: '#5fae72' };
const BIRD = { body: '#7b4b6a', dark: '#4d2d43', beak: '#e0a458' };

function hexToRgb(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return `rgb(${ca.map((v, i) => Math.round(v + (cb[i] - v) * t)).join(', ')})`;
}

function paletteAt(p) {
    for (let i = 0; i < PALETTES.length - 1; i++) {
        const [p0, a] = PALETTES[i];
        const [p1, b] = PALETTES[i + 1];
        if (p >= p0 && p <= p1) {
            const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
            const out = {};
            for (const key of Object.keys(a)) out[key] = key === 'stars' ? a[key] + (b[key] - a[key]) * t : mix(a[key], b[key], t);
            return out;
        }
    }
    return PALETTES[0][1];
}

// ---------- 角色與障礙物：SVG 路徑 ----------

const SHAPES = {
    body: new Path2D('M0 20C6 19 10 17 14 16L26 16C31 16 33 19 33 24L33 30C33 35 29 38 24 38L15 38C10 38 7 35 6 31C4 27 2 24 0 20Z'),
    head: new Path2D('M22 22L24 6C24 2.5 26.5 0 30 0L39 0C42 0 44 2 44 5L44 11C44 13.5 42.5 15 40 15L34 15C32.5 15 31.5 16 31.5 17.5L31 24Z'),
    spikes: new Path2D('M11 17L13.5 12.5L16 16.5ZM17 16L19.5 11.5L22 16ZM23.5 9L21.5 5L25 6.5Z'),
    arm: new Path2D('M29 25L34 27L33 29L28.5 27.5Z'),
    duckBody: new Path2D('M0 12C6 11 10 9 16 9L38 9C43 9 46 12 46 16C46 21 42 24 36 24L16 24C10 24 6 21 4 17C3 15 1 13 0 12Z'),
    duckHead: new Path2D('M38 9C38 4.5 41 2 45 2L52 2C54.5 2 56 4 56 6L56 11C56 13 54.5 14 52.5 14L41 14Z'),
    birdBody: new Path2D('M10 17C14 13 26 13 31 15L44 17.5L31 20C26 22 14 22 10 19L2 21L5 17L2 13Z'),
    birdCrest: new Path2D('M31 15L25 9L29 15Z'),
    wingUp: new Path2D('M15 16L27 16L21 1Z'),
    wingDown: new Path2D('M15 19L27 19L23 35Z'),
};

function drawDino(ctx, dino, { dead = false, now = 0 }) {
    ctx.save();
    const legPhase = Math.floor(dino.runTime * 12) % 2;
    ctx.lineJoin = 'round';

    if (dino.ducking && !dead) {
        ctx.translate(DINO_X, GROUND_Y - DUCK_HEIGHT);
        drawLegs(ctx, [14, 28], 22, 28, legPhase);
        fillShape(ctx, SHAPES.duckBody, DINO.body);
        fillShape(ctx, SHAPES.duckHead, DINO.body);
        ctx.fillStyle = DINO.light;
        ctx.beginPath();
        ctx.ellipse(24, 19, 12, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        drawEye(ctx, 47.5, 5.5, dead);
        ctx.strokeStyle = DINO.dark;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(49, 10.5);
        ctx.lineTo(54.5, 10.5);
        ctx.stroke();
    } else {
        ctx.translate(DINO_X, dino.y);
        // 空中兩腳併攏，跑步時交替
        drawLegs(ctx, [12, 22], 36, DINO_HEIGHT, dino.onGround && !dead ? legPhase : -1);
        fillShape(ctx, SHAPES.spikes, DINO.dark);
        fillShape(ctx, SHAPES.body, DINO.body);
        fillShape(ctx, SHAPES.head, DINO.body);
        ctx.fillStyle = DINO.light;
        ctx.beginPath();
        ctx.ellipse(21, 31, 9, 4, -0.2, 0, Math.PI * 2);
        ctx.fill();
        fillShape(ctx, SHAPES.arm, DINO.dark);
        // 偶爾眨眼
        const blink = !dead && now % 4 < 0.12;
        drawEye(ctx, 35, 5, dead, blink);
        ctx.strokeStyle = DINO.dark;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(36, 11);
        ctx.lineTo(dead ? 42 : 42.5, dead ? 12 : 11);
        ctx.stroke();
    }
    ctx.restore();
}

function fillShape(ctx, path, color) {
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.strokeStyle = DINO.dark;
    ctx.lineWidth = 0.8;
    ctx.stroke(path);
}

// 腳：phase 0 / 1 交替抬腳，-1 表示兩腳都著地
function drawLegs(ctx, xs, top, bottom, phase) {
    ctx.fillStyle = DINO.dark;
    xs.forEach((x, i) => {
        const lifted = phase >= 0 && i === phase;
        const end = lifted ? bottom - 5 : bottom;
        ctx.fillRect(x, top, 4.5, end - top);
        ctx.fillRect(x, end - 2, 7, 2);
    });
}

function drawEye(ctx, x, y, dead, blink = false) {
    if (dead) {
        ctx.strokeStyle = DINO.dark;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 2);
        ctx.lineTo(x + 2, y + 2);
        ctx.moveTo(x + 2, y - 2);
        ctx.lineTo(x - 2, y + 2);
        ctx.stroke();
        return;
    }
    ctx.fillStyle = DINO.eye;
    ctx.beginPath();
    ctx.ellipse(x, y, 2.4, blink ? 0.4 : 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (blink) return;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(x + 0.8, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
}

// 仙人掌：主幹 + 左右手臂，variant 決定手臂高度
function drawCactus(ctx, x, y, kind, variant) {
    const { width: w, height: h } = OBSTACLES[kind];
    const trunkW = w * 0.4;
    const trunkX = x + (w - trunkW) / 2;
    const armW = w * 0.24;
    const shift = [0, 0.08, -0.06][variant] * h;
    const arms = [
        { x: x, top: y + h * 0.28 + shift, bottom: y + h * 0.58 + shift },
        { x: x + w - armW, top: y + h * 0.16 - shift, bottom: y + h * 0.46 - shift },
    ];
    ctx.fillStyle = CACTUS.body;
    ctx.strokeStyle = CACTUS.dark;
    ctx.lineWidth = 0.8;
    for (const arm of arms) {
        ctx.beginPath();
        ctx.roundRect(arm.x, arm.top, armW, arm.bottom - arm.top, armW / 2);
        ctx.fill();
        ctx.stroke();
        const joinX = arm.x < trunkX ? arm.x + armW / 2 : trunkX + trunkW - 1;
        ctx.fillRect(joinX, arm.bottom - armW, Math.abs(trunkX - arm.x) - armW / 2 + 1 + (arm.x < trunkX ? 0 : 0), armW);
    }
    ctx.beginPath();
    ctx.roundRect(trunkX, y, trunkW, h + 1, [trunkW / 2, trunkW / 2, 0, 0]);
    ctx.fill();
    ctx.stroke();
    // 縱向稜線
    ctx.strokeStyle = CACTUS.light;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(trunkX + trunkW * 0.35, y + 4);
    ctx.lineTo(trunkX + trunkW * 0.35, y + h - 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawBird(ctx, x, y, now) {
    const flap = Math.floor(now * 7) % 2 === 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = BIRD.dark;
    ctx.fill(flap ? SHAPES.wingUp : SHAPES.wingDown);
    ctx.fillStyle = BIRD.body;
    ctx.fill(SHAPES.birdBody);
    ctx.fillStyle = BIRD.dark;
    ctx.fill(SHAPES.birdCrest);
    ctx.fillStyle = BIRD.beak;
    ctx.beginPath();
    ctx.moveTo(36, 16.3);
    ctx.lineTo(44, 17.5);
    ctx.lineTo(36, 18.8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(31, 16.2, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// ---------- 背景：平頂山剪影（兩層視差）、星星、太陽 / 月亮 ----------

function makeRidge(period, minH, maxH, seed) {
    let s = seed;
    const rand = () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
    const points = [[0, 0]];
    let x = 0;
    while (x < period) {
        const gap = 20 + rand() * 60;
        const slope = 8 + rand() * 14;
        const top = 30 + rand() * 90;
        const h = minH + rand() * (maxH - minH);
        points.push([x + gap, 0], [x + gap + slope, h], [x + gap + slope + top, h], [x + gap + slope * 2 + top, 0]);
        x += gap + slope * 2 + top;
    }
    points.push([period, 0]);
    return { period: x, points };
}

const RIDGES = { far: makeRidge(900, 26, 52, 7), near: makeRidge(700, 12, 30, 19) };
const STARS = Array.from({ length: 40 }, (_, i) => ({ x: (i * 97.3) % WIDTH, y: 8 + ((i * 53.7) % 90), r: i % 5 === 0 ? 1 : 0.6 }));
const PEBBLES = Array.from({ length: 26 }, (_, i) => ({ x: (i * 131.7) % WIDTH, y: GROUND_Y + 4 + ((i * 17.3) % 22), w: 1 + (i % 3) }));

function drawRidge(ctx, ridge, offset, baseY, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    const start = -(offset % ridge.period);
    for (let copy = 0; start + copy * ridge.period < WIDTH; copy++) {
        for (const [px, py] of ridge.points) ctx.lineTo(start + copy * ridge.period + px, baseY - py);
    }
    ctx.lineTo(WIDTH, baseY);
    ctx.closePath();
    ctx.fill();
}

// extra：天空往上延伸的高度（邏輯單位）
function renderBackground(ctx, distance, phase, now, extra = 0) {
    const pal = paletteAt(phase);
    const sky = ctx.createLinearGradient(0, -extra, 0, GROUND_Y);
    sky.addColorStop(0, pal.skyTop);
    sky.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, -extra, WIDTH, GROUND_Y + extra);

    if (pal.stars > 0) {
        ctx.fillStyle = '#fff';
        for (const star of STARS) {
            const twinkle = reduceMotion.matches ? 1 : 0.6 + 0.4 * Math.sin(now * 2 + star.x);
            ctx.globalAlpha = pal.stars * twinkle;
            const y = -extra + (star.y / 100) * (100 + extra);
            ctx.beginPath();
            ctx.arc(star.x, y, star.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // 太陽白天由左往右，月亮在夜晚出現
    const sunT = phase / 0.6;
    if (sunT < 1) {
        const x = WIDTH * (0.12 + sunT * 0.8);
        const y = 30 + (sunT - 0.5) ** 2 * 160;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 40);
        glow.addColorStop(0, 'rgba(255, 244, 214, 0.9)');
        glow.addColorStop(0.3, 'rgba(255, 220, 150, 0.35)');
        glow.addColorStop(1, 'rgba(255, 220, 150, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - 40, y - 40, 80, 80);
        ctx.fillStyle = '#fff4d6';
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fill();
    }
    const moonT = (phase - 0.58) / 0.36;
    if (moonT > 0 && moonT < 1) {
        const x = WIDTH * (0.15 + moonT * 0.7);
        const y = 34 + (moonT - 0.5) ** 2 * 120;
        ctx.fillStyle = '#eef0ff';
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal.skyTop;
        ctx.beginPath();
        ctx.arc(x + 4, y - 2, 8, 0, Math.PI * 2);
        ctx.fill();
    }

    drawRidge(ctx, RIDGES.far, distance * 0.1, GROUND_Y - 6, pal.far);
    drawRidge(ctx, RIDGES.near, distance * 0.3, GROUND_Y, pal.near);

    ctx.fillStyle = pal.sand;
    ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);
    ctx.fillStyle = pal.sandDark;
    ctx.fillRect(0, GROUND_Y, WIDTH, 1.5);
    for (const pebble of PEBBLES) {
        const x = (((pebble.x - distance) % WIDTH) + WIDTH) % WIDTH;
        ctx.fillRect(x, pebble.y, pebble.w * 2, 1);
    }
}

// ---------- 狀態 ----------

let state = 'ready';
let game = null;
let ctx = null;
let scale = 1;
let skyExtra = 0;
let overAt = 0;
let crashTime = 0;
let puffs = [];
let lastRenderTime = 0;
let dustTimer = 0;
const input = { jump: false, duck: false };
const shown = {};
// 開始畫面固定在黃昏，其餘時間依分數推進
let fixedPhase = 0.52;

// ---------- 繪圖 ----------

function renderPuffs(now) {
    const dt = Math.min(now - lastRenderTime, 0.05);
    lastRenderTime = now;
    puffs = puffs.filter((p) => (p.life -= dt) > 0);
    for (const p of puffs) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = (p.life / p.maxLife) * 0.6;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1.6 - p.life / p.maxLife), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function render(now) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(0, skyExtra);
    const phase = fixedPhase ?? ((game.score % DAY_LENGTH) / DAY_LENGTH);
    renderBackground(ctx, game.distance, phase, now, skyExtra);

    for (const obstacle of game.obstacles) {
        const def = OBSTACLES[obstacle.kind];
        if (obstacle.kind === 'bird') {
            drawBird(ctx, obstacle.x, obstacle.y, now);
        } else {
            for (let i = 0; i < obstacle.count; i++) drawCactus(ctx, obstacle.x + i * def.width, obstacle.y, obstacle.kind, (obstacle.variant + i) % 3);
        }
    }

    // 恐龍的影子：離地越高越小越淡
    const lift = GROUND_Y - DINO_HEIGHT - game.dino.y;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(DINO_X + 20, GROUND_Y + 1.5, Math.max(8, 18 - lift * 0.08), 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    drawDino(ctx, game.dino, { dead: game.over, now });
    renderPuffs(now);
    ctx.restore();
}

const draw = () => render(performance.now() / 1000);

function renderHud() {
    const score = String(game.score);
    if (shown.score !== score) {
        shown.score = score;
        scoreText.textContent = formatNumber(game.score);
    }
    const record = best.get();
    const bestText = record === null ? '–' : formatNumber(record);
    if (shown.best !== bestText) {
        shown.best = bestText;
        $('best').textContent = bestText;
    }
}

// ---------- 版面尺寸：寬度優先，也不能超過可用高度 ----------

function layout() {
    const styles = getComputedStyle(root);
    const gap = Number.parseFloat(styles.rowGap) || 0;
    const padY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const padHeight = pad.offsetHeight ? pad.offsetHeight + gap : 0;
    const availableHeight = root.clientHeight - padY - hudBar.offsetHeight - gap - padHeight;
    const next = Math.max(0.4, Math.min(fieldArea.clientWidth / WIDTH, availableHeight / HEIGHT, MAX_SCALE));
    const narrow = fieldArea.clientWidth < NARROW_WIDTH;
    const viewHeight = narrow ? Math.max(HEIGHT, Math.min(availableHeight / next, MAX_VIEW_HEIGHT)) : HEIGHT;
    const extra = Math.round(viewHeight - HEIGHT);
    if (next !== scale || extra !== skyExtra || !ctx) {
        scale = next;
        skyExtra = extra;
        const w = Math.round(WIDTH * scale);
        const h = Math.round(viewHeight * scale);
        field.style.width = `${w}px`;
        field.style.height = `${h}px`;
        root.style.setProperty('--board-width', `${w}px`);
        ctx = setupCanvas(boardCanvas, w, h);
    }
    draw();
}

new ResizeObserver(layout).observe(root);

// ---------- 遊戲事件 → 畫面特效 ----------

function dust(x, y, count, spread = 30) {
    if (reduceMotion.matches) return;
    const color = paletteAt(fixedPhase ?? ((game.score % DAY_LENGTH) / DAY_LENGTH)).sandDark;
    for (let i = 0; i < count; i++) {
        const life = 0.3 + Math.random() * 0.3;
        puffs.push({
            x: x + (Math.random() - 0.5) * 10,
            y,
            vx: -game.speed * 0.25 - Math.random() * spread,
            vy: -10 - Math.random() * 20,
            r: 1.5 + Math.random() * 2,
            color,
            life,
            maxLife: life,
        });
    }
}

function handleEvents() {
    for (const event of game.takeEvents()) {
        switch (event.type) {
            case 'land':
                dust(DINO_X + 18, GROUND_Y - 1, 7, 50);
                break;
            case 'jump':
                dust(DINO_X + 14, GROUND_Y - 1, 3);
                break;
            case 'milestone':
                scoreText.classList.remove('is-milestone');
                void scoreText.offsetWidth;
                scoreText.classList.add('is-milestone');
                break;
            case 'crash':
                crashTime = performance.now();
                break;
        }
    }
}

// ---------- 遊戲流程 ----------

const loop = createLoop({
    update(dt) {
        if (state !== 'playing') return;
        if (game.over) {
            // 撞到後停住一下再顯示結算
            if (performance.now() - crashTime > 700) finish();
            return;
        }
        game.update(dt, input);
        handleEvents();
        dustTimer -= dt;
        if (game.dino.onGround && !game.over && dustTimer <= 0) {
            dust(DINO_X + 12, GROUND_Y - 1, 1, 10);
            dustTimer = 0.12;
        }
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
        input.jump = false;
        input.duck = false;
        for (const button of document.querySelectorAll('.pad__btn.is-pressed')) button.classList.remove('is-pressed');
    }
}

function start() {
    game = createRunner();
    fixedPhase = null;
    puffs = [];
    shown.score = null;
    document.activeElement?.blur();
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
    note.textContent = isRecord ? 'New best score' : `Best ${formatNumber(record ?? 0)}`;
    note.classList.toggle('is-record', isRecord);
    overAt = performance.now();
    setState('over');
    renderHud();
    draw();
}

// ---------- 操作 ----------

const KEYS = { ' ': 'jump', ArrowUp: 'jump', w: 'jump', ArrowDown: 'duck', s: 'duck' };
const keyOf = (event) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);

addEventListener('keydown', (event) => {
    const key = keyOf(event);
    const action = KEYS[key];
    if (state === 'playing') {
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
    if ((key === 'Enter' || action === 'jump') && !onButton) {
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

// 觸控：點場地跳（按住跳更高），按鈕可以跳或蹲
field.addEventListener('pointerdown', (event) => {
    if (state !== 'playing' || event.target.closest('button')) return;
    field.setPointerCapture(event.pointerId);
    input.jump = true;
});
const releaseJump = () => {
    input.jump = false;
};
field.addEventListener('pointerup', releaseJump);
field.addEventListener('pointercancel', releaseJump);

for (const button of document.querySelectorAll('.pad__btn')) {
    const action = button.dataset.hold;
    button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        button.classList.add('is-pressed');
        if (state === 'playing') input[action] = true;
        else if (state === 'ready' || (state === 'over' && performance.now() - overAt >= RESTART_GRACE_MS)) start();
    });
    const up = () => {
        button.classList.remove('is-pressed');
        input[action] = false;
    };
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
}

autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動：黃昏的示意畫面 ----------

function demoGame() {
    const demo = createRunner({ random: () => 0.5 });
    demo.distance = 2600;
    demo.dino.y = GROUND_Y - DINO_HEIGHT - 38;
    demo.dino.onGround = false;
    demo.obstacles = [
        { kind: 'cactusLarge', count: 2, x: 250, y: GROUND_Y - 50, width: 50, speedBonus: 0, variant: 1 },
        { kind: 'cactusSmall', count: 1, x: 470, y: GROUND_Y - 35, width: 17, speedBonus: 0, variant: 0 },
        { kind: 'bird', level: 'high', count: 1, x: 380, y: BIRD_HEIGHTS.high - 10, width: 44, speedBonus: 0, variant: 0 },
    ];
    return demo;
}

game = demoGame();
setState('ready');
layout();
const record = best.get();
if (record !== null) $('best').textContent = formatNumber(record);
