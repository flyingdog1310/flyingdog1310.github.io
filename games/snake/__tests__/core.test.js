import test from 'node:test';
import assert from 'node:assert/strict';
import { BONUS_DURATION, BONUS_EVERY, BONUS_POINTS, FOOD_POINTS, createSnake, speedFor } from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// 走 n 步（依目前速度換算時間）
function steps(game, n = 1) {
    for (let i = 0; i < n; i++) game.update(1 / speedFor(game.eaten) + 1e-9);
}

const head = (game) => game.body[0];

test('開始前不會移動；第一次轉向後開始', () => {
    const game = createSnake({ random: seeded(1) });
    const start = { ...head(game) };
    game.update(2);
    assert.deepEqual(head(game), start);

    assert.ok(game.turn('up'));
    steps(game);
    assert.deepEqual(head(game), { x: start.x, y: start.y - 1 });
    assert.equal(game.body.length, 3);
});

test('不能直接迴轉；快速連按兩次轉向會依序執行', () => {
    const game = createSnake({ random: seeded(2) });
    game.start();
    assert.equal(game.turn('left'), false, '往右時不能直接往左');

    const start = { ...head(game) };
    assert.ok(game.turn('up'));
    assert.ok(game.turn('left'));
    assert.equal(game.turn('right'), false, '與最後排入的方向相反');
    steps(game, 2);
    assert.deepEqual(head(game), { x: start.x - 1, y: start.y - 1 });
});

test('吃到果實：變長、加分、出現新果實且不在蛇身上', () => {
    const game = createSnake({ random: seeded(3) });
    game.start();
    game.food = { x: head(game).x + 1, y: head(game).y };
    steps(game);
    assert.equal(game.body.length, 4);
    assert.equal(game.score, FOOD_POINTS);
    assert.equal(game.eaten, 1);
    assert.equal(game.prevTail, null);
    assert.deepEqual(game.bulges, [0]);
    assert.ok(!game.body.some((p) => p.x === game.food.x && p.y === game.food.y));
    assert.ok(game.takeEvents().some((e) => e.type === 'eat' && e.kind === 'food'));

    steps(game);
    assert.deepEqual(game.bulges, [1]);
});

test('撞牆結束', () => {
    const game = createSnake({ cols: 6, rows: 6, random: seeded(4) });
    game.food = { x: 0, y: 0 };
    game.start();
    steps(game, 10);
    assert.ok(game.over);
    assert.deepEqual(
        game.takeEvents().filter((e) => e.type === 'die'),
        [{ type: 'die', cause: 'wall', score: 0 }]
    );
});

test('撞到自己結束，但可以走進尾巴剛離開的格子', () => {
    const game = createSnake({ random: seeded(5) });
    game.food = { x: 0, y: 0 };
    game.body = [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
    ];
    game.dir = { x: 1, y: 0 };
    game.turn('down');
    steps(game);
    assert.equal(game.over, false, '尾巴 (5,6) 同一步移開');
    assert.deepEqual(head(game), { x: 5, y: 6 });

    const loop = createSnake({ random: seeded(5) });
    loop.food = { x: 0, y: 0 };
    loop.body = [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
        { x: 6, y: 6 },
    ];
    loop.dir = { x: 1, y: 0 };
    loop.turn('down');
    steps(loop);
    assert.ok(loop.over);
});

test('速度隨吃到的數量上升並有上限', () => {
    assert.equal(speedFor(0), 6);
    assert.ok(speedFor(10) > speedFor(5));
    assert.equal(speedFor(1000), 14);
});

test('金色果實：每吃 5 顆出現，限時消失；越早吃分數越高', () => {
    const game = createSnake({ random: seeded(6) });
    game.start();
    game.eaten = BONUS_EVERY - 1;
    game.food = { x: head(game).x + 1, y: head(game).y };
    steps(game);
    assert.ok(game.bonus);
    assert.ok(game.takeEvents().some((e) => e.type === 'bonus'));

    game.bonus.time = 0.01;
    game.update(0.02);
    assert.equal(game.bonus, null);
    assert.ok(game.takeEvents().some((e) => e.type === 'bonusExpired'));

    const fresh = createSnake({ random: seeded(7) });
    fresh.start();
    fresh.food = { x: 0, y: 0 };
    fresh.bonus = { x: head(fresh).x + 1, y: head(fresh).y, time: BONUS_DURATION };
    fresh.update(1 / speedFor(0) + 1e-9);
    const eat = fresh.takeEvents().find((e) => e.type === 'eat');
    assert.equal(eat.kind, 'bonus');
    assert.ok(eat.points > BONUS_POINTS * 0.8);
    assert.equal(fresh.body.length, 4);
});

test('填滿整個場地就獲勝', () => {
    const game = createSnake({ cols: 2, rows: 2, random: seeded(8) });
    game.body = [
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
    ];
    game.dir = { x: 0, y: 1 };
    game.food = { x: 1, y: 1 };
    game.turn('right');
    steps(game);
    assert.ok(game.won);
    assert.ok(game.over);
});

test('progress：兩步之間 0 到 1', () => {
    const game = createSnake({ random: seeded(9) });
    game.start();
    game.update(0.5 / speedFor(0));
    assert.ok(Math.abs(game.progress - 0.5) < 1e-6);
});
