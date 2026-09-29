import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BIRD_FROM,
    BIRD_HEIGHTS,
    DINO_HEIGHT,
    DISTANCE_PER_POINT,
    GROUND_Y,
    MAX_SPEED,
    START_SPEED,
    createRunner,
    minGap,
} from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

const STEP = 1 / 60;

// 跑 seconds 秒並記錄最高點（y 越小越高）；input 可以是函式 (t) => input
function run(game, seconds, input = {}) {
    let peak = game.dino.y;
    for (let t = 0; t < seconds; t += STEP) {
        game.update(STEP, typeof input === 'function' ? input(t) : input);
        peak = Math.min(peak, game.dino.y);
    }
    return peak;
}

const ground = GROUND_Y - DINO_HEIGHT;

// 移除障礙物，只測跳躍
function clearObstacles(game) {
    const original = game.update;
    game.update = (dt, input) => {
        original(dt, input);
        game.obstacles = [];
    };
}

test('按住跳比點一下跳得高；落地後回到地面', () => {
    const long = createRunner({ random: seeded(1) });
    clearObstacles(long);
    const highPeak = run(long, 1.2, (t) => ({ jump: t < 0.5 }));

    const short = createRunner({ random: seeded(1) });
    clearObstacles(short);
    const lowPeak = run(short, 1.2, (t) => ({ jump: t < 0.03 }));

    assert.ok(highPeak < lowPeak - 30, `高跳 ${highPeak} / 小跳 ${lowPeak}`);
    assert.equal(long.dino.y, ground);
    assert.ok(long.dino.onGround);
});

test('按住不放只會跳一次，放開再按才會再跳', () => {
    const game = createRunner({ random: seeded(2) });
    clearObstacles(game);
    let jumps = 0;
    for (let t = 0; t < 2; t += STEP) {
        game.update(STEP, { jump: true });
        jumps += game.takeEvents().filter((e) => e.type === 'jump').length;
    }
    assert.equal(jumps, 1);
});

test('空中按下會加速下墜', () => {
    const normal = createRunner({ random: seeded(3) });
    clearObstacles(normal);
    run(normal, 0.3, { jump: true });
    let tNormal = 0;
    while (!normal.dino.onGround) {
        normal.update(STEP, {});
        tNormal += STEP;
    }

    const fast = createRunner({ random: seeded(3) });
    clearObstacles(fast);
    run(fast, 0.3, { jump: true });
    let tFast = 0;
    while (!fast.dino.onGround) {
        fast.update(STEP, { duck: true });
        tFast += STEP;
    }
    assert.ok(tFast < tNormal * 0.75);
});

test('蹲下只在地面上有效，並能躲過中間高度的翼龍', () => {
    const game = createRunner({ random: seeded(4) });
    game.update(STEP, { duck: true });
    assert.ok(game.dino.ducking);

    game.obstacles = [{ kind: 'bird', level: 'mid', count: 1, x: 120, y: BIRD_HEIGHTS.mid, width: 44, speedBonus: 0, variant: 0 }];
    run(game, 0.5, { duck: true });
    assert.equal(game.over, false);

    const standing = createRunner({ random: seeded(4) });
    standing.obstacles = [{ kind: 'bird', level: 'mid', count: 1, x: 120, y: BIRD_HEIGHTS.mid, width: 44, speedBonus: 0, variant: 0 }];
    run(standing, 0.5, {});
    assert.ok(standing.over);
});

test('高空的翼龍不用閃也不會撞到', () => {
    const game = createRunner({ random: seeded(5) });
    game.obstacles = [{ kind: 'bird', level: 'high', count: 1, x: 120, y: BIRD_HEIGHTS.high, width: 44, speedBonus: 0, variant: 0 }];
    run(game, 0.5, {});
    assert.equal(game.over, false);
});

test('撞到仙人掌：遊戲結束', () => {
    const game = createRunner({ random: seeded(6) });
    game.obstacles = [{ kind: 'cactusLarge', count: 1, x: 110, y: GROUND_Y - 50, width: 25, speedBonus: 0, variant: 0 }];
    run(game, 0.5, {});
    assert.ok(game.over);
    assert.ok(game.takeEvents().some((e) => e.type === 'crash' && e.obstacle === 'cactusLarge'));
});

test('及時跳起可以越過三株一組的大仙人掌', () => {
    const game = createRunner({ random: seeded(7) });
    game.speed = 520;
    game.obstacles = [{ kind: 'cactusLarge', count: 3, x: 180, y: GROUND_Y - 50, width: 75, speedBonus: 0, variant: 0 }];
    // 仙人掌距離恐龍約 80 單位時起跳，按住到最高
    run(game, 0.9, (t) => ({ jump: t > 0.02 && t < 0.4 }));
    // 之後新出現的障礙物不在這個測試範圍內
    assert.ok(!game.takeEvents().some((e) => e.type === 'crash' && e.obstacle === 'cactusLarge'));
    assert.ok(game.obstacles.every((o) => o.kind !== 'cactusLarge' || o.x + o.width < 44));
});

test('分數隨距離增加，速度逐漸上升到上限', () => {
    const game = createRunner({ random: seeded(8) });
    clearObstacles(game);
    run(game, 2);
    assert.ok(game.speed > START_SPEED);
    assert.equal(game.score, Math.floor(game.distance / DISTANCE_PER_POINT));
    run(game, 200);
    assert.equal(game.speed, MAX_SPEED);
});

test('障礙物之間至少保留 minGap 的距離', () => {
    const game = createRunner({ random: seeded(9) });
    const gaps = [];
    const original = game.update;
    for (let t = 0; t < 30; t += STEP) {
        const before = game.obstacles.length;
        original(STEP, {});
        // 讓恐龍不會撞到
        game.over = false;
        if (game.obstacles.length > before && before > 0) {
            const [a, b] = game.obstacles.slice(-2);
            gaps.push(b.x - (a.x + a.width));
        }
        game.dino.y = -500;
    }
    assert.ok(gaps.length > 5);
    for (const gap of gaps) assert.ok(gap >= minGap(START_SPEED) - 1, `gap ${gap}`);
});

test(`分數 ${BIRD_FROM} 之前不會出現翼龍`, () => {
    const game = createRunner({ random: seeded(10) });
    let bird = false;
    for (let t = 0; t < 20; t += STEP) {
        game.update(STEP, {});
        game.over = false;
        game.dino.y = -500;
        if (game.score < BIRD_FROM && game.obstacles.some((o) => o.kind === 'bird')) bird = true;
    }
    assert.equal(bird, false);
});

test('每 100 分觸發一次里程碑', () => {
    const game = createRunner({ random: seeded(11) });
    clearObstacles(game);
    game.distance = 99.5 * DISTANCE_PER_POINT;
    run(game, 0.5);
    assert.deepEqual(
        game.takeEvents().filter((e) => e.type === 'milestone'),
        [{ type: 'milestone', score: 100 }]
    );
});
