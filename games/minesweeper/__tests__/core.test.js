import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, createMinesweeper } from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// 指定地雷位置：直接設定盤面並計算數字（不經過第一下），狀態設為 playing
function rigged({ rows, cols, mines }) {
    const game = createMinesweeper({ rows, cols, mines: mines.length, random: seeded(1) });
    game.cells.forEach((cell, i) => {
        cell.mine = mines.includes(i);
    });
    game.cells.forEach((cell, i) => {
        cell.adjacent = game.neighbors(i).filter((n) => game.cells[n].mine).length;
    });
    game.status = 'playing';
    return game;
}

test('三種難度的大小與地雷數', () => {
    assert.deepEqual(LEVELS.beginner, { rows: 9, cols: 9, mines: 10 });
    assert.deepEqual(LEVELS.intermediate, { rows: 16, cols: 16, mines: 40 });
    assert.deepEqual(LEVELS.expert, { rows: 16, cols: 30, mines: 99 });
    assert.throws(() => createMinesweeper({ rows: 2, cols: 2, mines: 4 }));
});

test('第一下一定安全且周圍沒有地雷，地雷數正確', () => {
    for (let seed = 1; seed <= 30; seed++) {
        for (const level of Object.values(LEVELS)) {
            const game = createMinesweeper({ ...level, random: seeded(seed) });
            const first = Math.floor(seed * 7.3) % (level.rows * level.cols);
            const result = game.reveal(first);
            assert.equal(game.cells.filter((c) => c.mine).length, level.mines);
            assert.equal(game.cells[first].mine, false);
            assert.ok(game.neighbors(first).every((n) => !game.cells[n].mine));
            assert.equal(game.cells[first].adjacent, 0);
            assert.ok(!result.lost);
            assert.ok(result.opened.length > 1);
        }
    }
});

test('地雷太多時第一下只保證那一格安全', () => {
    const game = createMinesweeper({ rows: 3, cols: 3, mines: 8, random: seeded(2) });
    const result = game.reveal(4);
    assert.ok(!game.cells[4].mine);
    assert.equal(game.cells[4].adjacent, 8);
    assert.ok(result.won);
});

test('數字是周圍地雷數', () => {
    // 3 × 3，地雷在左上與右下
    const game = rigged({ rows: 3, cols: 3, mines: [0, 8] });
    assert.deepEqual(
        game.cells.map((c) => (c.mine ? '*' : c.adjacent)).join(''),
        ['*', 1, 0, 1, 2, 1, 0, 1, '*'].join('')
    );
});

test('點到 0 會一路展開到數字邊界，depth 由近到遠', () => {
    // 4 × 4，只有右下角一顆雷
    const game = rigged({ rows: 4, cols: 4, mines: [15] });
    const result = game.reveal(0);
    assert.equal(result.opened.length, 15);
    assert.ok(result.won);
    assert.equal(result.opened[0].index, 0);
    assert.equal(result.opened[0].depth, 0);
    const depths = result.opened.map((o) => o.depth);
    assert.deepEqual(depths, [...depths].sort((a, b) => a - b));
    // 地雷自動插旗
    assert.equal(game.cells[15].state, 'flagged');
    assert.equal(game.minesLeft(), 0);
});

test('插旗的格子不會被翻開，也會擋住展開', () => {
    const game = rigged({ rows: 1, cols: 5, mines: [4] });
    assert.ok(game.toggleFlag(2));
    assert.equal(game.reveal(2), null);
    const result = game.reveal(0);
    assert.deepEqual(
        result.opened.map((o) => o.index),
        [0, 1]
    );
    assert.equal(game.cells[2].state, 'flagged');
    assert.equal(game.status, 'playing');
});

test('插旗與拔旗更新剩餘地雷數；翻開的格子不能插旗', () => {
    const game = rigged({ rows: 3, cols: 3, mines: [0] });
    game.toggleFlag(0);
    assert.equal(game.minesLeft(), 0);
    game.toggleFlag(0);
    assert.equal(game.minesLeft(), 1);
    game.reveal(8);
    assert.equal(game.toggleFlag(8), false);
});

test('踩到地雷就輸，回傳所有地雷與插錯的旗', () => {
    const game = rigged({ rows: 3, cols: 3, mines: [0, 8] });
    game.toggleFlag(4);
    const result = game.reveal(0);
    assert.equal(game.status, 'lost');
    assert.equal(result.lost.exploded, 0);
    assert.deepEqual(result.lost.mines, [8]);
    assert.deepEqual(result.lost.wrongFlags, [4]);
    // 結束後不能再操作
    assert.equal(game.reveal(2), null);
    assert.equal(game.toggleFlag(2), false);
});

test('連鎖翻開（chord）：旗子數對了才翻開周圍', () => {
    // 3 × 3，地雷在左上；中央是 1
    const game = rigged({ rows: 3, cols: 3, mines: [0] });
    game.reveal(4);
    assert.equal(game.cells[4].adjacent, 1);
    // 沒有插旗：不動作
    assert.equal(game.reveal(4), null);
    game.toggleFlag(0);
    const result = game.reveal(4);
    assert.ok(result);
    assert.equal(result.opened.length, 7);
    assert.ok(result.won);
});

test('連鎖翻開時旗子插錯就會踩到地雷', () => {
    const game = rigged({ rows: 3, cols: 3, mines: [0] });
    game.reveal(4);
    game.toggleFlag(1);
    const result = game.reveal(4);
    assert.equal(result.lost.exploded, 0);
    assert.deepEqual(result.lost.wrongFlags, [1]);
    assert.equal(game.status, 'lost');
});

test('翻開所有安全格就贏', () => {
    const game = rigged({ rows: 2, cols: 2, mines: [0] });
    game.reveal(1);
    game.reveal(2);
    assert.equal(game.status, 'playing');
    const result = game.reveal(3);
    assert.ok(result.won);
    assert.deepEqual(result.won.flagged, [0]);
    assert.equal(game.status, 'won');
});
