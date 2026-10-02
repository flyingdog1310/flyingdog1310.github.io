// 坦克大戰的遊戲規則（純邏輯，不碰 DOM）
// 座標使用邏輯單位：場地 SIZE × SIZE（13 × 13 格，每格 16），y 向下
// 地形以 4 × 4 的小塊（CELL）記錄，磚牆可以被一點一點打掉

export const TILE = 16;
export const CELL = 4;
export const COLS = 13;
export const SIZE = COLS * TILE;
export const GRID = SIZE / CELL;
export const TANK = 16;

export const EMPTY = 0;
export const BRICK = 1;
export const STEEL = 2;
export const WATER = 3;
export const TREES = 4;

// 坦克不能通過磚、鋼、水；子彈只會被磚和鋼擋下（樹叢只遮住畫面）
const TANK_SOLID = [false, true, true, true, false];
const BULLET_SOLID = [false, true, true, false, false];

export const DIRS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

// 基地（老鷹）在最下排正中央，周圍一圈半格厚的磚牆
export const BASE = { x: 6 * TILE, y: 12 * TILE, size: TILE };
const FORTRESS = { x0: 88, y0: 184, x1: 120, y1: SIZE };
export const PLAYER_SPAWN = { x: 4 * TILE, y: 12 * TILE };
// 敵人輪流從中、右、左三個出生點出現
export const ENEMY_SPAWNS = [
    { x: 6 * TILE, y: 0 },
    { x: 12 * TILE, y: 0 },
    { x: 0, y: 0 },
];

export const ENEMIES_PER_STAGE = 20;
export const MAX_ON_FIELD = 4;
export const START_LIVES = 3;
export const SPAWN_TIME = 0.9;
// 第 4、11、18 輛會閃紅光，打中時掉出道具
const CARRIERS = [4, 11, 18];

export const PLAYER_SPEED = 52;
export const TYPES = {
    basic: { speed: 30, bulletSpeed: 130, hp: 1, points: 100, fireDelay: [0.7, 2] },
    fast: { speed: 62, bulletSpeed: 150, hp: 1, points: 200, fireDelay: [0.7, 2] },
    power: { speed: 40, bulletSpeed: 240, hp: 1, points: 300, fireDelay: [0.4, 1.3] },
    armor: { speed: 32, bulletSpeed: 150, hp: 4, points: 400, fireDelay: [0.5, 1.6] },
};

export const POWERUPS = ['helmet', 'timer', 'shovel', 'star', 'grenade', 'tank'];
export const PICKUP_POINTS = 500;
const HELMET_TIME = 10;
const RESPAWN_SHIELD = 3;
const FREEZE_TIME = 10;
export const SHOVEL_TIME = 15;
const RESPAWN_DELAY = 1.2;
export const STAGE_CLEAR_DELAY = 2.5;

// 地圖：13 行 × 13 字元
// . 空地  # 磚  @ 鋼  ~ 水  % 樹叢；t b l r 是上 / 下 / 左 / 右半格的磚，T B L R 是半格的鋼
// 基地周圍的磚牆、出生點由程式補上 / 清空，地圖裡寫什麼都會被覆蓋
export const MAPS = [
    [
        '.............',
        '.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.',
        '.#.#.#@#.#.#.',
        '.#.#.....#.#.',
        '.....#.#.....',
        'T.tt.....tt.T',
        '.....#.#.....',
        '.#.#.###.#.#.',
        '.#.#.#.#.#.#.',
        '.#.#.....#.#.',
        '.............',
        '.............',
    ],
    [
        '...@...@.....',
        '.#.@...#.#.#.',
        '.#....##.#@#.',
        '...#.....@...',
        '%..#..@..#%#@',
        '%%...#..@.%..',
        '.###%%%@..%#.',
        '...@%#.#.#.#.',
        '@#.@.#.#...#.',
        '.#.#.###.#@#.',
        '.#.#.###.....',
        '.#.......#.#.',
        '.#.#.....###.',
    ],
    [
        '....%%.......',
        '@##.%%.#.#...',
        '%%%.%%.#.#.%%',
        '%%%....###.%%',
        '##...##....%%',
        '~~..#...@.~~~',
        '...#..#.#....',
        '~~~..@.#..~~.',
        '##....#.#..##',
        '%%.###..##.%%',
        '%%.#.....#.%%',
        '%..#.....#..%',
        '.............',
    ],
    [
        '.............',
        '.@@.##.##.@@.',
        '.@...#.#...@.',
        '...#.....#...',
        '##.#@~~~@#.##',
        '.....%%%.....',
        '.##.%%@%%.##.',
        '.....%%%.....',
        '##.#@~~~@#.##',
        '...#.....#...',
        '.@...###...@.',
        '.@@.......@@.',
        '.............',
    ],
];

