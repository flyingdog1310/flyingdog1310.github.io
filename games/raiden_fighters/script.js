// 雷電：畫面與操作。遊戲規則在 core.js
import { WIDTH, HEIGHT, MAX_POWER, PLAYER_HITBOX, createRaiden, itemWeapon } from './core.js';
import { setupCanvas, createLoop, autoPause, highScore } from '../../shared/game-utils.js';

const RESTART_GRACE_MS = 800;
// 觸控拖曳倍率：手指移動 1 單位，飛機移動 TOUCH_GAIN 單位
const TOUCH_GAIN = 1.3;

const $ = (id) => document.getElementById(id);
const root = document.querySelector('.raiden');
const fieldArea = $('field-area');
const field = $('field');
const boardCanvas = $('board');
const callout = $('callout');
const bombButton = $('bomb-btn');
const overlays = { ready: $('overlay-ready'), paused: $('overlay-paused'), over: $('overlay-over') };

const best = highScore('raiden-fighters');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const styles = getComputedStyle(document.documentElement);
const color = (name) => styles.getPropertyValue(name).trim();
const C = Object.fromEntries(
    [
        'sky-top',
        'sky-bottom',
        'map-line',
        'player',
        'player-accent',
        'drone',
        'fighter',
        'gunship',
        'boss',
        'boss-core',
        'vulcan',
        'laser',
        'missile',
        'enemy-bullet',
        'enemy-bullet-large',
        'item-bomb',
    ].map((name) => [name.replace(/-(\w)/g, (_, c) => c.toUpperCase()), color(`--${name}`)])
);

const formatNumber = (n) => n.toLocaleString('en-US');

// ---------- 機體：SVG 路徑（原點在機體中心，單位 = 邏輯單位） ----------

const SHAPES = {
    player: {
        body: new Path2D('M0 -10L2.2 -5L2.4 -1.5L8.5 2.5L8.5 5L2.4 4L1.8 7.5L4.5 9.5L4.5 10.5L-4.5 10.5L-4.5 9.5L-1.8 7.5L-2.4 4L-8.5 5L-8.5 2.5L-2.4 -1.5L-2.2 -5Z'),
        cockpit: new Path2D('M0 -6.5C1.1 -6.5 1.3 -4 1.3 -2.5L-1.3 -2.5C-1.3 -4 -1.1 -6.5 0 -6.5Z'),
        stripe: new Path2D('M2.4 0.5L8.5 3.2L8.5 4.2L2.4 2Z M-2.4 0.5L-8.5 3.2L-8.5 4.2L-2.4 2Z'),
        engines: [[0, 10.5]],
    },
    drone: {
        body: new Path2D('M0 7L5 -0.5L7.5 -6L2.5 -3.5L0 -6L-2.5 -3.5L-7.5 -6L-5 -0.5Z'),
        cockpit: new Path2D('M0 3L1.4 -1L-1.4 -1Z'),
        engines: [[0, -5.5]],
    },
    fighter: {
        body: new Path2D('M0 8.5L3 2.5L9.5 0.5L9.5 -3L3.2 -2L2 -7.5L-2 -7.5L-3.2 -2L-9.5 -3L-9.5 0.5L-3 2.5Z'),
        cockpit: new Path2D('M0 4.5L1.3 0.5L-1.3 0.5Z'),
        engines: [
            [-1.2, -7.5],
            [1.2, -7.5],
        ],
    },
    gunship: {
        body: new Path2D('M0 12L6 8L15 8L15 2L9.5 -2L9.5 -9.5L4.5 -12.5L-4.5 -12.5L-9.5 -9.5L-9.5 -2L-15 2L-15 8L-6 8Z'),
        cockpit: new Path2D('M-3.5 -6H3.5V1H-3.5Z'),
        engines: [
            [-5, -12.5],
            [5, -12.5],
        ],
        turrets: [
            [-10, 4],
            [10, 4],
            [0, 5],
        ],
    },
    boss: {
        body: new Path2D('M0 21L10 15L30 15L37 7L37 -4L27 -12L13 -12L8.5 -21L-8.5 -21L-13 -12L-27 -12L-37 -4L-37 7L-30 15L-10 15Z'),
        cockpit: new Path2D('M-9 -8H9V6H-9Z'),
        engines: [
            [-20, -12],
            [20, -12],
            [-6, -21],
            [6, -21],
        ],
        turrets: [
            [-28, 6],
            [28, 6],
            [-16, 10],
            [16, 10],
        ],
    },
};

