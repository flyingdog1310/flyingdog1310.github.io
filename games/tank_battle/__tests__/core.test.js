import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BASE,
    BRICK,
    CELL,
    EMPTY,
    ENEMIES_PER_STAGE,
    GRID,
    MAPS,
    MAX_ON_FIELD,
    PICKUP_POINTS,
    PLAYER_SPAWN,
    SHOVEL_TIME,
    STAGE_CLEAR_DELAY,
    START_LIVES,
    STEEL,
    TILE,
    TYPES,
    WATER,
    createBattle,
    enemyQueue,
    fortressCells,
    parseMap,
} from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

const STEP = 1 / 60;
const EMPTY_MAP = Array(13).fill('.............');

// 指定某一格的地圖（其餘為空地）
function mapWith(tiles) {
    const rows = EMPTY_MAP.map((row) => [...row]);
    for (const [tx, ty, ch] of tiles) rows[ty][tx] = ch;
    return rows.map((row) => row.join(''));
}

// 沒有敵人會出現的場地，方便單獨測試
function quietBattle(map = EMPTY_MAP, options = {}) {
    const game = createBattle({ random: seeded(7), maps: [map], spawnEnemies: false, ...options });
    game.player.shield = 0;
    return game;
}

function run(game, seconds, input = {}) {
    for (let t = 0; t < seconds; t += STEP) game.update(STEP, typeof input === 'function' ? input(t) : input);
}

const cell = (game, x, y) => game.grid[Math.floor(y / CELL) * GRID + Math.floor(x / CELL)];
const types = (events) => events.map((e) => e.type);

test('每張地圖都是 13 × 13，出生點與基地是空地、基地外圍是磚', () => {
    for (const map of MAPS) {
        const grid = parseMap(map);
        for (const i of fortressCells()) assert.equal(grid[i], BRICK);
        for (const [x, y] of [
            [PLAYER_SPAWN.x, PLAYER_SPAWN.y],
            [0, 0],
            [6 * TILE, 0],
            [12 * TILE, 0],
            [BASE.x, BASE.y],
        ]) {
            for (let dy = 0; dy < TILE; dy += CELL) {
                for (let dx = 0; dx < TILE; dx += CELL) {
                    assert.equal(grid[((y + dy) / CELL) * GRID + (x + dx) / CELL], EMPTY);
                }
            }
        }
    }
    assert.throws(() => parseMap(['...']));
});

test('半格的磚只佔一半', () => {
    const grid = parseMap(mapWith([[2, 2, 't']]));
    const at = (x, y) => grid[Math.floor(y / CELL) * GRID + Math.floor(x / CELL)];
    assert.equal(at(2 * TILE + 1, 2 * TILE + 1), BRICK);
    assert.equal(at(2 * TILE + 1, 2 * TILE + 12), EMPTY);
});

test('每關 20 輛，越後面重裝甲越多，前三輛不會是重裝甲', () => {
    for (let stage = 1; stage <= 10; stage++) {
        const queue = enemyQueue(stage, seeded(stage));
        assert.equal(queue.length, ENEMIES_PER_STAGE);
        assert.ok(queue.slice(0, 3).every((type) => type !== 'armor'));
    }
    const count = (stage, type) => enemyQueue(stage, seeded(1)).filter((t) => t === type).length;
    assert.equal(count(1, 'armor'), 0);
    assert.equal(count(1, 'basic'), 18);
    assert.ok(count(5, 'armor') > count(3, 'armor'));
});

test('玩家會被磚牆、水擋住並貼齊，樹叢可以穿過', () => {
    // 玩家出生在 (64, 192)，正上方第 10 排放磚
    const game = quietBattle(mapWith([[4, 10, '#']]));
    run(game, 2, { dir: 'up' });
    assert.equal(game.player.y, 11 * TILE);
    assert.equal(game.player.dir, 'up');

    const water = quietBattle(mapWith([[4, 10, '~']]));
    run(water, 2, { dir: 'up' });
    assert.equal(water.player.y, 11 * TILE);
    assert.equal(cell(water, 4 * TILE, 10 * TILE), WATER);

    const trees = quietBattle(mapWith([[4, 10, '%']]));
    run(trees, 2, { dir: 'up' });
    assert.ok(trees.player.y < 10 * TILE);
});

