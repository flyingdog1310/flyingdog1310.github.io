// 坦克大戰：畫面與操作。遊戲規則在 core.js
import {
    SIZE,
    TILE,
    CELL,
    GRID,
    TANK,
    BRICK,
    STEEL,
    WATER,
    TREES,
    BASE,
    SPAWN_TIME,
    ENEMIES_PER_STAGE,
    PLAYER_SPAWN,
    createBattle,
    fortressCells,
} from './core.js';
import { setupCanvas, createLoop, autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 被擊毀 / 基地被打爆後，停留一下讓爆炸播完再顯示結算
const OVER_DELAY_MS = 1400;
const STICK_DEADZONE = 14;
const STICK_TRAVEL = 30;

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.tanks');
const fieldArea = $('field-area');
const field = $('field');
const boardCanvas = $('board');
const callout = $('callout');
const stick = $('stick');
const stickKnob = $('stick-knob');
const fireButton = $('fire-btn');
const overlays = { ready: $('overlay-ready'), paused: $('overlay-paused'), over: $('overlay-over') };

const best = highScore('tank-battle');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const formatNumber = (n) => n.toLocaleString('en-US');

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(`--${name}`).trim();
const C = Object.fromEntries(
    [
        'ground', 'ground-line', 'brick', 'brick-light', 'mortar', 'steel', 'steel-light', 'steel-dark', 'water',
        'water-light', 'trees', 'trees-light', 'trees-dark', 'tread', 'player', 'player-dark', 'basic', 'fast', 'power',
        'armor-4', 'armor-3', 'armor-2', 'armor-1', 'enemy-dark', 'carrier', 'player-bullet', 'enemy-bullet', 'shield',
        'eagle', 'eagle-dark', 'powerup', 'explosion', 'explosion-core',
    ].map((name) => [name, color(name)])
);

const ANGLE = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

// ---------- 地形：磚 / 鋼 / 水畫在底層，樹叢畫在坦克上面；地形有變化時才重畫 ----------

const layers = { terrain: document.createElement('canvas'), trees: document.createElement('canvas') };
let layerGrid = null;
let layerSnapshot = null;
let waterBlocks = [];

function drawBrickCell(g, c, r) {
    const x = c * CELL;
    const y = r * CELL;
    g.fillStyle = C.brick;
    g.fillRect(x, y, CELL, CELL);
    g.fillStyle = C['brick-light'];
    g.fillRect(x, y, CELL, 0.6);
    g.fillStyle = C.mortar;
    g.fillRect(x, y + CELL - 0.6, CELL, 0.6);
    // 每塊磚長 8、上下排錯開半塊
    if ((c + r) % 2 === 0) g.fillRect(x, y, 0.6, CELL);
}

function drawSteelCell(g, c, r) {
    const x = c * CELL;
    const y = r * CELL;
    g.fillStyle = C.steel;
    g.fillRect(x, y, CELL, CELL);
    // 每 8 × 8 一片鋼板：左上亮邊、右下暗邊
    g.fillStyle = C['steel-light'];
    if (c % 2 === 0) g.fillRect(x, y, 0.8, CELL);
    if (r % 2 === 0) g.fillRect(x, y, CELL, 0.8);
    g.fillStyle = C['steel-dark'];
    if (c % 2 === 1) g.fillRect(x + CELL - 0.8, y, 0.8, CELL);
    if (r % 2 === 1) g.fillRect(x, y + CELL - 0.8, CELL, 0.8);
}

function drawTreeBlock(g, bx, by) {
    g.fillStyle = C['trees-dark'];
    g.fillRect(bx, by, 8, 8);
    const blobs = [
        [2.4, 2.6, 2.7],
        [5.7, 2.4, 2.5],
        [2.8, 5.8, 2.6],
        [5.9, 5.7, 2.5],
    ];
    g.fillStyle = C.trees;
    for (const [x, y, r] of blobs) {
        g.beginPath();
        g.arc(bx + x, by + y, r, 0, Math.PI * 2);
        g.fill();
    }
    g.fillStyle = C['trees-light'];
    for (const [x, y, r] of blobs) {
        g.beginPath();
        g.arc(bx + x - 0.7, by + y - 0.8, r * 0.45, 0, Math.PI * 2);
        g.fill();
    }
}

function rebuildLayers() {
    const grid = game.grid;
    const px = boardCanvas.width;
    for (const canvas of Object.values(layers)) {
        canvas.width = px;
        canvas.height = px;
    }
    const k = px / SIZE;
    const g = layers.terrain.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = C.ground;
    g.fillRect(0, 0, SIZE, SIZE);
    g.fillStyle = C['ground-line'];
    for (let i = 1; i < SIZE / TILE; i++) {
        g.fillRect(i * TILE, 0, 0.5, SIZE);
        g.fillRect(0, i * TILE, SIZE, 0.5);
    }

    const t = layers.trees.getContext('2d');
    t.setTransform(k, 0, 0, k, 0, 0);
    t.clearRect(0, 0, SIZE, SIZE);

    const water = new Set();
    const treeBlocks = new Set();
    for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
            const type = grid[r * GRID + c];
            if (type === BRICK) drawBrickCell(g, c, r);
            else if (type === STEEL) drawSteelCell(g, c, r);
            else if (type === WATER) {
                g.fillStyle = C.water;
                g.fillRect(c * CELL, r * CELL, CELL, CELL);
                water.add(`${c >> 1},${r >> 1}`);
            } else if (type === TREES) treeBlocks.add(`${c >> 1},${r >> 1}`);
        }
    }
    for (const key of treeBlocks) {
        const [bx, by] = key.split(',').map(Number);
        drawTreeBlock(t, bx * 8, by * 8);
    }
    waterBlocks = [...water].map((key) => key.split(',').map((n) => Number(n) * 8));
    layerGrid = grid;
    layerSnapshot = new Uint8Array(grid);
}

