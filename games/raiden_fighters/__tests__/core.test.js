import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BOSS_TIME,
    ENEMIES,
    HEIGHT,
    INVULNERABLE_TIME,
    MAX_POWER,
    RESPAWN_DELAY,
    START_BOMBS,
    START_LIVES,
    WIDTH,
    createRaiden,
    itemWeapon,
} from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

const STEP = 1 / 60;
function run(game, seconds, input) {
    for (let t = 0; t < seconds; t += STEP) game.update(STEP, input);
}

// 讓玩家一直無敵，方便測試與存活無關的規則
function godMode(game) {
    const original = game.update;
    game.update = (dt, input) => {
        game.player.invulnerable = 10;
        original(dt, input);
    };
}

test('玩家移動：斜向不會比較快，且不能離開場地', () => {
    const game = createRaiden({ random: seeded(1) });
    const { x, y } = game.player;
    game.update(0.1, { dx: 1, dy: -1 });
    const moved = Math.hypot(game.player.x - x, game.player.y - y);
    assert.ok(Math.abs(moved - 12) < 0.01, `移動 ${moved}`);

    run(game, 5, { dx: -1, dy: 1 });
    assert.equal(game.player.x, 8);
    assert.equal(game.player.y, HEIGHT - 12);
});

test('慢速移動（focus）比一般移動慢', () => {
    const game = createRaiden({ random: seeded(2) });
    const x = game.player.x;
    game.update(0.1, { dx: 1, focus: true });
    assert.ok(game.player.x - x < 6);
});

test('自動射擊：Vulcan 等級越高子彈越多', () => {
    const counts = [];
    for (let power = 1; power <= MAX_POWER; power++) {
        const game = createRaiden({ random: seeded(3) });
        game.player.power = power;
        game.update(STEP);
        counts.push(game.shots.length);
    }
    assert.deepEqual(
        counts,
        [...counts].sort((a, b) => a - b)
    );
    assert.ok(counts[3] > counts[0]);
});

test('P 道具：每 1.5 秒切換顏色；同色升級、不同色換武器、滿級給分', () => {
    assert.equal(itemWeapon({ age: 0 }), 'vulcan');
    assert.equal(itemWeapon({ age: 1.6 }), 'laser');

    const game = createRaiden({ random: seeded(4) });
    const { player } = game;
    const pickup = (age) => {
        game.items.push({ id: 99, kind: 'power', x: player.x, y: player.y, age, vx: 0 });
        game.update(STEP);
        return game.takeEvents().find((e) => e.type === 'pickup');
    };

    assert.equal(pickup(0).result, 'powerUp');
    assert.equal(player.power, 2);
    assert.equal(pickup(1.6).result, 'switch');
    assert.equal(player.weapon, 'laser');
    assert.equal(player.power, 2);

    player.power = MAX_POWER;
    const score = game.score;
    assert.equal(pickup(1.6).result, 'bonus');
    assert.ok(game.score >= score + 1000);
});

test('擊落敵人得分；砲艇一定掉道具', () => {
    const game = createRaiden({ random: seeded(5) });
    godMode(game);
    const gunship = game.spawnEnemy('gunship', { x: game.player.x, y: 120, move: 'hover', stopY: 120, hold: 10 });
    gunship.hp = 1;
    run(game, 0.7);
    const down = game.takeEvents().find((e) => e.type === 'enemyDown');
    assert.equal(down.kind, 'gunship');
    assert.ok(game.score >= ENEMIES.gunship.points);
    assert.equal(game.items.length, 1);
});

test('被敵彈擊中：少一條命、降一級，之後在下方重生並短暫無敵', () => {
    const game = createRaiden({ random: seeded(6) });
    game.player.power = 3;
    game.fireBullet(game.player.x, game.player.y - 3, Math.PI / 2);
    game.update(STEP);
    assert.equal(game.player.alive, false);
    assert.equal(game.lives, START_LIVES - 1);
    assert.equal(game.player.power, 2);

    run(game, RESPAWN_DELAY + 0.05);
    assert.equal(game.player.alive, true);
    assert.ok(game.player.invulnerable > INVULNERABLE_TIME - 0.2);
    assert.equal(game.bullets.length, 0);
});

test('子彈只打中很小的判定點：擦過機翼不算', () => {
    const game = createRaiden({ random: seeded(7) });
    game.fireBullet(game.player.x + 6, game.player.y - 3, Math.PI / 2);
    run(game, 0.2);
    assert.equal(game.player.alive, true);
});

test('炸彈：清除所有敵彈、傷害畫面上的敵人、期間無敵', () => {
    const game = createRaiden({ random: seeded(8) });
    for (let i = 0; i < 20; i++) game.fireBullet(20 + i * 7, 50, Math.PI / 2);
    const drone = game.spawnEnemy('drone', { x: 40, y: 60, baseX: 40, vy: 0, sway: 0, move: 'sway' });
    assert.ok(game.bomb());
    assert.equal(game.bombs, START_BOMBS - 1);
    assert.equal(game.bullets.length, 0);
    assert.ok(drone.hp <= 0);
    assert.ok(game.player.invulnerable > 1);
    assert.equal(game.bomb(), false, '炸彈進行中不能再放');
});

test('命用完：Game over', () => {
    const game = createRaiden({ random: seeded(9) });
    game.lives = 1;
    game.fireBullet(game.player.x, game.player.y - 3, Math.PI / 2);
    game.update(STEP);
    assert.equal(game.phase, 'over');
    assert.ok(game.takeEvents().some((e) => e.type === 'gameOver'));
});

test(`第 ${BOSS_TIME} 秒出現頭目；擊敗後過關進入下一關`, () => {
    const game = createRaiden({ random: seeded(10) });
    godMode(game);
    run(game, BOSS_TIME + 0.1);
    assert.ok(game.boss);
    assert.ok(game.takeEvents().some((e) => e.type === 'bossAppear'));

    game.boss.hp = 1;
    game.boss.y = 60;
    game.player.x = game.boss.x;
    run(game, 0.5);
    assert.equal(game.boss, null);
    assert.equal(game.phase, 'stageClear');
    run(game, 3.1);
    assert.equal(game.stage, 2);
    assert.equal(game.phase, 'play');
});

test('敵人離開畫面後移除', () => {
    const game = createRaiden({ random: seeded(11) });
    godMode(game);
    game.spawnEnemy('drone', { x: 50, y: -10, baseX: 50, vy: 300, sway: 0, move: 'sway' });
    run(game, 1.5);
    assert.ok(!game.enemies.some((e) => e.baseX === 50 && e.vy === 300));
    assert.ok(WIDTH > 0);
});