test('不會開出場地邊界', () => {
    const game = quietBattle();
    run(game, 3, { dir: 'left' });
    assert.equal(game.player.x, 0);
    run(game, 3, { dir: 'down' });
    assert.equal(game.player.y, 12 * TILE);
});

test('轉 90 度時對齊半格，方便鑽進通道', () => {
    const game = quietBattle();
    game.player.y = 100.6;
    game.player.dir = 'up';
    game.update(STEP, { dir: 'left' });
    assert.equal(game.player.y, 104);
    assert.equal(game.player.dir, 'left');
});

test('子彈挖掉 16 寬、8 深的磚，鋼板擋下普通子彈', () => {
    const game = quietBattle(mapWith([[4, 9, '#'], [8, 9, '@']]));
    run(game, 0.05, { fire: true });
    run(game, 2, {});
    // 第 9 排下半挖掉，上半還在
    assert.equal(cell(game, 4 * TILE + 2, 9 * TILE + 12), EMPTY);
    assert.equal(cell(game, 4 * TILE + 14, 9 * TILE + 8), EMPTY);
    assert.equal(cell(game, 4 * TILE + 2, 9 * TILE + 4), BRICK);
    // 再一發打穿
    run(game, 0.05, { fire: true });
    run(game, 2, {});
    assert.equal(cell(game, 4 * TILE + 2, 9 * TILE + 4), EMPTY);

    const steel = quietBattle(mapWith([[4, 9, '@']]));
    run(steel, 0.05, { fire: true });
    run(steel, 2, {});
    const events = steel.takeEvents();
    assert.ok(events.some((e) => e.type === 'impact' && e.kind === 'steel'));
    assert.equal(cell(steel, 4 * TILE + 2, 9 * TILE + 12), STEEL);
});

test('三顆星的子彈可以打掉鋼板', () => {
    const game = quietBattle(mapWith([[4, 9, '@']]));
    game.player.level = 3;
    run(game, 0.05, { fire: true });
    run(game, 2, {});
    assert.equal(cell(game, 4 * TILE + 2, 9 * TILE + 12), EMPTY);
});

test('同時在場上的子彈：一般一發、兩顆星起兩發', () => {
    const game = quietBattle();
    run(game, 0.5, { fire: true });
    assert.equal(game.bullets.filter((b) => b.owner === 'player').length, 1);

    const star = quietBattle();
    star.player.level = 2;
    run(star, 0.5, { fire: true });
    assert.equal(star.bullets.filter((b) => b.owner === 'player').length, 2);
});

test('擊毀敵人依種類計分；重裝甲要打 4 發', () => {
    const game = quietBattle();
    game.addEnemy({ type: 'fast', x: PLAYER_SPAWN.x, y: 5 * TILE });
    run(game, 0.05, { fire: true });
    run(game, 1.5, {});
    assert.equal(game.enemies.length, 0);
    assert.equal(game.score, TYPES.fast.points);
    assert.equal(game.killed, 1);

    const heavy = quietBattle();
    // 定住敵人，避免它開過來把玩家打掉
    heavy.freeze = Infinity;
    const armor = heavy.addEnemy({ type: 'armor', x: PLAYER_SPAWN.x, y: 5 * TILE });
    for (let shot = 1; shot <= 3; shot++) {
        run(heavy, 0.05, { fire: true });
        run(heavy, 1.5, {});
        assert.equal(armor.hp, 4 - shot);
    }
    run(heavy, 0.05, { fire: true });
    run(heavy, 1.5, {});
    assert.equal(heavy.enemies.length, 0);
    assert.equal(heavy.score, TYPES.armor.points);
});