const ENEMY_COLORS = () => ({ drone: C.drone, fighter: C.fighter, gunship: C.gunship, boss: C.boss });

function hexToRgb(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
}

function shade(hex, amount) {
    const target = amount > 0 ? 255 : 0;
    const t = Math.abs(amount);
    return `rgb(${hexToRgb(hex)
        .map((c) => Math.round(c + (target - c) * t))
        .join(', ')})`;
}

// ---------- 狀態 ----------

let state = 'ready';
let game = null;
let ctx = null;
let scale = 2;
let overAt = 0;
let effects = [];
let particles = [];
let lastRenderTime = 0;
let scroll = 0;
let bombFlash = -10;
const input = { up: false, down: false, left: false, right: false, focus: false, targetX: undefined, targetY: undefined };
const shown = {};

// 背景的雲：大小不一的半透明團塊，捲動速度比地圖快
const clouds = Array.from({ length: 7 }, () => ({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    r: 18 + Math.random() * 30,
    speed: 45 + Math.random() * 30,
}));

// ---------- 繪圖 ----------

function renderBackground(now) {
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, C.skyTop);
    gradient.addColorStop(1, C.skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 地圖格線：模擬飛越地面
    const grid = 24;
    const offset = scroll % grid;
    ctx.strokeStyle = C.mapLine;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let y = offset - grid; y < HEIGHT; y += grid) {
        ctx.moveTo(0, y);
        ctx.lineTo(WIDTH, y);
    }
    for (let x = grid / 2; x < WIDTH; x += grid) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, HEIGHT);
    }
    ctx.stroke();

    // 雲
    for (const cloud of clouds) {
        const y = ((cloud.y + (scroll * cloud.speed) / 30) % (HEIGHT + cloud.r * 2)) - cloud.r;
        const g = ctx.createRadialGradient(cloud.x, y, 0, cloud.x, y, cloud.r);
        g.addColorStop(0, 'rgba(210, 225, 255, 0.07)');
        g.addColorStop(1, 'rgba(210, 225, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(cloud.x - cloud.r, y - cloud.r, cloud.r * 2, cloud.r * 2);
    }

    // 炸彈閃光
    const sinceBomb = now - bombFlash;
    if (sinceBomb < 0.6) {
        ctx.fillStyle = `rgba(255, 240, 200, ${0.55 * (1 - sinceBomb / 0.6)})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
}

function drawShip(shape, x, y, tint, { flip = false, flash = false, now = 0, accent = null } = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);

    // 引擎火焰（在機身後面）
    const flicker = 0.75 + 0.25 * Math.sin(now * 40 + x);
    for (const [ex, ey] of shape.engines) {
        const len = 5 * flicker;
        const g = ctx.createLinearGradient(0, ey, 0, ey + len);
        g.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
        g.addColorStop(0.4, 'rgba(255, 170, 70, 0.8)');
        g.addColorStop(1, 'rgba(255, 90, 40, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(ex, ey + len / 2, 1.6, len / 2 + 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    const body = ctx.createLinearGradient(-10, -10, 10, 10);
    body.addColorStop(0, shade(tint, 0.35));
    body.addColorStop(0.55, tint);
    body.addColorStop(1, shade(tint, -0.45));
    ctx.fillStyle = flash ? '#fff' : body;
    ctx.strokeStyle = shade(tint, -0.6);
    ctx.lineWidth = 0.6;
    ctx.fill(shape.body);
    ctx.stroke(shape.body);

    if (!flash) {
        if (shape.stripe && accent) {
            ctx.fillStyle = accent;
            ctx.fill(shape.stripe);
        }
        ctx.fillStyle = accent ?? shade(tint, -0.5);
        ctx.fill(shape.cockpit);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillRect(-0.4, -5.5, 0.6, 1.6);
    }
    ctx.restore();
}

function renderEnemies(now) {
    const colors = ENEMY_COLORS();
    for (const enemy of game.enemies) {
        const shape = SHAPES[enemy.kind];
        drawShip(shape, enemy.x, enemy.y, colors[enemy.kind], { flash: enemy.flash > 0, now, flip: false });
        if (shape.turrets && enemy.flash <= 0) {
            ctx.fillStyle = enemy.kind === 'boss' ? C.bossCore : '#ffb347';
            for (const [tx, ty] of shape.turrets) {
                ctx.beginPath();
                ctx.arc(enemy.x + tx, enemy.y + ty, enemy.kind === 'boss' ? 2.6 : 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        if (enemy.kind === 'boss') {
            // 頭目核心：隨血量變紅、脈動
            const pulse = 0.6 + 0.4 * Math.sin(now * 6);
            const g = ctx.createRadialGradient(enemy.x, enemy.y - 1, 0, enemy.x, enemy.y - 1, 9);
            g.addColorStop(0, `rgba(255, 255, 255, ${pulse})`);
            g.addColorStop(0.35, C.bossCore);
            g.addColorStop(1, 'rgba(255, 93, 115, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y - 1, 9, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function renderShots() {
    for (const shot of game.shots) {
        if (shot.kind === 'vulcan') {
            const angle = Math.atan2(shot.vy, shot.vx) + Math.PI / 2;
            ctx.save();
            ctx.translate(shot.x, shot.y);
            ctx.rotate(angle);
            ctx.fillStyle = C.vulcan;
            ctx.beginPath();
            ctx.ellipse(0, 0, 1.3, 3.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff6df';
            ctx.beginPath();
            ctx.ellipse(0, -0.6, 0.6, 2.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (shot.kind === 'laser') {
            ctx.fillStyle = C.laser;
            ctx.globalAlpha = 0.55;
            ctx.fillRect(shot.x - 1.6, shot.y - 9, 3.2, 18);
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#e8fbff';
            ctx.fillRect(shot.x - 0.6, shot.y - 9, 1.2, 18);
        } else {
            ctx.save();
            ctx.translate(shot.x, shot.y);
            ctx.rotate(shot.angle + Math.PI / 2);
            ctx.fillStyle = C.missile;
            ctx.fillRect(-1, -3, 2, 6);
            ctx.fillStyle = '#fff';
            ctx.fillRect(-1, -3, 2, 1.5);
            ctx.fillStyle = 'rgba(255, 190, 90, 0.8)';
            ctx.fillRect(-0.6, 3, 1.2, 2.5);
            ctx.restore();
        }
    }
}

// 敵彈：外圈彩色、中心白色，在任何背景上都容易辨識
function renderBullets() {
    for (const bullet of game.bullets) {
        const large = bullet.size === 'large';
        const r = bullet.radius;
        ctx.fillStyle = large ? C.enemyBulletLarge : C.enemyBullet;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, r + 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function renderItems(now) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 7px ${styles.getPropertyValue('--font-sans')}`;
    for (const item of game.items) {
        let fill;
        let letter;
        if (item.kind === 'power') {
            fill = itemWeapon(item) === 'vulcan' ? C.vulcan : C.laser;
            letter = 'P';
        } else if (item.kind === 'missile') {
            fill = C.missile;
            letter = 'M';
        } else {
            fill = C.itemBomb;
            letter = 'B';
        }
        const pulse = 1 + 0.12 * Math.sin(now * 8);
        ctx.strokeStyle = fill;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 7.5 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(item.x, item.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#10131c';
        ctx.fillText(letter, item.x, item.y + 0.4);
    }
}

function renderPlayer(now) {
    const { player } = game;
    if (!player.alive) return;
    if (player.invulnerable > 0 && game.bombTimer <= 0 && Math.floor(now * 14) % 2 === 0) return;
    drawShip(SHAPES.player, player.x, player.y, C.player, { now, accent: C.playerAccent });
    // 慢速移動時顯示判定點
    if (input.focus || drag) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = C.enemyBullet;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_HITBOX, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
}

function renderBossBar() {
    const boss = game.boss;
    if (!boss) return;
    const w = WIDTH - 24;
    const ratio = Math.max(boss.hp, 0) / boss.maxHp;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(12, 6, w, 3);
    ctx.fillStyle = ratio < 0.5 ? C.bossCore : C.itemBomb;
    ctx.fillRect(12, 6, w * ratio, 3);
}

function renderEffects(now) {
    effects = effects.filter((effect) => now - effect.start < effect.duration);
    for (const effect of effects) {
        const t = (now - effect.start) / effect.duration;
        if (effect.kind === 'boom') {
            ctx.globalAlpha = 1 - t;
            const g = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, effect.radius * (0.5 + t));
            g.addColorStop(0, 'rgba(255, 250, 230, 1)');
            g.addColorStop(0.4, 'rgba(255, 180, 80, 0.9)');
            g.addColorStop(1, 'rgba(255, 90, 40, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, effect.radius * (0.5 + t), 0, Math.PI * 2);
            ctx.fill();
        } else if (effect.kind === 'ring') {
            ctx.globalAlpha = 1 - t;
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 2 * (1 - t) + 0.5;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, effect.radius * t, 0, Math.PI * 2);
            ctx.stroke();
        } else if (effect.kind === 'spark') {
            ctx.globalAlpha = 1 - t;
            ctx.fillStyle = effect.color;
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 2.2 * (1 - t) + 0.4, 0, Math.PI * 2);
            ctx.fill();
        } else if (effect.kind === 'text') {
            ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
            ctx.fillStyle = effect.color;
            ctx.font = `800 7px ${styles.getPropertyValue('--font-sans')}`;
            ctx.textAlign = 'center';
            ctx.fillText(effect.text, effect.x, effect.y - t * 10);
        }
    }
    ctx.globalAlpha = 1;

    const dt = Math.min(now - lastRenderTime, 0.05);
    lastRenderTime = now;
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
        ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 1.5);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

