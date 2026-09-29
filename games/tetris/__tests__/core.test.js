import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COLS,
    ROWS,
    TYPES,
    CLEAR_DURATION,
    LOCK_DELAY,
    createBag,
    createTetris,
    emptyBoard,
    gravityFor,
    pieceCells,
    scoreFor,
} from '../core.js';

// 固定亂數，讓測試可重現
function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// 把指定列填滿，holes 內的欄位留空
function fillRow(board, y, holes = []) {
    board[y] = board[y].map((_, x) => (holes.includes(x) ? null : 'J'));
}

function place(game, type, rotation, x, y) {
    game.active = { type, rotation, x, y };
}

test('createBag：每 7 個方塊內各種類剛好一次', () => {
    const next = createBag(seeded(7));
    for (let round = 0; round < 5; round++) {
        const bag = Array.from({ length: 7 }, next);
        assert.deepEqual([...bag].sort(), [...TYPES].sort());
    }
});

test('pieceCells：四個方向都是 4 格，轉四次回到原位', () => {
    for (const type of TYPES) {
        for (let r = 0; r < 4; r++) assert.equal(pieceCells(type, r).length, 4);
    }
    // T 朝下（rotation 2）：上排三格、下排中間一格
    assert.deepEqual(
        [...pieceCells('T', 2)].sort(),
        [
            [0, 1],
            [1, 1],
            [1, 2],
            [2, 1],
        ]
    );
});

test('出生：置中、下方有空間時先下降一格，並補滿預覽佇列', () => {
    const game = createTetris({ random: seeded(3) });
    assert.equal(game.queue.length, 5);
    assert.equal(game.active.y, 1);
    const width = game.active.type === 'O' ? 2 : game.active.type === 'I' ? 4 : 3;
    assert.equal(game.active.x, Math.floor((COLS - width) / 2));
});

test('重力：等級 1 每秒下降一格；軟降每格加 1 分', () => {
    const game = createTetris({ random: seeded(2) });
    place(game, 'T', 0, 3, 2);
    game.tick(0.99);
    assert.equal(game.active.y, 2);
    game.tick(0.02);
    assert.equal(game.active.y, 3);

    const before = game.score;
    game.tick(gravityFor(1) / 20 + 1e-9, { softDropping: true });
    assert.equal(game.active.y, 4);
    assert.equal(game.score, before + 1);
});

test('gravityFor：等級越高越快', () => {
    assert.equal(gravityFor(1), 1);
    assert.ok(gravityFor(5) < gravityFor(4));
    assert.equal(gravityFor(30), gravityFor(20));
});

test('硬降：每格 2 分並立刻鎖定', () => {
    const game = createTetris({ random: seeded(4) });
    place(game, 'O', 0, 4, 2);
    const distance = game.hardDrop();
    assert.equal(distance, ROWS - 2 - 2);
    assert.equal(game.score, distance * 2);
    assert.equal(game.board[ROWS - 1][4], 'O');
    assert.equal(game.board[ROWS - 2][5], 'O');
    assert.ok(game.takeEvents().some((e) => e.type === 'lock'));
});

test('鎖定延遲：著地 0.5 秒後鎖定，期間移動會重置計時', () => {
    const game = createTetris({ random: seeded(5) });
    place(game, 'O', 0, 4, ROWS - 2);
    game.tick(LOCK_DELAY * 0.8);
    assert.ok(game.lockProgress > 0.7);
    assert.ok(game.move(-1));
    assert.equal(game.lockProgress, 0);
    game.tick(LOCK_DELAY * 0.8);
    assert.equal(game.active.type, 'O', '重置後還沒鎖定');
    game.tick(LOCK_DELAY * 0.3);
    assert.equal(game.board[ROWS - 1][3], 'O');
});

test('旋轉：I 貼右牆旋轉時用 SRS 踢牆移回場內', () => {
    const game = createTetris({ random: seeded(6) });
    // 直立的 I 貼在最右欄
    place(game, 'I', 1, COLS - 3, 5);
    assert.ok(game.rotate(1));
    assert.equal(game.active.rotation, 2);
    for (const [cx] of pieceCells('I', 2)) {
        const x = game.active.x + cx;
        assert.ok(x >= 0 && x < COLS);
    }
});