test('被敵彈打中扣命並在出生點重生，重生後有護盾', () => {
    const game = quietBattle();
    const enemy = game.addEnemy({ type: 'basic', x: PLAYER_SPAWN.x, y: 5 * TILE, dir: 'down' });
    enemy.fireTimer = 0;
    run(game, 1.5, {});
    assert.equal(game.lives, START_LIVES - 1);
    assert.ok(types(game.takeEvents()).includes('player-hit'));
    game.enemies = [];
    run(game, 1.5, {});
    assert.ok(game.player.alive);
    assert.equal(game.player.x, PLAYER_SPAWN.x);
    assert.ok(game.player.shield > 0);
});

test('護盾擋下子彈', () => {
    const game = quietBattle();
    game.player.shield = 5;
    const enemy = game.addEnemy({ type: 'basic', x: PLAYER_SPAWN.x, y: 5 * TILE, dir: 'down' });
    enemy.fireTimer = 0;
    run(game, 1.5, {});
    assert.equal(game.lives, START_LIVES);
    assert.ok(game.player.alive);
});

test('命用完就結束', () => {
    const game = quietBattle();
    game.lives = 1;
    const enemy = game.addEnemy({ type: 'power', x: PLAYER_SPAWN.x, y: 5 * TILE, dir: 'down' });
    enemy.fireTimer = 0;
    run(game, 1.5, {});
    assert.ok(game.over);
    assert.equal(game.overReason, 'lives');
});

test('基地被打中就結束（自己打中也算）', () => {
    const game = quietBattle();
    // 把基地外圍清掉，從基地正上方往下打
    for (const i of fortressCells()) game.grid[i] = EMPTY;
    game.player.x = BASE.x;
    game.player.y = 9 * TILE;
    game.player.dir = 'down';
    run(game, 0.05, { fire: true });
    run(game, 1, {});
    assert.ok(game.over);
    assert.equal(game.overReason, 'base');
    assert.equal(game.baseAlive, false);
});

test('玩家與敵人的子彈互撞會一起消失', () => {
    const game = quietBattle();
    const enemy = game.addEnemy({ type: 'basic', x: PLAYER_SPAWN.x, y: 0, dir: 'down' });
    enemy.fireTimer = 0;
    game.player.shield = 0;
    run(game, 0.05, { fire: true });
    run(game, 2, {});
    assert.equal(game.lives, START_LIVES);
    assert.equal(game.enemies.length, 1);
    assert.ok(game.takeEvents().some((e) => e.type === 'impact' && e.kind === 'bullet'));
});

test('場上最多 4 輛，打完 20 輛過關並進入下一關', () => {
    const game = createBattle({ random: seeded(3), maps: [EMPTY_MAP] });
    game.player.shield = Infinity;
    let maxOnField = 0;
    let cleared = false;
    for (let t = 0; t < 600 && !cleared; t += STEP) {
        game.update(STEP, {});
        maxOnField = Math.max(maxOnField, game.enemies.length + game.spawns.length);
        // 模擬玩家把開出來的敵人都打掉（直接移除），子彈也清掉以免打到基地
        game.bullets = [];
        for (const enemy of [...game.enemies]) {
            if (enemy.y > 3 * TILE) {
                game.enemies.splice(game.enemies.indexOf(enemy), 1);
                game.killed++;
            }
        }
        cleared = types(game.takeEvents()).includes('stage-clear');
    }
    assert.ok(cleared, '應該過關');
    assert.ok(maxOnField <= MAX_ON_FIELD);
    assert.equal(game.killed, ENEMIES_PER_STAGE);
    run(game, STAGE_CLEAR_DELAY + 0.1, {});
    assert.equal(game.stage, 2);
    assert.equal(game.queue.length, ENEMIES_PER_STAGE);
});

test('沒有擊毀時場上維持 4 輛，其餘排隊', () => {
    const game = createBattle({ random: seeded(4), maps: [EMPTY_MAP] });
    game.player.shield = Infinity;
    for (let t = 0; t < 30; t += STEP) {
        game.update(STEP, {});
        game.bullets = [];
        assert.ok(game.enemies.length + game.spawns.length <= MAX_ON_FIELD);
    }
    assert.equal(game.enemies.length, MAX_ON_FIELD);
    assert.equal(game.queue.length, ENEMIES_PER_STAGE - MAX_ON_FIELD);
});