const TILE_CHARS = {
    '#': [BRICK, 'full'],
    '@': [STEEL, 'full'],
    '~': [WATER, 'full'],
    '%': [TREES, 'full'],
    t: [BRICK, 'top'],
    b: [BRICK, 'bottom'],
    l: [BRICK, 'left'],
    r: [BRICK, 'right'],
    T: [STEEL, 'top'],
    B: [STEEL, 'bottom'],
    L: [STEEL, 'left'],
    R: [STEEL, 'right'],
};

const PER_TILE = TILE / CELL;
const HALF = PER_TILE / 2;
const inHalf = (part, sx, sy) =>
    part === 'full' ||
    (part === 'top' && sy < HALF) ||
    (part === 'bottom' && sy >= HALF) ||
    (part === 'left' && sx < HALF) ||
    (part === 'right' && sx >= HALF);

const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

// 對每個與矩形重疊的地形小塊呼叫 fn(index)
function forCells(x, y, w, h, fn) {
    const c0 = Math.max(0, Math.floor(x / CELL));
    const r0 = Math.max(0, Math.floor(y / CELL));
    const c1 = Math.min(GRID - 1, Math.ceil((x + w) / CELL) - 1);
    const r1 = Math.min(GRID - 1, Math.ceil((y + h) / CELL) - 1);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) if (fn(r * GRID + c) === true) return true;
    }
    return false;
}

// 基地周圍那一圈的小塊（不含基地本身）
export function fortressCells() {
    const cells = [];
    forCells(FORTRESS.x0, FORTRESS.y0, FORTRESS.x1 - FORTRESS.x0, FORTRESS.y1 - FORTRESS.y0, (i) => {
        const x = (i % GRID) * CELL;
        const y = Math.floor(i / GRID) * CELL;
        if (!overlap(x, y, CELL, CELL, BASE.x, BASE.y, BASE.size, BASE.size)) cells.push(i);
    });
    return cells;
}

export function parseMap(rows) {
    if (rows.length !== COLS || rows.some((row) => row.length !== COLS)) throw new Error('地圖必須是 13 × 13');
    const grid = new Uint8Array(GRID * GRID);
    rows.forEach((row, ty) => {
        [...row].forEach((ch, tx) => {
            const fill = TILE_CHARS[ch];
            if (!fill) return;
            const [type, part] = fill;
            for (let sy = 0; sy < PER_TILE; sy++) {
                for (let sx = 0; sx < PER_TILE; sx++) {
                    if (inHalf(part, sx, sy)) grid[(ty * PER_TILE + sy) * GRID + tx * PER_TILE + sx] = type;
                }
            }
        });
    });
    // 出生點、基地一定是空地，基地外圍一定是磚
    for (const spot of [PLAYER_SPAWN, ...ENEMY_SPAWNS, BASE]) {
        forCells(spot.x, spot.y, TILE, TILE, (i) => {
            grid[i] = EMPTY;
        });
    }
    for (const i of fortressCells()) grid[i] = BRICK;
    return grid;
}