test('Hold：交換目前方塊，同一塊只能 hold 一次', () => {
    const game = createTetris({ random: seeded(8) });
    const first = game.active.type;
    const upcoming = game.queue[0];
    assert.ok(game.hold());
    assert.equal(game.held, first);
    assert.equal(game.active.type, upcoming);
    assert.equal(game.hold(), false);

    game.hardDrop();
    const second = game.active.type;
    assert.ok(game.hold());
    assert.equal(game.active.type, first);
    assert.equal(game.held, second);
});

test('消行：先播放動畫，時間到才移除列並出下一塊', () => {
    const game = createTetris({ random: seeded(9) });
    fillRow(game.board, ROWS - 1, [0, 1]);
    game.board[ROWS - 2][9] = 'Z';
    place(game, 'O', 0, 0, 5);
    game.hardDrop();

    const clear = game.takeEvents().find((e) => e.type === 'clear');
    assert.equal(clear.lines, 1);
    assert.equal(clear.points, 100);
    assert.ok(game.clearing);
    assert.equal(game.active, null);

    game.tick(CLEAR_DURATION + 0.01);
    assert.equal(game.clearing, null);
    assert.ok(game.active);
    // 原本倒數第二列的 O 上半部與 Z 往下掉一列
    assert.deepEqual(game.board[ROWS - 1], ['O', 'O', null, null, null, null, null, null, null, 'Z']);
    assert.equal(game.lines, 1);
});

test('Tetris 與 Back-to-back：第二次 Tetris 為 1.5 倍並加上 combo', () => {
    const game = createTetris({ random: seeded(10) });
    const setup = () => {
        for (let y = ROWS - 4; y < ROWS; y++) fillRow(game.board, y, [9]);
        place(game, 'I', 1, COLS - 3, 2);
    };

    setup();
    game.hardDrop();
    let clear = game.takeEvents().find((e) => e.type === 'clear');
    assert.equal(clear.lines, 4);
    assert.equal(clear.points, 800);
    assert.equal(clear.backToBack, false);
    game.tick(CLEAR_DURATION + 0.01);

    setup();
    game.hardDrop();
    clear = game.takeEvents().find((e) => e.type === 'clear');
    assert.equal(clear.backToBack, true);
    assert.equal(clear.combo, 1);
    assert.equal(clear.points, 1200 + 50);
});

test('T-spin double：旋轉進洞後鎖定，1200 分', () => {
    const game = createTetris({ random: seeded(11) });
    game.board = emptyBoard();
    const bottom = ROWS - 1;
    fillRow(game.board, bottom, [4]);
    fillRow(game.board, bottom - 1, [3, 4, 5]);
    game.board[bottom - 2][3] = 'J'; // 蓋在洞口上方的突出
    place(game, 'T', 1, 3, bottom - 2);

    assert.ok(game.rotate(1));
    game.hardDrop();
    const clear = game.takeEvents().find((e) => e.type === 'clear');
    assert.equal(clear.tspin, 'full');
    assert.equal(clear.lines, 2);
    assert.equal(clear.points, 1200);
});

test('升級：每 10 行升一級', () => {
    const game = createTetris({ random: seeded(12) });
    game.lines = 9;
    fillRow(game.board, ROWS - 1, [0, 1]);
    game.board[ROWS - 2] = new Array(COLS).fill(null);
    place(game, 'O', 0, 0, 5);
    game.hardDrop();
    assert.equal(game.level, 2);
    assert.ok(game.takeEvents().some((e) => e.type === 'levelUp' && e.level === 2));
});

test('Game over：新方塊出生位置被擋住', () => {
    const game = createTetris({ random: seeded(13) });
    for (let y = 0; y < ROWS; y++) fillRow(game.board, y, [0]);
    place(game, 'O', 0, 4, 0);
    game.board[0][4] = null;
    game.board[0][5] = null;
    game.board[1][4] = null;
    game.board[1][5] = null;
    game.hardDrop();
    assert.ok(game.over);
    assert.ok(game.takeEvents().some((e) => e.type === 'gameOver'));
});

test('scoreFor：各種消行分數乘上等級', () => {
    assert.equal(scoreFor({ lines: 1, level: 3 }), 300);
    assert.equal(scoreFor({ lines: 4, level: 2 }), 1600);
    assert.equal(scoreFor({ lines: 0, tspin: 'full', level: 1 }), 400);
    assert.equal(scoreFor({ lines: 1, tspin: 'mini', level: 1 }), 200);
    assert.equal(scoreFor({ lines: 2, combo: 3, level: 1 }), 300 + 150);
    assert.equal(scoreFor({ lines: 0, combo: 3, level: 1 }), 0);
});