test('第 4 輛會帶道具，打中時掉出', () => {
    const game = createBattle({ random: seeded(5), maps: [EMPTY_MAP] });
    game.player.shield = Infinity;
    const carriers = [];
    for (let t = 0; t < 60 && carriers.length === 0; t += STEP) {
        game.update(STEP, {});
        carriers.push(...game.enemies.filter((e) => e.carrier));
        // 讓位子空出來，敵人才會繼續出現
        game.enemies = game.enemies.filter((e) => e.carrier);
    }
    assert.equal(carriers.length, 1);
    assert.equal(game.killed + game.enemies.length + game.spawns.length + game.queue.length, ENEMIES_PER_STAGE - 3);

    const shooter = quietBattle();
    shooter.addEnemy({ type: 'basic', x: PLAYER_SPAWN.x, y: 5 * TILE, carrier: true });
    run(shooter, 0.05, { fire: true });
    run(shooter, 1.5, {});
    assert.ok(shooter.powerup);
});

function pickup(kind, setup = () => {}) {
    const game = quietBattle();
    setup(game);
    game.powerup = { kind, x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y - TILE, t: 0 };
    const before = game.score;
    run(game, 0.5, { dir: 'up' });
    assert.equal(game.powerup, null, `${kind} 應該被撿走`);
    assert.equal(game.score - before >= PICKUP_POINTS, true);
    return game;
}

test('道具：頭盔護盾、星星升級、坦克加命', () => {
    assert.ok(pickup('helmet').player.shield > 9);
    assert.equal(pickup('star').player.level, 1);
    assert.equal(pickup('tank').lives, START_LIVES + 1);
});

test('道具：手榴彈炸掉場上所有敵人（不加分）', () => {
    const game = pickup('grenade', (g) => {
        g.addEnemy({ type: 'basic', x: 0, y: 0 });
        g.addEnemy({ type: 'armor', x: 100, y: 0 });
    });
    assert.equal(game.enemies.length, 0);
    assert.equal(game.killed, 2);
    assert.equal(game.score, PICKUP_POINTS);
});

test('道具：時鐘讓敵人停住', () => {
    const game = pickup('timer', (g) => {
        g.addEnemy({ type: 'fast', x: 0, y: 0, dir: 'right' });
    });
    const enemy = game.enemies[0];
    enemy.turnTimer = Infinity;
    const x = enemy.x;
    run(game, 3, {});
    assert.equal(enemy.x, x);
    run(game, 8, {});
    assert.ok(enemy.x > x || enemy.y > 0);
});

test('道具：鏟子把基地外圍變鋼板，時間到變回完整的磚', () => {
    const game = pickup('shovel', (g) => {
        g.grid[fortressCells()[0]] = EMPTY;
    });
    assert.ok(fortressCells().every((i) => game.grid[i] === STEEL));
    run(game, SHOVEL_TIME, {});
    assert.ok(fortressCells().every((i) => game.grid[i] === BRICK));
});

test('死掉之後星星等級歸零', () => {
    const game = quietBattle();
    game.player.level = 3;
    const enemy = game.addEnemy({ type: 'basic', x: PLAYER_SPAWN.x, y: 5 * TILE, dir: 'down' });
    enemy.fireTimer = 0;
    run(game, 1.5, {});
    game.enemies = [];
    run(game, 1.5, {});
    assert.equal(game.player.level, 0);
});

test('過關時保留分數、命數與星星等級', () => {
    const game = quietBattle();
    game.player.level = 2;
    game.score = 1234;
    game.lives = 2;
    game.queue = [];
    run(game, STAGE_CLEAR_DELAY + 0.2, {});
    assert.equal(game.stage, 2);
    assert.equal(game.score, 1234);
    assert.equal(game.lives, 2);
    assert.equal(game.player.level, 2);
});