// 每關 20 輛敵人的種類：越後面的關卡重裝甲越多
export function enemyQueue(stage, random = Math.random) {
    const s = stage - 1;
    const armor = Math.min(6, Math.max(0, s * 2 - 2));
    const power = Math.min(6, s * 2);
    const fast = Math.min(8, 2 + s * 2);
    const basic = ENEMIES_PER_STAGE - armor - power - fast;
    const queue = [
        ...Array(basic).fill('basic'),
        ...Array(fast).fill('fast'),
        ...Array(power).fill('power'),
        ...Array(armor).fill('armor'),
    ];
    // 洗牌，但重裝甲不會出現在前三輛
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    for (let i = 0; i < 3; i++) {
        if (queue[i] !== 'armor') continue;
        const j = queue.findIndex((type, k) => k >= 3 && type !== 'armor');
        if (j >= 0) [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    return queue;
}

// spawnEnemies: false 時不會出現新敵人，也不會過關（測試與示意畫面用）
export function createBattle({ random = Math.random, maps = MAPS, stage = 1, spawnEnemies = true } = {}) {
    const game = {
        stage,
        grid: null,
        score: 0,
        lives: START_LIVES,
        player: null,
        enemies: [],
        bullets: [],
        spawns: [],
        powerup: null,
        queue: [],
        killed: 0,
        baseAlive: true,
        freeze: 0,
        shovel: 0,
        respawn: 0,
        stageClear: 0,
        time: 0,
        over: false,
        overReason: null,
    };

    let events = [];
    let spawnTimer = 0;
    let spawnIndex = 0;
    let enemyNumber = 0;
    let fireHeld = false;
    const emit = (event) => events.push(event);
    const range = ([min, max]) => min + random() * (max - min);

    // ---------- 關卡 ----------

    function loadStage(n) {
        game.stage = n;
        game.grid = parseMap(maps[(n - 1) % maps.length]);
        game.enemies = [];
        game.bullets = [];
        game.spawns = [];
        game.powerup = null;
        game.queue = enemyQueue(n, random);
        game.killed = 0;
        game.freeze = 0;
        game.shovel = 0;
        game.stageClear = 0;
        spawnTimer = 0.5;
        spawnIndex = 0;
        enemyNumber = 0;
        if (game.lives > 0) placePlayer({ keepLevel: true });
        emit({ type: 'stage-start', stage: n });
    }

    function placePlayer({ keepLevel = false } = {}) {
        const level = keepLevel && game.player ? game.player.level : 0;
        game.player = makeTank({ x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, dir: 'up' });
        Object.assign(game.player, { level, shield: RESPAWN_SHIELD, cooldown: 0, alive: true });
    }

    function makeTank({ x, y, dir }) {
        return { x, y, dir, travel: 0, moving: false };
    }

    // 難度：關卡越後面敵人越快、越常開火、越快補位
    const speedScale = () => Math.min(1.3, 1 + (game.stage - 1) * 0.05);
    const fireScale = () => Math.max(0.55, 1 - (game.stage - 1) * 0.08);
    const spawnDelay = () => Math.max(1.2, 3.2 - (game.stage - 1) * 0.25);

    // ---------- 碰撞 ----------

    const tanks = () => (game.player?.alive ? [game.player, ...game.enemies] : game.enemies);

    function terrainBlocks(x, y, w, h, solid) {
        return forCells(x, y, w, h, (i) => solid[game.grid[i]]);
    }

    // 移動到 (x, y) 是否可行；原本就重疊的坦克可以互相分開，避免卡死
    function canOccupy(tank, x, y) {
        if (x < 0 || y < 0 || x > SIZE - TANK || y > SIZE - TANK) return false;
        if (terrainBlocks(x, y, TANK, TANK, TANK_SOLID)) return false;
        if (overlap(x, y, TANK, TANK, BASE.x, BASE.y, BASE.size, BASE.size)) return false;
        for (const other of tanks()) {
            if (other === tank) continue;
            if (
                overlap(x, y, TANK, TANK, other.x, other.y, TANK, TANK) &&
                !overlap(tank.x, tank.y, TANK, TANK, other.x, other.y, TANK, TANK)
            ) {
                return false;
            }
        }
        // 出生中的敵人也佔位
        for (const spawn of game.spawns) {
            if (
                overlap(x, y, TANK, TANK, spawn.x, spawn.y, TANK, TANK) &&
                !overlap(tank.x, tank.y, TANK, TANK, spawn.x, spawn.y, TANK, TANK)
            ) {
                return false;
            }
        }
        return true;
    }

    // 轉向：轉 90 度時把原本移動軸上的座標對齊半格，比較容易鑽進一格寬的通道
    function steer(tank, dir) {
        if (dir === tank.dir) return;
        const wasHorizontal = DIRS[tank.dir][0] !== 0;
        const nowHorizontal = DIRS[dir][0] !== 0;
        if (wasHorizontal !== nowHorizontal) {
            const axis = wasHorizontal ? 'x' : 'y';
            const snapped = Math.round(tank[axis] / (TILE / 2)) * (TILE / 2);
            const x = axis === 'x' ? snapped : tank.x;
            const y = axis === 'y' ? snapped : tank.y;
            if (canOccupy(tank, x, y)) tank[axis] = snapped;
        }
        tank.dir = dir;
    }

    // 往目前方向前進 dist；被擋住時貼齊障礙物。回傳是否有前進
    function move(tank, dist) {
        const [dx, dy] = DIRS[tank.dir];
        const nx = tank.x + dx * dist;
        const ny = tank.y + dy * dist;
        const before = dx ? tank.x : tank.y;
        if (canOccupy(tank, nx, ny)) {
            tank.x = nx;
            tank.y = ny;
        } else {
            const axis = dx ? 'x' : 'y';
            const sign = dx || dy;
            const target = dx ? nx : ny;
            const flush = (sign > 0 ? Math.floor(target / CELL) : Math.ceil(target / CELL)) * CELL + 0;
            if ((flush - tank[axis]) * sign > 0) {
                const x = axis === 'x' ? flush : tank.x;
                const y = axis === 'y' ? flush : tank.y;
                if (canOccupy(tank, x, y)) tank[axis] = flush;
            }
        }
        const moved = Math.abs((dx ? tank.x : tank.y) - before);
        tank.travel += moved;
        return moved > 0;
    }

    // ---------- 開火與子彈 ----------

    function fire(tank, { owner, speed, power = false }) {
        const [dx, dy] = DIRS[tank.dir];
        game.bullets.push({
            x: tank.x + TANK / 2 + dx * (TANK / 2),
            y: tank.y + TANK / 2 + dy * (TANK / 2),
            dir: tank.dir,
            speed,
            owner,
            power,
            tank,
        });
        emit({ type: 'fire', owner });
    }

    const playerBulletCount = () => game.bullets.filter((b) => b.owner === 'player').length;

    // 打到磚 / 鋼：沿子彈前進方向挖掉 16 寬、8 深的一塊；強化子彈可以打穿鋼板
    function hitTerrain(bullet) {
        const box = [bullet.x - 2, bullet.y - 2, 4, 4];
        const hits = [];
        forCells(...box, (i) => {
            if (BULLET_SOLID[game.grid[i]]) hits.push(i);
        });
        if (hits.length === 0) return false;

        const [dx, dy] = DIRS[bullet.dir];
        // 最先碰到的那一排（離子彈來向最近）
        const rowOf = (i) => (dx ? i % GRID : Math.floor(i / GRID));
        const front = (dx || dy) > 0 ? Math.min(...hits.map(rowOf)) : Math.max(...hits.map(rowOf));
        const depth = [front, front + (dx || dy)];
        const span = dx ? [bullet.y - TANK / 2, bullet.y + TANK / 2] : [bullet.x - TANK / 2, bullet.x + TANK / 2];
        const first = Math.max(0, Math.floor(span[0] / CELL));
        const last = Math.min(GRID - 1, Math.ceil(span[1] / CELL) - 1);

        let destroyed = 0;
        for (const line of depth) {
            if (line < 0 || line >= GRID) continue;
            for (let k = first; k <= last; k++) {
                const i = dx ? k * GRID + line : line * GRID + k;
                const type = game.grid[i];
                if (type === BRICK || (type === STEEL && bullet.power)) {
                    game.grid[i] = EMPTY;
                    destroyed++;
                }
            }
        }
        const steel = destroyed === 0;
        emit({ type: 'impact', kind: steel ? 'steel' : 'brick', x: bullet.x, y: bullet.y, owner: bullet.owner });
        return true;
    }

    function damageEnemy(enemy) {
        if (enemy.carrier) {
            enemy.carrier = false;
            dropPowerup();
        }
        enemy.hp -= 1;
        if (enemy.hp > 0) {
            emit({ type: 'armor-hit', x: enemy.x + TANK / 2, y: enemy.y + TANK / 2, hp: enemy.hp });
            return;
        }
        killEnemy(enemy, TYPES[enemy.type].points);
    }

    function killEnemy(enemy, points) {
        game.enemies = game.enemies.filter((e) => e !== enemy);
        game.killed += 1;
        game.score += points;
        emit({ type: 'kill', kind: enemy.type, x: enemy.x + TANK / 2, y: enemy.y + TANK / 2, points });
    }

    function hitPlayer() {
        const { player } = game;
        if (player.shield > 0) return false;
        player.alive = false;
        game.lives -= 1;
        emit({ type: 'player-hit', x: player.x + TANK / 2, y: player.y + TANK / 2, lives: game.lives });
        if (game.lives <= 0) endGame('lives');
        else game.respawn = RESPAWN_DELAY;
        return true;
    }

    function endGame(reason) {
        if (game.over) return;
        game.over = true;
        game.overReason = reason;
        emit({ type: 'game-over', reason, score: game.score });
    }

    // 子彈分小步前進，避免高速時穿過 4 單位寬的磚塊
    function stepBullet(bullet, dist) {
        const [dx, dy] = DIRS[bullet.dir];
        const steps = Math.ceil(dist / 2);
        for (let s = 0; s < steps; s++) {
            bullet.x += (dx * dist) / steps;
            bullet.y += (dy * dist) / steps;

            if (bullet.x < 0 || bullet.y < 0 || bullet.x > SIZE || bullet.y > SIZE) {
                emit({
                    type: 'impact',
                    kind: 'edge',
                    x: Math.min(Math.max(bullet.x, 0), SIZE),
                    y: Math.min(Math.max(bullet.y, 0), SIZE),
                    owner: bullet.owner,
                });
                return false;
            }
            if (game.baseAlive && overlap(bullet.x - 2, bullet.y - 2, 4, 4, BASE.x, BASE.y, BASE.size, BASE.size)) {
                game.baseAlive = false;
                emit({ type: 'base-destroyed', x: BASE.x + TILE / 2, y: BASE.y + TILE / 2 });
                endGame('base');
                return false;
            }
            if (hitTerrain(bullet)) return false;

            if (bullet.owner === 'player') {
                const enemy = game.enemies.find((e) => overlap(bullet.x - 2, bullet.y - 2, 4, 4, e.x, e.y, TANK, TANK));
                if (enemy) {
                    damageEnemy(enemy);
                    return false;
                }
            } else {
                const { player } = game;
                if (player?.alive && overlap(bullet.x - 2, bullet.y - 2, 4, 4, player.x, player.y, TANK, TANK)) {
                    if (!hitPlayer()) emit({ type: 'impact', kind: 'shield', x: bullet.x, y: bullet.y, owner: bullet.owner });
                    return false;
                }
                // 敵人的子彈打到其他敵人只會消失
                if (game.enemies.some((e) => e !== bullet.tank && overlap(bullet.x - 2, bullet.y - 2, 4, 4, e.x, e.y, TANK, TANK))) {
                    return false;
                }
            }
        }
        return true;
    }

    function updateBullets(dt) {
        game.bullets = game.bullets.filter((bullet) => !game.over && stepBullet(bullet, bullet.speed * dt));
        // 玩家與敵人的子彈互撞會一起消失
        const mine = game.bullets.filter((b) => b.owner === 'player');
        const theirs = game.bullets.filter((b) => b.owner === 'enemy');
        const gone = new Set();
        for (const a of mine) {
            for (const b of theirs) {
                if (gone.has(b)) continue;
                if (overlap(a.x - 3, a.y - 3, 6, 6, b.x - 3, b.y - 3, 6, 6)) {
                    gone.add(a);
                    gone.add(b);
                    emit({ type: 'impact', kind: 'bullet', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, owner: 'player' });
                    break;
                }
            }
        }
        if (gone.size) game.bullets = game.bullets.filter((b) => !gone.has(b));
    }

    // ---------- 玩家 ----------

    function updatePlayer(dt, input) {
        const { player } = game;
        if (!player.alive) {
            if (game.lives > 0 && (game.respawn -= dt) <= 0) placePlayer();
            return;
        }
        player.shield = Math.max(0, player.shield - dt);
        player.cooldown -= dt;
        player.moving = false;
        if (input.dir && DIRS[input.dir]) {
            steer(player, input.dir);
            player.moving = move(player, PLAYER_SPEED * dt);
        }
        // 按住會連發，但同時在場上的子彈有上限（星星 2 級起可以兩發）
        const maxBullets = player.level >= 2 ? 2 : 1;
        if (input.fire && player.cooldown <= 0 && playerBulletCount() < maxBullets) {
            fire(player, { owner: 'player', speed: player.level >= 1 ? 240 : 150, power: player.level >= 3 });
            player.cooldown = fireHeld ? 0.2 : 0.08;
        }
        fireHeld = Boolean(input.fire);
    }

    // ---------- 敵人 ----------

    function updateSpawns(dt) {
        for (const spawn of game.spawns) spawn.t += dt;
        const ready = game.spawns.filter((s) => s.t >= SPAWN_TIME);
        game.spawns = game.spawns.filter((s) => s.t < SPAWN_TIME);
        for (const spawn of ready) {
            const def = TYPES[spawn.type];
            const enemy = makeTank({ x: spawn.x, y: spawn.y, dir: 'down' });
            Object.assign(enemy, {
                type: spawn.type,
                hp: def.hp,
                carrier: spawn.carrier,
                fireTimer: range(def.fireDelay) * fireScale(),
                turnTimer: 0.8 + random() * 2,
                blocked: 0,
            });
            game.enemies.push(enemy);
        }

        spawnTimer -= dt;
        if (!spawnEnemies || spawnTimer > 0 || game.queue.length === 0) return;
        if (game.enemies.length + game.spawns.length >= MAX_ON_FIELD) return;
        const point = ENEMY_SPAWNS[spawnIndex % ENEMY_SPAWNS.length];
        spawnIndex += 1;
        enemyNumber += 1;
        const type = game.queue.shift();
        game.spawns.push({ x: point.x, y: point.y, t: 0, type, carrier: CARRIERS.includes(enemyNumber) });
        emit({ type: 'spawn', x: point.x + TANK / 2, y: point.y + TANK / 2, kind: type });
        spawnTimer = spawnDelay();
    }

    // 換方向：偏向往基地走，有時追玩家，其餘隨機
    function chooseDir(enemy) {
        const roll = random();
        const cx = enemy.x + TANK / 2;
        const cy = enemy.y + TANK / 2;
        let target = null;
        if (roll < 0.4) target = { x: BASE.x + TILE / 2, y: BASE.y + TILE / 2 };
        else if (roll < 0.55 && game.player?.alive) target = { x: game.player.x + TANK / 2, y: game.player.y + TANK / 2 };
        if (target) {
            const dx = target.x - cx;
            const dy = target.y - cy;
            const horizontal = Math.abs(dx) > 8 && (Math.abs(dy) <= 8 || random() < 0.5);
            return horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        }
        const dirs = Object.keys(DIRS);
        return dirs[Math.floor(random() * dirs.length)];
    }

    function updateEnemies(dt) {
        if (game.freeze > 0) {
            for (const enemy of game.enemies) enemy.moving = false;
            return;
        }
        const scale = speedScale();
        for (const enemy of [...game.enemies]) {
            const def = TYPES[enemy.type];
            enemy.moving = move(enemy, def.speed * scale * dt);
            enemy.blocked = enemy.moving ? 0 : enemy.blocked + dt;
            enemy.turnTimer -= dt;
            if (enemy.blocked > 0.12 || enemy.turnTimer <= 0) {
                // 被擋住時有機會先開一槍（把磚牆打開）
                if (enemy.blocked > 0 && random() < 0.5) enemy.fireTimer = Math.min(enemy.fireTimer, 0);
                steer(enemy, chooseDir(enemy));
                enemy.blocked = 0;
                enemy.turnTimer = 0.8 + random() * 2.4;
            }
            enemy.fireTimer -= dt;
            const hasBullet = game.bullets.some((b) => b.tank === enemy);
            if (enemy.fireTimer <= 0 && !hasBullet) {
                fire(enemy, { owner: 'enemy', speed: def.bulletSpeed });
                enemy.fireTimer = range(def.fireDelay) * fireScale();
            }
        }
    }

    // ---------- 道具 ----------

    function dropPowerup() {
        // 隨機放在半格對齊的位置，避開基地附近
        let x;
        let y;
        do {
            x = Math.floor(random() * 24) * (TILE / 2);
            y = Math.floor(random() * 24) * (TILE / 2);
        } while (overlap(x, y, TILE, TILE, FORTRESS.x0 - 8, FORTRESS.y0 - 8, 48, 40));
        const kind = POWERUPS[Math.floor(random() * POWERUPS.length)];
        game.powerup = { kind, x, y, t: 0 };
        emit({ type: 'powerup', kind, x, y });
    }

    function setFortress(type) {
        for (const i of fortressCells()) game.grid[i] = type;
    }

    function collect(kind) {
        const { player } = game;
        switch (kind) {
            case 'helmet':
                player.shield = HELMET_TIME;
                break;
            case 'timer':
                game.freeze = FREEZE_TIME;
                break;
            case 'shovel':
                game.shovel = SHOVEL_TIME;
                setFortress(STEEL);
                break;
            case 'star':
                player.level = Math.min(3, player.level + 1);
                break;
            case 'grenade':
                for (const enemy of [...game.enemies]) killEnemy(enemy, 0);
                break;
            case 'tank':
                game.lives += 1;
                break;
        }
        game.score += PICKUP_POINTS;
        emit({ type: 'pickup', kind, x: game.powerup.x + TILE / 2, y: game.powerup.y + TILE / 2, points: PICKUP_POINTS });
        game.powerup = null;
    }

    function updatePowerup(dt) {
        const { powerup, player } = game;
        if (!powerup) return;
        powerup.t += dt;
        if (player?.alive && overlap(player.x, player.y, TANK, TANK, powerup.x + 2, powerup.y + 2, TILE - 4, TILE - 4)) {
            collect(powerup.kind);
        }
    }

    // ---------- 主迴圈 ----------

    // input：{ dir: 'up' | 'down' | 'left' | 'right' | null（目前按住的方向）, fire（按住中） }
    function update(dt, input = {}) {
        if (game.over) return;
        game.time += dt;

        if (game.stageClear > 0) {
            game.stageClear -= dt;
            if (game.stageClear <= 0) {
                loadStage(game.stage + 1);
                return;
            }
        }

        if (game.freeze > 0) game.freeze = Math.max(0, game.freeze - dt);
        if (game.shovel > 0) {
            game.shovel -= dt;
            if (game.shovel <= 0) {
                game.shovel = 0;
                setFortress(BRICK);
                emit({ type: 'shovel-end' });
            }
        }

        if (game.stageClear <= 0) updateSpawns(dt);
        updatePlayer(dt, input);
        updateEnemies(dt);
        updateBullets(dt);
        if (game.over) return;
        updatePowerup(dt);

        const cleared = game.queue.length === 0 && game.spawns.length === 0 && game.enemies.length === 0;
        if (cleared && game.stageClear <= 0) {
            game.stageClear = STAGE_CLEAR_DELAY;
            emit({ type: 'stage-clear', stage: game.stage });
        }
    }

    function takeEvents() {
        const taken = events;
        events = [];
        return taken;
    }

    // 測試與示意畫面用：直接放一輛敵人到場上
    function addEnemy({ type = 'basic', x, y, dir = 'down', carrier = false }) {
        const enemy = makeTank({ x, y, dir });
        Object.assign(enemy, {
            type,
            hp: TYPES[type].hp,
            carrier,
            fireTimer: Infinity,
            turnTimer: Infinity,
            blocked: 0,
        });
        game.enemies.push(enemy);
        return enemy;
    }

    Object.assign(game, { update, takeEvents, addEnemy, dropPowerup, canOccupy });
    loadStage(stage);
    return game;
}
