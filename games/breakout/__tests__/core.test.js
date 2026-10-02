import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BALL_R,
    BRICK_H,
    BRICK_POINTS,
    BRICK_W,
    BRICKS_LEFT,
    BRICKS_TOP,
    CAPSULE_POINTS,
    CATCH_HOLD,
    COLS,
    EXPANDED_W,
    HEIGHT,
    LEVELS,
    LEVEL_CLEAR_DELAY,
    PADDLE_W,
    PADDLE_Y,
    START_LIVES,
    WIDTH,
    createBreakout,
    parseLevel,
    silverHits,
} from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

const STEP = 1 / 60;
const EMPTY_ROW = '.'.repeat(COLS);

function run(game, seconds, input = {}) {
    for (let t = 0; t < seconds; t += STEP) game.update(STEP, typeof input === 'function' ? input(t) : input);
}

// 自訂關卡：rows 為磚塊排列
function custom(rows, options = {}) {
    return createBreakout({ random: seeded(3), levels: [rows], ...options });
}

// 把球放到指定位置與速度（已發射）
function place(game, x, y, vx, vy) {
    const ball = game.balls[0];
    Object.assign(ball, { x, y, vx, vy, stuck: null, speed: Math.hypot(vx, vy) });
    return ball;
}

const types = (events) => events.map((e) => e.type);

test('每個關卡都是 12 欄，且有可以打破的磚', () => {
    for (const [i, rows] of LEVELS.entries()) {
        const bricks = parseLevel(rows, i + 1);
        assert.ok(bricks.some((b) => b.hp !== Infinity));
    }
    assert.throws(() => parseLevel(['...']));
    assert.throws(() => parseLevel(['x'.repeat(COLS)]));
});

test('銀磚耐打次數與分數隨關卡增加，金磚打不破', () => {
    assert.equal(silverHits(1), 2);
    assert.equal(silverHits(5), 3);
    assert.equal(silverHits(20), 4);
    const [silver, gold] = parseLevel(['sG' + '.'.repeat(COLS - 2)], 3);
    assert.equal(silver.hp, 2);
    assert.equal(silver.points, 150);
    assert.equal(gold.hp, Infinity);
});

test('開局時球黏在擋板上，按下發射才出去', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    run(game, 1, { dir: 1 });
    const ball = game.balls[0];
    assert.ok(ball.stuck);
    assert.equal(ball.y, PADDLE_Y - BALL_R);
    assert.ok(Math.abs(ball.x - (game.paddle.x + game.paddle.w / 2)) < 0.001);
    game.update(STEP, { launch: true });
    assert.equal(ball.stuck, null);
    assert.ok(ball.vy < 0);
    // 按住不放不會重複觸發
    run(game, 0.2, { launch: true });
    assert.equal(types(game.takeEvents()).filter((t) => t === 'launch').length, 1);
});

test('擋板不會超出場地；滑鼠 / 觸控位置優先於鍵盤', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    run(game, 3, { dir: -1 });
    assert.equal(game.paddle.x, 0);
    run(game, 3, { dir: 1 });
    assert.equal(game.paddle.x, WIDTH - PADDLE_W);
    game.update(STEP, { dir: 1, target: 100 });
    assert.equal(game.paddle.x, 100 - PADDLE_W / 2);
});

test('打在擋板中央垂直反彈，越靠邊越斜', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    game.paddle.x = 100;
    const center = 100 + PADDLE_W / 2;
    const ball = place(game, center, PADDLE_Y - 10, 0, 200);
    run(game, 0.1);
    assert.ok(Math.abs(ball.vx) < 1);
    assert.ok(ball.vy < 0);

    const edge = place(game, center + PADDLE_W / 2 - 1, PADDLE_Y - 10, 0, 200);
    run(game, 0.1);
    assert.ok(edge.vx > 100, `vx ${edge.vx}`);
    assert.ok(edge.vy < 0);
});

test('打破磚塊得分、反彈並加速', () => {
    const rows = ['.....r......', EMPTY_ROW, EMPTY_ROW, 'G' + '.'.repeat(COLS - 1)];
    const game = custom(rows);
    const x = BRICKS_LEFT + 5 * BRICK_W + BRICK_W / 2;
    const ball = place(game, x, BRICKS_TOP + 40, 0, -200);
    run(game, 0.3);
    assert.equal(game.score, BRICK_POINTS.r);
    assert.ok(ball.vy > 0);
    assert.ok(ball.speed > 200);
});

test('銀磚要打多下，金磚打不破也不加速', () => {
    const game = custom(['s' + '.'.repeat(COLS - 1), EMPTY_ROW, EMPTY_ROW, '.'.repeat(COLS - 1) + 'r']);
    const silver = game.bricks.find((b) => b.kind === 's');
    const x = BRICKS_LEFT + BRICK_W / 2;
    place(game, x, BRICKS_TOP + BRICK_H + 6, 0, -200);
    run(game, 0.1);
    assert.equal(silver.hp, 1);
    assert.equal(game.score, 0);

    const gold = custom(['G' + '.'.repeat(COLS - 1), 'r' + '.'.repeat(COLS - 1)].reverse());
    const goldBrick = gold.bricks.find((b) => b.kind === 'G');
    const ball = place(gold, x, goldBrick.y + BRICK_H + 6, 0, -200);
    run(gold, 0.1);
    assert.ok(gold.bricks.includes(goldBrick));
    assert.equal(ball.speed, 200);
    assert.ok(ball.vy > 0);
});