function render(now) {
    ctx.save();
    ctx.scale(scale, scale);
    renderBackground(now);
    if (game) {
        renderItems(now);
        renderEnemies(now);
        renderShots();
        renderPlayer(now);
        renderBullets();
        renderEffects(now);
        renderBossBar();
    }
    ctx.restore();
}

const draw = () => render(performance.now() / 1000);

// ---------- 分數列 ----------

const SHIP_ICON = '<svg viewBox="-9 -11 18 22" aria-hidden="true"><path d="M0 -10L2.2 -5L2.4 -1.5L8.5 2.5L8.5 5L2.4 4L1.8 7.5L4.5 9.5L4.5 10.5L-4.5 10.5L-4.5 9.5L-1.8 7.5L-2.4 4L-8.5 5L-8.5 2.5L-2.4 -1.5L-2.2 -5Z"/></svg>';
const BOMB_ICON = '<svg aria-hidden="true"><use href="#i-bomb"/></svg>';

function setHtml(key, value, element) {
    if (shown[key] === value) return;
    shown[key] = value;
    element.innerHTML = value;
}

function renderHud() {
    const { player } = game;
    setHtml('score', formatNumber(game.score), $('score'));
    const lives = Math.max(game.lives, 0);
    setHtml('lives', `${SHIP_ICON}<span>${lives}</span>`, $('lives'));
    $('lives').setAttribute('aria-label', `${lives} ${lives === 1 ? 'life' : 'lives'}`);
    setHtml('bombs', `${BOMB_ICON}<span>${game.bombs}</span>`, $('bombs'));
    $('bombs').setAttribute('aria-label', `${game.bombs} ${game.bombs === 1 ? 'bomb' : 'bombs'}`);
    $('bomb-count').textContent = game.bombs;
    bombButton.disabled = game.bombs === 0;

    const weaponKey = `${player.weapon}:${player.power}:${player.missiles}`;
    if (shown.weapon !== weaponKey) {
        shown.weapon = weaponKey;
        $('weapon').dataset.weapon = player.weapon;
        $('weapon-name').textContent = `${player.weapon === 'vulcan' ? 'Vulcan' : 'Laser'}${player.missiles ? ` +M${player.missiles}` : ''}`;
        const pips = $('weapon-power');
        pips.innerHTML = Array.from({ length: MAX_POWER }, (_, i) => `<i class="${i < player.power ? 'is-on' : ''}"></i>`).join('');
        pips.setAttribute('aria-label', `Power ${player.power} of ${MAX_POWER}`);
    }
}

