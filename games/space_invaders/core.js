// 太空侵略者的遊戲規則（純邏輯，不碰 DOM）
// 座標使用邏輯像素：場地 WIDTH × HEIGHT，1 單位 = 像素圖的 1 格；畫面再依螢幕大小縮放

export const WIDTH = 240;
export const HEIGHT = 258;

// ---- 像素圖（# 為實心）；外星人有兩個動畫影格 ----
export const SPRITES = {
    squid: [
        ['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'],
        ['...##...', '..####..', '.######.', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.'],
    ],
    crab: [
        ['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
        ['..#.....#..', '#..#...#..#', '#.#######.#', '###.###.###', '###########', '.#########.', '..#.....#..', '.#.......#.'],
    ],
    octopus: [
        ['....####....', '.##########.', '############', '###..##..###', '############', '...##..##...', '..##.##.##..', '##........##'],
        ['....####....', '.##########.', '############', '###..##..###', '############', '..###..###..', '.##..##..##.', '..##....##..'],
    ],
    player: [['......#......', '.....###.....', '.....###.....', '.###########.', '#############', '#############', '#############', '#############']],
    ufo: [['.....######.....', '...##########...', '..############..', '.##.##.##.##.##.', '################', '..###..##..###..', '...#........#...']],
};

const SHIELD_ROWS = [
    '....##############....',
    '...################...',
    '..##################..',
    '.####################.',
    ...Array(7).fill('######################'),
    '########......########',
    '#######........#######',
    '#######........#######',
    '#######........#######',
    '#######........#######',
];

export const ALIEN_TYPES = ['squid', 'crab', 'crab', 'octopus', 'octopus'];
export const ALIEN_POINTS = { squid: 30, crab: 20, octopus: 10 };
export const ALIEN_COLS = 11;
export const ALIEN_ROWS = ALIEN_TYPES.length;
const ALIEN_SPACING_X = 16;
const ALIEN_SPACING_Y = 16;
const ALIEN_HEIGHT = 8;
// 每格外星人的欄寬（最寬的 octopus），各型置中
const CELL_WIDTH = 12;
const FORMATION_TOP = 40;
// 每過一波起始位置往下移，最多移 4 次
const WAVE_DROP = 8;
const MARCH_STEP = 2;
const MARCH_DROP = 8;
const EDGE = 6;

export const PLAYER_Y = 236;
const PLAYER_WIDTH = 13;
const PLAYER_HEIGHT = 8;
const PLAYER_SPEED = 90;
const SHOT_SPEED = 300;
const SHOT_HEIGHT = 5;
const MAX_SHOTS = 2;
const SHOT_COOLDOWN = 0.25;

const BOMB_SPEED = 80;
const BOMB_HEIGHT = 6;
const SHIELD_Y = 200;
const SHIELD_WIDTH = SHIELD_ROWS[0].length;
const SHIELD_HEIGHT = SHIELD_ROWS.length;

const UFO_Y = 22;
const UFO_SPEED = 42;
const UFO_POINTS = [50, 100, 150, 300];

export const RESPAWN_TIME = 1.6;
export const WAVE_PAUSE = 1.8;
export const EXTRA_LIFE_AT = 1500;
export const START_LIVES = 3;

const spriteWidth = (name) => SPRITES[name][0][0].length;

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// 外星人一步的間隔（秒）：越少越快，每過一波再快 10%
export function marchInterval(alive, wave = 1) {
    const base = 0.016 + 0.6 * (alive / (ALIEN_COLS * ALIEN_ROWS)) ** 1.2;
    return base * 0.9 ** Math.min(wave - 1, 6);
}

function createShields() {
    const gap = (WIDTH - 4 * SHIELD_WIDTH) / 5;
    return Array.from({ length: 4 }, (_, i) => ({
        x: Math.round(gap + i * (SHIELD_WIDTH + gap)),
        y: SHIELD_Y,
        w: SHIELD_WIDTH,
        h: SHIELD_HEIGHT,
        cells: Uint8Array.from(SHIELD_ROWS.join(''), (c) => (c === '#' ? 1 : 0)),
    }));
}

function createFormation(wave) {
    const top = FORMATION_TOP + WAVE_DROP * Math.min(wave - 1, 4);
    const left = (WIDTH - ALIEN_COLS * ALIEN_SPACING_X) / 2 + (ALIEN_SPACING_X - CELL_WIDTH) / 2;
    const aliens = [];
    for (let row = 0; row < ALIEN_ROWS; row++) {
        const type = ALIEN_TYPES[row];
        const w = spriteWidth(type);
        for (let col = 0; col < ALIEN_COLS; col++) {
            aliens.push({
                row,
                col,
                type,
                x: left + col * ALIEN_SPACING_X + (CELL_WIDTH - w) / 2,
                y: top + row * ALIEN_SPACING_Y,
                w,
                h: ALIEN_HEIGHT,
                alive: true,
            });
        }
    }
    return aliens;
}

export function createInvaders({ random = Math.random } = {}) {
    const game = {
        aliens: [],
        frame: 0,
        direction: 1,
        player: { x: (WIDTH - PLAYER_WIDTH) / 2, y: PLAYER_Y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT },
        shots: [],
        bombs: [],
        shields: [],
        ufo: null,
        score: 0,
        lives: START_LIVES,
        wave: 0,
        // play：進行中；respawn：被擊中後暫停；waveClear：過關暫停；over：結束
        phase: 'play',
        phaseTimer: 0,
        extraLifeGiven: false,
    };

    let events = [];
    let marchTimer = 0;
    let bombTimer = 1;
    let ufoTimer = 18;
    let shotCooldown = 0;
    let shotsFired = 0;
    const emit = (event) => events.push(event);

    function startWave() {
        game.wave++;
        game.aliens = createFormation(game.wave);
        game.shields = createShields();
        game.direction = 1;
        game.frame = 0;
        game.shots = [];
        game.bombs = [];
        game.ufo = null;
        marchTimer = 0;
        bombTimer = 1.2;
        ufoTimer = 15 + random() * 10;
        game.phase = 'play';
        emit({ type: 'waveStart', wave: game.wave });
    }

    const alive = () => game.aliens.filter((a) => a.alive);

    function addScore(points) {
        game.score += points;
        if (!game.extraLifeGiven && game.score >= EXTRA_LIFE_AT) {
            game.extraLifeGiven = true;
            game.lives++;
            emit({ type: 'extraLife', lives: game.lives });
        }
    }

    // ---- 護盾：以像素為單位判定與侵蝕 ----
    function shieldPixelAt(shield, x, y) {
        const px = Math.floor(x - shield.x);
        const py = Math.floor(y - shield.y);
        if (px < 0 || py < 0 || px >= shield.w || py >= shield.h) return false;
        return shield.cells[py * shield.w + px] === 1;
    }

    // 以 (x, y) 為中心炸出一個不規則的缺口
    function erode(shield, x, y, radius) {
        const cx = x - shield.x;
        const cy = y - shield.y;
        for (let py = Math.floor(cy - radius); py <= cy + radius; py++) {
            for (let px = Math.floor(cx - radius); px <= cx + radius; px++) {
                if (px < 0 || py < 0 || px >= shield.w || py >= shield.h) continue;
                const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
                if (d <= radius * (0.55 + random() * 0.6)) shield.cells[py * shield.w + px] = 0;
            }
        }
    }

    // 子彈（寬 1）從 fromY 移動到 toY 的路徑上碰到的第一個護盾像素
    function hitShield(x, fromY, toY) {
        const step = toY > fromY ? 1 : -1;
        for (const shield of game.shields) {
            if (x < shield.x || x >= shield.x + shield.w) continue;
            for (let y = Math.floor(fromY); step > 0 ? y <= toY : y >= toY; y += step) {
                if (shieldPixelAt(shield, x, y)) return { shield, y };
            }
        }
        return null;
    }

    // ---- 玩家 ----
    function fire() {
        if (game.phase !== 'play' || shotCooldown > 0 || game.shots.length >= MAX_SHOTS) return false;
        const { player } = game;
        game.shots.push({ x: player.x + Math.floor(PLAYER_WIDTH / 2), y: player.y - SHOT_HEIGHT, w: 1, h: SHOT_HEIGHT });
        shotCooldown = SHOT_COOLDOWN;
        shotsFired++;
        emit({ type: 'shoot' });
        return true;
    }

    function hitPlayer() {
        game.lives--;
        emit({ type: 'playerHit', x: game.player.x + PLAYER_WIDTH / 2, y: game.player.y + PLAYER_HEIGHT / 2, lives: game.lives });
        game.shots = [];
        game.bombs = [];
        if (game.lives <= 0) {
            endGame('destroyed');
        } else {
            game.phase = 'respawn';
            game.phaseTimer = RESPAWN_TIME;
        }
    }

    function endGame(cause) {
        game.phase = 'over';
        emit({ type: 'gameOver', cause, score: game.score });
    }

    // ---- 外星人 ----
    function march() {
        const living = alive();
        game.frame ^= 1;
        const minX = Math.min(...living.map((a) => a.x));
        const maxX = Math.max(...living.map((a) => a.x + a.w));
        const next = game.direction * MARCH_STEP;
        if (minX + next < EDGE || maxX + next > WIDTH - EDGE) {
            for (const alien of living) alien.y += MARCH_DROP;
            game.direction *= -1;
        } else {
            for (const alien of living) alien.x += next;
        }
        emit({ type: 'march', frame: game.frame });

        // 外星人壓過護盾時把重疊的部分抹掉
        for (const alien of living) {
            for (const shield of game.shields) {
                if (!overlaps(alien, shield)) continue;
                for (let py = 0; py < alien.h; py++) {
                    for (let px = 0; px < alien.w; px++) {
                        const sx = Math.floor(alien.x + px - shield.x);
                        const sy = Math.floor(alien.y + py - shield.y);
                        if (sx >= 0 && sy >= 0 && sx < shield.w && sy < shield.h) shield.cells[sy * shield.w + sx] = 0;
                    }
                }
            }
        }

        if (living.some((a) => a.y + a.h >= game.player.y)) {
            emit({ type: 'invaded' });
            game.lives = 0;
            endGame('invaded');
        }
    }

    // 從某一欄最下面的外星人投彈；有一半機率挑玩家正上方那一欄
    function dropBomb() {
        const maxBombs = Math.min(3 + Math.floor((game.wave - 1) / 2), 5);
        if (game.bombs.length >= maxBombs) return;
        const bottoms = new Map();
        for (const alien of alive()) {
            const current = bottoms.get(alien.col);
            if (!current || alien.row > current.row) bottoms.set(alien.col, alien);
        }
        const shooters = [...bottoms.values()];
        if (!shooters.length) return;
        const px = game.player.x + PLAYER_WIDTH / 2;
        let shooter;
        if (random() < 0.5) {
            shooter = shooters.reduce((a, b) => (Math.abs(a.x + a.w / 2 - px) <= Math.abs(b.x + b.w / 2 - px) ? a : b));
        } else {
            shooter = shooters[Math.floor(random() * shooters.length)];
        }
        game.bombs.push({
            x: Math.floor(shooter.x + shooter.w / 2),
            y: shooter.y + shooter.h,
            w: 1,
            h: BOMB_HEIGHT,
            kind: random() < 0.5 ? 'zigzag' : 'plunger',
            speed: BOMB_SPEED * (1 + Math.min(game.wave - 1, 5) * 0.08),
        });
    }

    function updateShots(dt) {
        for (const shot of game.shots) {
            const fromY = shot.y;
            shot.y -= SHOT_SPEED * dt;
            if (shot.y + shot.h < 0) {
                shot.dead = true;
                continue;
            }
            const block = hitShield(shot.x, fromY + shot.h, shot.y);
            if (block) {
                erode(block.shield, shot.x + 0.5, block.y, 2.2);
                emit({ type: 'shieldHit', x: shot.x, y: block.y });
                shot.dead = true;
                continue;
            }
            const alien = alive().find((a) => overlaps(shot, a));
            if (alien) {
                alien.alive = false;
                const points = ALIEN_POINTS[alien.type];
                addScore(points);
                emit({ type: 'alienKilled', x: alien.x + alien.w / 2, y: alien.y + alien.h / 2, alien: alien.type, points });
                shot.dead = true;
                continue;
            }
            if (game.ufo && overlaps(shot, game.ufo)) {
                const points = UFO_POINTS[(shotsFired + Math.floor(random() * 4)) % UFO_POINTS.length];
                addScore(points);
                emit({ type: 'ufoKilled', x: game.ufo.x + game.ufo.w / 2, y: game.ufo.y + game.ufo.h / 2, points });
                game.ufo = null;
                shot.dead = true;
                continue;
            }
            const bomb = game.bombs.find((b) => !b.dead && overlaps(shot, b));
            if (bomb) {
                bomb.dead = true;
                shot.dead = true;
                emit({ type: 'clash', x: shot.x, y: shot.y });
            }
        }
        game.shots = game.shots.filter((s) => !s.dead);
    }

    function updateBombs(dt) {
        for (const bomb of game.bombs) {
            if (bomb.dead) continue;
            const fromY = bomb.y;
            bomb.y += bomb.speed * dt;
            const block = hitShield(bomb.x, fromY, bomb.y + bomb.h);
            if (block) {
                erode(block.shield, bomb.x + 0.5, block.y + 1, 2.6);
                emit({ type: 'shieldHit', x: bomb.x, y: block.y });
                bomb.dead = true;
                continue;
            }
            if (overlaps(bomb, game.player)) {
                bomb.dead = true;
                hitPlayer();
                return;
            }
            if (bomb.y > PLAYER_Y + PLAYER_HEIGHT + 4) {
                bomb.dead = true;
                emit({ type: 'bombLanded', x: bomb.x, y: PLAYER_Y + PLAYER_HEIGHT + 4 });
            }
        }
        game.bombs = game.bombs.filter((b) => !b.dead);
    }

    function updateUfo(dt) {
        if (game.ufo) {
            game.ufo.x += game.ufo.vx * dt;
            if (game.ufo.x > WIDTH + 4 || game.ufo.x + game.ufo.w < -4) game.ufo = null;
            return;
        }
        ufoTimer -= dt;
        // 剩太少外星人時不出現（避免拖時間刷分）
        if (ufoTimer <= 0 && alive().length > 8) {
            const fromLeft = random() < 0.5;
            const w = spriteWidth('ufo');
            game.ufo = { x: fromLeft ? -w : WIDTH, y: UFO_Y, w, h: 7, vx: fromLeft ? UFO_SPEED : -UFO_SPEED };
            ufoTimer = 20 + random() * 12;
            emit({ type: 'ufoAppear' });
        }
    }

    // input：{ left, right, fire }；fire 為按住時自動連射
    function update(dt, input = {}) {
        if (game.phase === 'over') return;
        if (game.phase === 'respawn' || game.phase === 'waveClear') {
            game.phaseTimer -= dt;
            if (game.phaseTimer > 0) return;
            if (game.phase === 'waveClear') {
                startWave();
            } else {
                game.phase = 'play';
                game.player.x = (WIDTH - PLAYER_WIDTH) / 2;
                emit({ type: 'respawn' });
            }
            return;
        }

        shotCooldown = Math.max(0, shotCooldown - dt);
        const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const { player } = game;
        player.x = Math.min(Math.max(player.x + move * PLAYER_SPEED * dt, 2), WIDTH - PLAYER_WIDTH - 2);
        if (typeof input.targetX === 'number') {
            // 觸控：往目標位置移動，速度與鍵盤相同上限的 2 倍
            const delta = input.targetX - (player.x + PLAYER_WIDTH / 2);
            const maxStep = PLAYER_SPEED * 2 * dt;
            player.x = Math.min(Math.max(player.x + Math.max(-maxStep, Math.min(maxStep, delta)), 2), WIDTH - PLAYER_WIDTH - 2);
        }
        if (input.fire) fire();

        updateShots(dt);
        if (game.phase !== 'play') return;

        marchTimer += dt;
        const interval = marchInterval(alive().length, game.wave);
        if (marchTimer >= interval) {
            marchTimer = 0;
            march();
            if (game.phase !== 'play') return;
        }

        bombTimer -= dt;
        if (bombTimer <= 0) {
            dropBomb();
            bombTimer = (0.5 + random() * 0.9) * 0.92 ** Math.min(game.wave - 1, 6);
        }

        updateBombs(dt);
        if (game.phase !== 'play') return;
        updateUfo(dt);

        if (alive().length === 0) {
            game.phase = 'waveClear';
            game.phaseTimer = WAVE_PAUSE;
            game.bombs = [];
            game.shots = [];
            game.ufo = null;
            emit({ type: 'waveClear', wave: game.wave });
        }
    }

    function takeEvents() {
        const taken = events;
        events = [];
        return taken;
    }

    startWave();
    Object.assign(game, { update, fire, takeEvents, hitShield, shieldPixelAt });
    return game;
}