test('撞牆時垂直速度不會太小', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    const ball = place(game, 10, 300, -300, -5);
    run(game, 0.1);
    assert.ok(ball.vx > 0);
    assert.ok(Math.abs(ball.vy) >= ball.speed * 0.3 - 0.001);
    assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - ball.speed) < 0.001);
});

test('球掉下去扣命並重新發球；命用完就結束', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    place(game, 10, HEIGHT - 10, 0, 300);
    game.paddle.x = 200;
    run(game, 0.2, { target: 250 });
    assert.equal(game.lives, START_LIVES - 1);
    assert.ok(game.balls[0].stuck);

    game.lives = 1;
    place(game, 10, HEIGHT - 10, 0, 300);
    run(game, 0.2, { target: 250 });
    assert.ok(game.over);
    assert.ok(types(game.takeEvents()).includes('game-over'));
});

test('打完可打破的磚就過關（金磚不用打），進入下一關', () => {
    const game = custom(['r' + 'G'.repeat(COLS - 1)]);
    const x = BRICKS_LEFT + BRICK_W / 2;
    place(game, x, BRICKS_TOP + 30, 0, -200);
    run(game, 0.3);
    assert.ok(types(game.takeEvents()).includes('level-clear'));
    run(game, LEVEL_CLEAR_DELAY + 0.1);
    assert.equal(game.level, 2);
    assert.ok(game.balls[0].stuck);
    assert.equal(game.bricks.length, COLS);
});

test('道具 E 加長擋板，換別的道具或掉球會恢復', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    game.collect('E');
    assert.equal(game.paddle.w, EXPANDED_W);
    assert.equal(game.score, CAPSULE_POINTS);
    game.collect('L');
    assert.equal(game.paddle.w, PADDLE_W);
    assert.equal(game.mode, 'laser');
    game.collect('E');
    place(game, 10, HEIGHT - 10, 0, 300);
    run(game, 0.2, { target: 250 });
    assert.equal(game.paddle.w, PADDLE_W);
    assert.equal(game.mode, null);
});

test('道具 C 接住球，按發射或時間到才出去', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    game.collect('C');
    game.paddle.x = 100;
    const ball = place(game, 120, PADDLE_Y - 20, 0, 200);
    run(game, 0.2, { target: 126 });
    assert.ok(ball.stuck);
    run(game, CATCH_HOLD + 0.1, { target: 126 });
    assert.equal(ball.stuck, null);
    assert.ok(ball.vy < 0);
});

test('道具 D 分裂成三顆，掉光才扣命', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    place(game, 160, 200, 0, -200);
    game.collect('D');
    assert.equal(game.balls.length, 3);
    // 兩顆掉下去還有一顆
    game.balls[1].y = HEIGHT + 10;
    game.balls[2].y = HEIGHT + 10;
    game.update(STEP, {});
    assert.equal(game.balls.length, 1);
    assert.equal(game.lives, START_LIVES);
});

test('道具 S 減速、P 加命', () => {
    const game = custom(['r' + '.'.repeat(COLS - 1)]);
    const ball = place(game, 160, 200, 0, -400);
    game.collect('S');
    assert.ok(ball.speed < 400);
    assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - ball.speed) < 0.001);
    game.collect('P');
    assert.equal(game.lives, START_LIVES + 1);
});

test('雷射：按住開火打掉磚塊', () => {
    const game = custom(['rrrrrrrrrrrr']);
    game.collect('L');
    game.paddle.x = BRICKS_LEFT;
    const before = game.bricks.length;
    run(game, 1, { fire: true, target: BRICKS_LEFT + PADDLE_W / 2 });
    assert.ok(game.bricks.length <= before - 2);
});

test('擋板接到膠囊才生效；同時只會掉一顆', () => {
    const rows = ['rrrrrrrrrrrr', 'rrrrrrrrrrrr'];
    // random 永遠回傳 0：每塊都會掉膠囊、種類固定為 E
    const game = createBreakout({ random: () => 0, levels: [rows] });
    const ball = place(game, BRICKS_LEFT + BRICK_W / 2, BRICKS_TOP + 40, 0, -200);
    run(game, 0.3, { target: 300 });
    assert.equal(game.capsules.length, 1);
    ball.y = 100;
    ball.vy = -200;
    run(game, 0.5, { target: 300 });
    assert.equal(game.capsules.length, 1);

    const capsule = game.capsules[0];
    run(game, 5, () => ({ target: capsule.x + 11 }));
    assert.equal(game.mode, 'expand');
});