// ---------- 版面尺寸 ----------

function layout() {
    const dpr = devicePixelRatio || 1;
    const next = Math.max(1, Math.min(fieldArea.clientWidth / WIDTH, fieldArea.clientHeight / HEIGHT));
    const rounded = Math.floor(next * dpr * 4) / (dpr * 4);
    if (rounded !== scale || !ctx) {
        scale = rounded;
        const w = Math.round(WIDTH * scale);
        const h = Math.round(HEIGHT * scale);
        field.style.width = `${w}px`;
        field.style.height = `${h}px`;
        root.style.setProperty('--board-width', `${w}px`);
        ctx = setupCanvas(boardCanvas, w, h);
    }
    draw();
}

new ResizeObserver(layout).observe(fieldArea);

// ---------- 遊戲事件 → 畫面特效 ----------

function burst(x, y, tint, count, speed = 60, size = 1.4) {
    if (reduceMotion.matches) return;
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.7);
        const life = 0.3 + Math.random() * 0.45;
        particles.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, size: size * (0.6 + Math.random() * 0.8), color: tint, life, maxLife: life });
    }
}

function shake() {
    if (reduceMotion.matches) return;
    field.classList.remove('is-shake');
    void field.offsetWidth;
    field.classList.add('is-shake');
}

function showCallout(title, detail, { warning = false } = {}) {
    callout.replaceChildren(title, ...(detail ? [Object.assign(document.createElement('small'), { textContent: detail })] : []));
    callout.classList.toggle('is-warning', warning);
    callout.classList.remove('is-showing');
    void callout.offsetWidth;
    callout.classList.add('is-showing');
}