function terrainChanged() {
    if (layerGrid !== game.grid || !layerSnapshot) return true;
    const grid = game.grid;
    for (let i = 0; i < grid.length; i++) if (grid[i] !== layerSnapshot[i]) return true;
    return false;
}

function drawWaves(ctx, now) {
    const shift = reduceMotion.matches ? 0 : now;
    ctx.strokeStyle = C['water-light'];
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const [bx, by] of waterBlocks) {
        const o = Math.sin(shift * 2 + (bx + by) * 0.35) * 1.2;
        ctx.moveTo(bx + 0.8 + o, by + 2.8);
        ctx.quadraticCurveTo(bx + 2.3 + o, by + 1.6, bx + 3.8 + o, by + 2.8);
        ctx.moveTo(bx + 4.2 - o, by + 6.2);
        ctx.quadraticCurveTo(bx + 5.7 - o, by + 5, bx + 7.2 - o, by + 6.2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// ---------- 基地老鷹 ----------

const EAGLE = new Path2D(
    'M8 1.6L9.6 3.4L9.2 5.6L13.8 3.2L12.8 6.8L15 7.6L12.2 9.4L11.6 11.4L9.4 10.6L8 13L6.6 10.6L4.4 11.4L3.8 9.4L1 7.6L3.2 6.8L2.2 3.2L6.8 5.6L6.4 3.4Z'
);

function drawBase(ctx, alive) {
    ctx.save();
    ctx.translate(BASE.x, BASE.y);
    ctx.fillStyle = alive ? C['eagle-dark'] : '#2a2a2a';
    ctx.fillRect(3, 13.4, 10, 2.2);
    if (alive) {
        ctx.fillStyle = C.eagle;
        ctx.fill(EAGLE);
        ctx.strokeStyle = C['eagle-dark'];
        ctx.lineWidth = 0.6;
        ctx.stroke(EAGLE);
        ctx.fillStyle = C['eagle-dark'];
        ctx.beginPath();
        ctx.arc(8.6, 3.6, 0.6, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // 被打爆：灰色殘骸與裂痕
        ctx.translate(0, 3);
        ctx.scale(1, 0.7);
        ctx.fillStyle = '#4a4a4a';
        ctx.fill(EAGLE);
        ctx.strokeStyle = '#1c1c1c';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(4, 4);
        ctx.lineTo(7, 8);
        ctx.lineTo(6, 12);
        ctx.moveTo(12, 4);
        ctx.lineTo(9, 7);
        ctx.lineTo(11, 11);
        ctx.stroke();
    }
    ctx.restore();
}

// ---------- 坦克 ----------

const ARMOR_COLORS = { 4: 'armor-4', 3: 'armor-3', 2: 'armor-2', 1: 'armor-1' };

function tankColors(tank, now) {
    if (!tank.type) return { body: C.player, dark: C['player-dark'] };
    // 帶道具的坦克閃紅光
    if (tank.carrier && Math.floor(now * 6) % 2 === 0) return { body: C.carrier, dark: C['enemy-dark'] };
    const body = tank.type === 'armor' ? C[ARMOR_COLORS[Math.max(1, tank.hp)]] : C[tank.type];
    return { body, dark: C['enemy-dark'] };
}

function drawTreads(ctx, tank, wide) {
    const w = wide ? 4.6 : 4;
    ctx.fillStyle = C.tread;
    ctx.beginPath();
    ctx.roundRect(0.4, 0.8, w, 14.4, 1.2);
    ctx.roundRect(15.6 - w, 0.8, w, 14.4, 1.2);
    ctx.fill();
    // 履帶紋路隨移動距離捲動
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    const offset = (tank.travel * 1.4) % 3;
    for (let k = 0; k < 5; k++) {
        const y = 1.4 + ((k * 3 + offset) % 14);
        ctx.fillRect(0.9, y, w - 1, 0.8);
        ctx.fillRect(16.1 - w, y, w - 1, 0.8);
    }
}

function drawTank(ctx, tank, now) {
    const { body, dark } = tankColors(tank, now);
    const kind = tank.type ?? 'player';
    ctx.save();
    ctx.translate(tank.x + TANK / 2, tank.y + TANK / 2);
    ctx.rotate(ANGLE[tank.dir]);
    ctx.translate(-TANK / 2, -TANK / 2);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = dark;
    ctx.fillStyle = body;

    drawTreads(ctx, tank, kind === 'armor');
    ctx.fillStyle = body;
    ctx.beginPath();
    if (kind === 'fast') {
        ctx.moveTo(5.4, 2.6);
        ctx.lineTo(10.6, 2.6);
        ctx.lineTo(12.2, 13.8);
        ctx.lineTo(3.8, 13.8);
        ctx.closePath();
    } else if (kind === 'armor') {
        ctx.roundRect(3.2, 2.4, 9.6, 12.2, 1);
    } else if (kind === 'power') {
        ctx.roundRect(3.6, 4, 8.8, 10, 1.2);
    } else {
        ctx.roundRect(3.6, 3, 8.8, 11, 1.5);
    }
    ctx.fill();
    ctx.stroke();

    // 重裝甲的裝甲板
    if (kind === 'armor') {
        ctx.beginPath();
        ctx.moveTo(4.2, 4.6);
        ctx.lineTo(11.8, 4.6);
        ctx.moveTo(4.2, 13);
        ctx.lineTo(11.8, 13);
        ctx.stroke();
    }

    // 砲管
    ctx.fillStyle = dark;
    if (kind === 'power') {
        ctx.fillRect(6.8, -1.6, 2.4, 9.6);
        ctx.fillRect(6.2, -1.8, 3.6, 1.6);
    } else if (kind === 'fast') {
        ctx.fillRect(7.3, 0.4, 1.4, 7);
    } else {
        ctx.fillRect(7, -0.6, 2, 9);
    }

    // 砲塔
    ctx.fillStyle = body;
    ctx.beginPath();
    if (kind === 'power') ctx.roundRect(5, 6.4, 6, 6, 1.6);
    else if (kind === 'fast') ctx.roundRect(5.6, 7, 4.8, 4.8, 1.4);
    else ctx.arc(8, 9.2, kind === 'armor' ? 3.8 : 3.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.arc(7.1, 8.3, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // 玩家的星星等級：車尾的小條紋
    if (kind === 'player') {
        ctx.fillStyle = dark;
        for (let i = 0; i < tank.level; i++) ctx.fillRect(5.4 + i * 2, 12.6, 1.2, 1.2);
    }
    ctx.restore();
}

function drawShield(ctx, tank, now) {
    // 快結束時閃爍
    if (tank.shield < 1 && Math.floor(now * 10) % 2 === 0) return;
    ctx.save();
    ctx.translate(tank.x + TANK / 2, tank.y + TANK / 2);
    ctx.strokeStyle = C.shield;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    ctx.setLineDash([2.4, 2]);
    ctx.lineDashOffset = reduceMotion.matches ? 0 : -now * 18;
    ctx.beginPath();
    ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

// 敵人出生：閃爍的四角星
function drawSpawn(ctx, spawn) {
    const p = spawn.t / SPAWN_TIME;
    const pulse = reduceMotion.matches ? 0.7 : Math.abs(Math.sin(p * Math.PI * 3));
    const r = 2.5 + pulse * 5.5;
    ctx.save();
    ctx.translate(spawn.x + TANK / 2, spawn.y + TANK / 2);
    ctx.rotate(reduceMotion.matches ? 0 : p * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.22, -r * 0.22);
    ctx.lineTo(r, 0);
    ctx.lineTo(r * 0.22, r * 0.22);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.22, r * 0.22);
    ctx.lineTo(-r, 0);
    ctx.lineTo(-r * 0.22, -r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawBullet(ctx, bullet) {
    const isPlayer = bullet.owner === 'player';
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(ANGLE[bullet.dir]);
    ctx.fillStyle = isPlayer ? C['player-bullet'] : C['enemy-bullet'];
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect(-1, -2.2, 2, 4.4, [1, 1, 0.4, 0.4]);
    ctx.fill();
    ctx.restore();
}

// ---------- 道具 ----------

const POWERUP_COLORS = {
    helmet: C.shield,
    timer: '#9ec9ff',
    shovel: C['steel-light'],
    star: C.player,
    grenade: C.carrier,
    tank: '#8fd17a',
};

function starPath(ctx, cx, cy, outer, inner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
}

function drawPowerupIcon(ctx, kind) {
    ctx.lineWidth = 1.2;
    switch (kind) {
        case 'star':
            starPath(ctx, 8, 8.4, 5, 2.1);
            ctx.fill();
            break;
        case 'helmet':
            ctx.beginPath();
            ctx.arc(8, 10, 4.6, Math.PI, 0);
            ctx.fill();
            ctx.fillRect(2.4, 10, 11.2, 1.6);
            break;
        case 'timer':
            ctx.beginPath();
            ctx.arc(8, 8.8, 4.4, 0, Math.PI * 2);
            ctx.moveTo(8, 8.8);
            ctx.lineTo(8, 6);
            ctx.moveTo(8, 8.8);
            ctx.lineTo(10.2, 8.8);
            ctx.stroke();
            ctx.fillRect(6.8, 2.6, 2.4, 1.4);
            break;
        case 'shovel':
            ctx.beginPath();
            ctx.moveTo(4, 3.6);
            ctx.lineTo(9, 8.6);
            ctx.stroke();
            ctx.fillRect(2.6, 2.4, 3, 1.4);
            ctx.beginPath();
            ctx.moveTo(8.2, 9.4);
            ctx.lineTo(10.6, 7);
            ctx.lineTo(13.4, 9.8);
            ctx.lineTo(13.2, 13.2);
            ctx.lineTo(9.8, 13.4);
            ctx.closePath();
            ctx.fill();
            break;
        case 'grenade':
            ctx.beginPath();
            ctx.ellipse(8, 9.6, 3.8, 4.3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(6.6, 3.6, 2.8, 1.8);
            ctx.beginPath();
            ctx.moveTo(9.4, 4.4);
            ctx.lineTo(11.8, 6.6);
            ctx.stroke();
            break;
        case 'tank':
            ctx.fillRect(3, 5, 3, 8.4);
            ctx.fillRect(10, 5, 3, 8.4);
            ctx.fillRect(5.6, 6.6, 4.8, 5.8);
            ctx.fillRect(7.3, 2.4, 1.4, 5);
            break;
    }
}

function drawPowerup(ctx, powerup, now) {
    // 一直閃爍以引起注意
    if (!reduceMotion.matches && (powerup.t * 3) % 1 > 0.75) return;
    const accent = POWERUP_COLORS[powerup.kind];
    ctx.save();
    ctx.translate(powerup.x, powerup.y);
    ctx.fillStyle = 'rgba(20, 22, 26, 0.92)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.roundRect(0.6, 0.6, 14.8, 14.8, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    drawPowerupIcon(ctx, powerup.kind);
    ctx.restore();
}

// ---------- 特效：爆炸、碎片、分數 ----------

let fx = [];
let lastFxTime = 0;

function blast(x, y, radius, life = 0.45) {
    fx.push({ kind: 'blast', x, y, radius, t: 0, life });
}

function debris(x, y, count, colors, speed = 50, size = 1.2) {
    if (reduceMotion.matches) return;
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.8);
        const life = 0.3 + Math.random() * 0.35;
        fx.push({
            kind: 'bit',
            x,
            y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            color: colors[i % colors.length],
            size: size * (0.6 + Math.random() * 0.8),
            t: 0,
            life,
        });
    }
}

function popup(x, y, text) {
    fx.push({ kind: 'text', x, y, text, t: 0, life: 1 });
}

function renderFx(ctx, now) {
    const dt = Math.min(now - lastFxTime, 0.05);
    lastFxTime = now;
    fx = fx.filter((f) => (f.t += dt) < f.life);
    for (const f of fx) {
        const p = f.t / f.life;
        if (f.kind === 'blast') {
            const r = f.radius * (0.35 + 0.65 * (1 - (1 - p) ** 3));
            const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
            glow.addColorStop(0, C['explosion-core']);
            glow.addColorStop(0.45, C.explosion);
            glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
            ctx.globalAlpha = 1 - p * p;
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
            ctx.fill();
        } else if (f.kind === 'bit') {
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.vx *= 0.92;
            f.vy *= 0.92;
            ctx.globalAlpha = 1 - p;
            ctx.fillStyle = f.color;
            ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
        } else if (f.kind === 'text') {
            const rise = reduceMotion.matches ? 0 : p * 8;
            ctx.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3;
            ctx.font = '700 6px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.strokeText(f.text, f.x, f.y - rise);
            ctx.fillStyle = '#fff';
            ctx.fillText(f.text, f.x, f.y - rise);
        }
    }
    ctx.globalAlpha = 1;
}

function shake() {
    if (reduceMotion.matches) return;
    field.classList.remove('is-shake');
    void field.offsetWidth;
    field.classList.add('is-shake');
}

// ---------- 狀態 ----------

let state = 'ready';
let game = null;
let ctx = null;
let scale = 1;
let overAt = 0;
let overStart = 0;
const input = { dir: null, fire: false };
const shown = {};

// ---------- 繪圖 ----------

function render(now) {
    if (terrainChanged()) rebuildLayers();
    ctx.save();
    ctx.scale(scale, scale);
    ctx.drawImage(layers.terrain, 0, 0, SIZE, SIZE);
    drawWaves(ctx, now);

    // 鏟子效果快結束時，基地外圍在鋼板與磚之間閃爍
    if (game.shovel > 0 && game.shovel < 3 && Math.floor(now * 6) % 2 === 0) {
        for (const i of fortressCells()) {
            if (game.grid[i] === STEEL) drawBrickCell(ctx, i % GRID, Math.floor(i / GRID));
        }
    }

    drawBase(ctx, game.baseAlive);
    if (game.powerup) drawPowerup(ctx, game.powerup, now);
    for (const spawn of game.spawns) drawSpawn(ctx, spawn);

    const frozen = game.freeze > 0 && (game.freeze > 2 || Math.floor(now * 6) % 2 === 0);
    for (const enemy of game.enemies) {
        drawTank(ctx, enemy, now);
        if (frozen) {
            ctx.strokeStyle = C.shield;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 0.8;
            ctx.strokeRect(enemy.x - 0.5, enemy.y - 0.5, TANK + 1, TANK + 1);
            ctx.globalAlpha = 1;
        }
    }
    const { player } = game;
    if (player?.alive) drawTank(ctx, player, now);

    for (const bullet of game.bullets) drawBullet(ctx, bullet);
    ctx.drawImage(layers.trees, 0, 0, SIZE, SIZE);
    if (player?.alive && player.shield > 0) drawShield(ctx, player, now);
    renderFx(ctx, now);
    ctx.restore();
}

const draw = () => render(performance.now() / 1000);

const TANK_ICON = '<svg viewBox="0 0 16 16"><use href="#i-tank" /></svg>';

function setText(key, value, element) {
    if (shown[key] === value) return false;
    shown[key] = value;
    element.textContent = value;
    return true;
}

function setHtml(key, html, element) {
    if (shown[key] === html) return false;
    shown[key] = html;
    element.innerHTML = html;
    return true;
}

function renderHud() {
    setText('score', formatNumber(game.score), $('score'));
    const record = best.get();
    setText('best', record === null ? '–' : formatNumber(record), $('best'));
    setText('stage', String(game.stage), $('stage'));
    const lives = Math.max(game.lives, 0);
    if (setHtml('lives', `${TANK_ICON}<span>${lives}</span>`, $('lives'))) {
        $('lives').setAttribute('aria-label', `${lives} ${lives === 1 ? 'life' : 'lives'}`);
    }
    const left = ENEMIES_PER_STAGE - game.killed;
    if (setHtml('enemies', `${TANK_ICON}<span>${left}</span>`, $('enemies'))) {
        $('enemies').setAttribute('aria-label', `${left} ${left === 1 ? 'enemy' : 'enemies'} left`);
    }
}

// ---------- 版面尺寸：正方形場地，盡量大 ----------

function layout() {
    const dpr = devicePixelRatio || 1;
    const available = Math.min(fieldArea.clientWidth, fieldArea.clientHeight);
    // 縮放倍率對齊 1/4 裝置像素，磚紋比較銳利
    const next = Math.max(1, Math.floor((available / SIZE) * dpr * 4) / (dpr * 4));
    if (next !== scale || !ctx) {
        scale = next;
        const px = Math.round(SIZE * scale);
        field.style.width = `${px}px`;
        field.style.height = `${px}px`;
        root.style.setProperty('--board-width', `${px}px`);
        ctx = setupCanvas(boardCanvas, px, px);
        layerGrid = null;
    }
    draw();
}

new ResizeObserver(layout).observe(fieldArea);

// ---------- 遊戲事件 → 畫面特效 ----------

const STAR_TEXT = { 1: 'Faster shells', 2: 'Double shot', 3: 'Shells break steel' };
const PICKUP_TEXT = {
    helmet: ['Shield', 'Invincible for 10 seconds'],
    timer: ['Freeze', 'Enemies stop for 10 seconds'],
    shovel: ['Steel walls', 'Base fortified for 15 seconds'],
    grenade: ['Boom', 'Every enemy on the field destroyed'],
    tank: ['Extra life', ''],
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
    for (const event of game.takeEvents()) {
        switch (event.type) {
            case 'stage-start':
                showCallout(`Stage ${event.stage}`, `${ENEMIES_PER_STAGE} tanks incoming`);
                break;
            case 'stage-clear':
                showCallout('Stage clear');
                break;
            case 'impact':
                if (event.kind === 'brick') {
                    blast(event.x, event.y, 4, 0.25);
                    debris(event.x, event.y, 5, [C.brick, C['brick-light'], C.mortar], 40, 1.1);
                } else if (event.kind === 'steel') {
                    debris(event.x, event.y, 4, ['#fff', C['steel-light']], 45, 0.8);
                    blast(event.x, event.y, 2.5, 0.15);
                } else if (event.kind === 'shield') {
                    debris(event.x, event.y, 5, [C.shield, '#fff'], 45, 0.9);
                } else {
                    blast(event.x, event.y, 3, 0.2);
                }
                break;
            case 'armor-hit':
                blast(event.x, event.y, 5, 0.25);
                debris(event.x, event.y, 4, ['#fff', C.explosion], 50, 0.9);
                break;
            case 'kill':
                blast(event.x, event.y, 13, 0.55);
                debris(event.x, event.y, 14, [C.explosion, C['explosion-core'], C['enemy-dark']], 70, 1.4);
                if (event.points > 0) popup(event.x, event.y, String(event.points));
                break;
            case 'player-hit':
                blast(event.x, event.y, 15, 0.6);
                debris(event.x, event.y, 16, [C.explosion, C.player, C['player-dark']], 75, 1.5);
                shake();
                break;
            case 'base-destroyed':
                blast(event.x, event.y, 22, 0.8);
                debris(event.x, event.y, 22, [C.explosion, C.eagle, '#777'], 90, 1.6);
                shake();
                break;
            case 'pickup': {
                popup(event.x, event.y, String(event.points));
                const [title, detail] =
                    event.kind === 'star'
                        ? ['Power up', STAR_TEXT[game.player.level]]
                        : PICKUP_TEXT[event.kind];
                showCallout(title, detail, { pickup: true });
                break;
            }
            case 'game-over':
                overStart = performance.now();
                break;
        }
    }
}

// ---------- 遊戲流程 ----------

const loop = createLoop({
    update(dt) {
        if (state !== 'playing') return;
        if (game.over) {
            if (performance.now() - overStart > OVER_DELAY_MS) finish();
            return;
        }
        game.update(dt, input);
        handleEvents();
    },
    render() {
        draw();
        renderHud();
    },
});

function releaseInputs() {
    heldDirs.length = 0;
    keyFire = false;
    buttonFire = false;
    stickDir = null;
    fireButton.classList.remove('is-pressed');
    resetStick();
    syncInput();
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
    game = createBattle();
    fx = [];
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
    $('over-title').textContent = game.overReason === 'base' ? 'Base destroyed' : 'Game over';
    $('final-score').textContent = formatNumber(game.score);
    const note = $('final-note');
    const record = best.get();
    note.textContent = isRecord ? `Stage ${game.stage} · New best score` : `Stage ${game.stage} · Best ${formatNumber(record ?? 0)}`;
    note.classList.toggle('is-record', isRecord);
    overAt = performance.now();
    setState('over');
    renderHud();
    draw();
}

// ---------- 操作：鍵盤 ----------

const DIR_KEYS = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
const FIRE_KEYS = new Set([' ', 'j', 'k', 'z']);
const keyOf = (event) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);

// 同時按住多個方向時，以最後按下的為準
const heldDirs = [];
let keyFire = false;
let buttonFire = false;
let stickDir = null;

function syncInput() {
    input.dir = heldDirs.at(-1) ?? stickDir;
    input.fire = keyFire || buttonFire;
}

addEventListener('keydown', (event) => {
    const key = keyOf(event);
    const dir = DIR_KEYS[key];
    const isFire = FIRE_KEYS.has(key);
    if (state === 'playing') {
        if (dir) {
            event.preventDefault();
            if (heldDirs.at(-1) !== dir) {
                const i = heldDirs.indexOf(dir);
                if (i >= 0) heldDirs.splice(i, 1);
                heldDirs.push(dir);
            }
        } else if (isFire) {
            event.preventDefault();
            keyFire = true;
        } else if ((key === 'p' || key === 'Escape') && !event.repeat) {
            pause();
        }
        syncInput();
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
    }
    if (FIRE_KEYS.has(key)) keyFire = false;
    syncInput();
});

document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'start' || action === 'restart') start();
    else if (action === 'resume') resume();
});

$('pause-btn').addEventListener('click', pause);

// ---------- 操作：觸控搖桿與開火鈕 ----------

const stickArrows = [...stick.querySelectorAll('.stick__arrow')];

function resetStick() {
    stickKnob.style.transform = '';
    for (const arrow of stickArrows) arrow.classList.remove('is-active');
}

function updateStick(event) {
    const rect = stick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    const k = distance > STICK_TRAVEL ? STICK_TRAVEL / distance : 1;
    stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    stickDir = distance < STICK_DEADZONE ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    for (const arrow of stickArrows) arrow.classList.toggle('is-active', arrow.dataset.dir === stickDir);
    syncInput();
}

stick.addEventListener('pointerdown', (event) => {
    if (state !== 'playing') return;
    event.preventDefault();
    stick.setPointerCapture(event.pointerId);
    updateStick(event);
});
stick.addEventListener('pointermove', (event) => {
    if (stick.hasPointerCapture(event.pointerId)) updateStick(event);
});
const releaseStick = () => {
    stickDir = null;
    resetStick();
    syncInput();
};
stick.addEventListener('pointerup', releaseStick);
stick.addEventListener('pointercancel', releaseStick);

fireButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    fireButton.setPointerCapture(event.pointerId);
    fireButton.classList.add('is-pressed');
    if (state === 'playing') {
        buttonFire = true;
        syncInput();
    } else if (state === 'ready' || (state === 'over' && performance.now() - overAt >= RESTART_GRACE_MS)) {
        start();
    }
});
const releaseFire = () => {
    fireButton.classList.remove('is-pressed');
    buttonFire = false;
    syncInput();
};
fireButton.addEventListener('pointerup', releaseFire);
fireButton.addEventListener('pointercancel', releaseFire);
for (const element of [stick, fireButton]) element.addEventListener('contextmenu', (event) => event.preventDefault());

autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動：示意盤面 ----------

function demoGame() {
    let seed = 11;
    const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    const demo = createBattle({ random, spawnEnemies: false });
    demo.takeEvents();
    demo.player.x = PLAYER_SPAWN.x;
    demo.player.y = 9 * TILE;
    demo.player.shield = 0;
    demo.player.level = 1;
    demo.addEnemy({ type: 'basic', x: 2 * TILE, y: 4.5 * TILE, dir: 'down' });
    demo.addEnemy({ type: 'fast', x: 8 * TILE, y: 6 * TILE, dir: 'left' });
    demo.addEnemy({ type: 'armor', x: 6 * TILE, y: 1 * TILE, dir: 'down', carrier: true });
    demo.addEnemy({ type: 'power', x: 10 * TILE, y: 9 * TILE, dir: 'down' }).hp = 1;
    demo.spawns.push({ x: 12 * TILE, y: 0, t: SPAWN_TIME / 6, type: 'basic', carrier: false });
    demo.bullets.push({ x: PLAYER_SPAWN.x + 8, y: 7.4 * TILE, dir: 'up', owner: 'player', speed: 0 });
    demo.bullets.push({ x: 10 * TILE + 8, y: 11 * TILE, dir: 'down', owner: 'enemy', speed: 0 });
    demo.powerup = { kind: 'star', x: 9 * TILE, y: 3 * TILE, t: 0 };
    // 打掉幾塊磚，看起來像打過一陣子
    for (const [c, r] of [
        [16, 34],
        [17, 34],
        [18, 34],
        [19, 34],
        [16, 35],
        [17, 35],
        [41, 20],
        [41, 21],
    ]) {
        demo.grid[r * GRID + c] = 0;
    }
    return demo;
}

game = demoGame();
setState('ready');
layout();
renderHud();