const PICKUP_TEXT = {
    powerUp: (e) => `Power ${e.power}`,
    switch: (e) => (e.weapon === 'vulcan' ? 'Vulcan' : 'Laser'),
    missileUp: () => 'Missile up',
    bombUp: () => 'Bomb +1',
    bonus: () => '1,000',
};

function handleEvents(now) {
    const colors = ENEMY_COLORS();
    for (const event of game.takeEvents()) {
        switch (event.type) {
            case 'hit':
                effects.push({ kind: 'spark', x: event.x, y: event.y, color: event.kind === 'laser' ? C.laser : C.vulcan, start: now, duration: 0.12 });
                break;
            case 'enemyDown': {
                const big = event.kind === 'gunship' || event.kind === 'boss';
                effects.push({ kind: 'boom', x: event.x, y: event.y, radius: big ? 22 : 10, start: now, duration: big ? 0.5 : 0.3 });
                burst(event.x, event.y, colors[event.kind], big ? 30 : 12, big ? 90 : 60);
                burst(event.x, event.y, '#ffd08a', big ? 20 : 6, big ? 70 : 40);
                if (event.kind === 'boss') {
                    // 頭目：連續多段爆炸
                    for (let i = 1; i <= 6; i++) {
                        effects.push({
                            kind: 'boom',
                            x: event.x + (Math.random() - 0.5) * 60,
                            y: event.y + (Math.random() - 0.5) * 30,
                            radius: 16 + Math.random() * 14,
                            start: now + i * 0.12,
                            duration: 0.45,
                        });
                    }
                    effects.push({ kind: 'ring', x: event.x, y: event.y, radius: 120, color: '#fff', start: now, duration: 0.8 });
                }
                if (big) {
                    effects.push({ kind: 'text', x: event.x, y: event.y - 12, text: formatNumber(event.points), color: '#fff', start: now, duration: 1.2 });
                    shake();
                }
                break;
            }
            case 'pickup':
                effects.push({ kind: 'ring', x: event.x, y: event.y, radius: 16, color: '#fff', start: now, duration: 0.3 });
                effects.push({ kind: 'text', x: event.x, y: event.y - 8, text: PICKUP_TEXT[event.result](event), color: '#fff', start: now, duration: 1 });
                break;
            case 'bomb':
                bombFlash = now;
                effects.push({ kind: 'ring', x: event.x, y: event.y, radius: 260, color: C.itemBomb, start: now, duration: 0.9 });
                shake();
                break;
            case 'playerDown':
                effects.push({ kind: 'boom', x: event.x, y: event.y, radius: 24, start: now, duration: 0.6 });
                effects.push({ kind: 'ring', x: event.x, y: event.y, radius: 50, color: C.playerAccent, start: now, duration: 0.5 });
                burst(event.x, event.y, C.player, 30, 90);
                burst(event.x, event.y, C.playerAccent, 16, 70);
                shake();
                break;
            case 'bossAppear':
                showCallout('Warning', 'A huge battleship is approaching', { warning: true });
                break;
            case 'stageClear':
                showCallout(`Stage ${event.stage} clear`);
                break;
            case 'stageStart':
                showCallout(`Stage ${event.stage}`);
                break;
            case 'gameOver':
                setTimeout(finish, 1300);
                break;
        }
    }
}

// ---------- 遊戲流程 ----------

const loop = createLoop({
    update(dt) {
        if (state !== 'playing' || !game) return;
        const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        game.update(dt, { dx, dy, focus: input.focus, targetX: input.targetX, targetY: input.targetY });
        scroll += dt * 30;
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
        Object.assign(input, { up: false, down: false, left: false, right: false, focus: false, targetX: undefined, targetY: undefined });
        drag = null;
    }
}

function start() {
    game = createRaiden();
    effects = [];
    particles = [];
    bombFlash = -10;
    callout.classList.remove('is-showing');
    renderHud();
    document.activeElement?.blur();
    setState('playing');
    showCallout('Stage 1');
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
    note.textContent = isRecord ? 'New best score' : `Reached stage ${game.stage}. Best ${formatNumber(record ?? 0)}`;
    note.classList.toggle('is-record', isRecord);
    overAt = performance.now();
    setState('over');
    draw();
}

function useBomb() {
    if (state === 'playing') game.bomb();
}

// ---------- 操作 ----------

const KEYS = {
    ArrowLeft: 'left',
    a: 'left',
    ArrowRight: 'right',
    d: 'right',
    ArrowUp: 'up',
    w: 'up',
    ArrowDown: 'down',
    s: 'down',
    Shift: 'focus',
};
const keyOf = (event) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);

addEventListener('keydown', (event) => {
    const key = keyOf(event);
    if (state === 'playing') {
        const action = KEYS[key];
        if (action) {
            event.preventDefault();
            input[action] = true;
        } else if ((key === 'x' || key === 'b') && !event.repeat) {
            useBomb();
        } else if ((key === 'p' || key === 'Escape') && !event.repeat) {
            pause();
        } else if (key === ' ') {
            event.preventDefault();
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
bombButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    useBomb();
});

// 拖曳：整個畫面都能操作（手機可在場地下方拖），飛機跟著手指的位移移動
let drag = null;
root.addEventListener('pointerdown', (event) => {
    if (state !== 'playing' || event.target.closest('button, .overlay')) return;
    root.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, shipX: game.player.x, shipY: game.player.y };
    input.targetX = drag.shipX;
    input.targetY = drag.shipY;
});

root.addEventListener('pointermove', (event) => {
    if (!drag || state !== 'playing') return;
    let tx = drag.shipX + ((event.clientX - drag.x) / scale) * TOUCH_GAIN;
    let ty = drag.shipY + ((event.clientY - drag.y) / scale) * TOUCH_GAIN;
    // 目標超出場地時重設起點，手指往回拉能立刻反應
    const cx = Math.min(Math.max(tx, 8), WIDTH - 8);
    const cy = Math.min(Math.max(ty, 16), HEIGHT - 12);
    if (cx !== tx || cy !== ty) {
        drag = { x: event.clientX, y: event.clientY, shipX: cx, shipY: cy };
        tx = cx;
        ty = cy;
    }
    input.targetX = tx;
    input.targetY = ty;
});

const endDrag = () => {
    drag = null;
    input.targetX = undefined;
    input.targetY = undefined;
};
root.addEventListener('pointerup', endDrag);
root.addEventListener('pointercancel', endDrag);

autoPause({ pause, resume() {} });
addEventListener('blur', pause);

// ---------- 啟動：開始畫面後方的示意畫面 ----------

function demoGame() {
    const demo = createRaiden({ random: () => 0.35 });
    demo.player.y = HEIGHT - 60;
    demo.spawnEnemy('gunship', { x: 60, y: 70, move: 'hover', stopY: 70, hold: 9 });
    for (let i = 0; i < 5; i++) {
        const x = 115 + (i - 2) * 14;
        demo.spawnEnemy('drone', { x, y: 40 - Math.abs(i - 2) * 10, baseX: x, vy: 0, sway: 0, move: 'sway' });
    }
    for (let i = 0; i < 6; i++) demo.fireBullet(60, 80, Math.PI / 2 + (i - 2.5) * 0.3);
    demo.update(0.35, {});
    demo.items.push({ id: 1, kind: 'power', x: 130, y: 150, age: 0, vx: 0 });
    return demo;
}

game = demoGame();
setState('ready');
layout();
renderHud();
