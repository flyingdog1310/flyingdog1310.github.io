import test from 'node:test';
import assert from 'node:assert/strict';
import { GOAL, createGame } from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// 由數值陣列建立盤面（4 × 4，列優先）；random 固定回傳 0.99：新方塊放在最後一個空格、值為 2
function board(values, options = {}) {
    return createGame({ random: () => 0.99, state: { size: 4, cells: values.flat(), score: 0 }, ...options });
}

const values = (game) => {
    const v = game.cells.map((tile) => tile?.value ?? 0);
    return [0, 1, 2, 3].map((r) => v.slice(r * 4, r * 4 + 4));
};

test('開局有兩個方塊，都是 2 或 4', () => {
    for (let seed = 1; seed < 20; seed++) {
        const game = createGame({ random: seeded(seed) });
        const tiles = game.cells.filter(Boolean);
        assert.equal(tiles.length, 2);
        assert.ok(tiles.every((t) => t.value === 2 || t.value === 4));
    }
});

test('往左滑：靠攏並合併相同數字', () => {
    const game = board([
        [2, 2, 0, 0],
        [0, 4, 0, 4],
        [8, 0, 0, 0],
        [2, 4, 8, 16],
    ]);
    const result = game.move('left');
    assert.ok(result);
    assert.deepEqual(values(game).slice(0, 3), [
        [4, 0, 0, 0],
        [8, 0, 0, 0],
        // 新方塊出現在最後一個空格
        [8, 0, 0, 2],
    ]);
    assert.deepEqual(values(game)[3], [2, 4, 8, 16]);
    assert.equal(game.score, 12);
    assert.equal(result.gained, 12);
});

test('每個方塊一步只合併一次', () => {
    const game = board([
        [4, 4, 8, 0],
        [2, 2, 2, 2],
        [2, 2, 2, 0],
        [0, 0, 0, 0],
    ]);
    game.move('left');
    assert.deepEqual(values(game).slice(0, 3), [
        [8, 8, 0, 0],
        [4, 4, 0, 0],
        [4, 2, 0, 0],
    ]);
});

test('合併從移動方向那一側開始', () => {
    const game = board([
        [2, 2, 2, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ]);
    game.move('right');
    assert.deepEqual(values(game)[0], [0, 0, 2, 4]);
});

test('上下方向也正確', () => {
    const up = board([
        [2, 0, 0, 0],
        [2, 0, 0, 0],
        [4, 0, 0, 0],
        [4, 0, 0, 0],
    ]);
    up.move('up');
    assert.deepEqual(values(up).map((r) => r[0]), [4, 8, 0, 0]);

    const down = board([
        [2, 0, 0, 0],
        [0, 0, 0, 0],
        [2, 0, 0, 0],
        [2, 0, 0, 0],
    ]);
    down.move('down');
    assert.deepEqual(values(down).map((r) => r[0]), [0, 0, 2, 4]);
});

test('沒有任何方塊能動時不算一步，也不會出現新方塊', () => {
    const game = board([
        [2, 4, 0, 0],
        [4, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ]);
    assert.equal(game.move('left'), null);
    assert.equal(game.move('up'), null);
    assert.equal(game.cells.filter(Boolean).length, 4);
    assert.equal(game.canUndo, false);
});

test('移動後在空格出現一個新方塊', () => {
    const game = board([
        [2, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ]);
    const result = game.move('right');
    assert.equal(game.cells.filter(Boolean).length, 2);
    assert.equal(result.spawned.value, 2);
    assert.equal(game.cells[result.spawned.index].id, result.spawned.id);
});

test('動畫資料：滑動來源與合併結果', () => {
    const game = board([
        [2, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ]);
    const [a, b] = [game.cells[0].id, game.cells[1].id];
    const result = game.move('right');
    assert.deepEqual(
        result.slides.map(({ id, from, to }) => [id, from, to]),
        [
            [b, 1, 3],
            [a, 0, 3],
        ]
    );
    assert.equal(result.merges.length, 1);
    assert.deepEqual(result.merges[0].from, [b, a]);
    assert.equal(result.merges[0].value, 4);
    assert.equal(game.cells[3].id, result.merges[0].id);
});

test('做出 2048 會勝利一次，選擇繼續之後可以照常玩', () => {
    const game = board([
        [1024, 1024, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ]);
    const result = game.move('left');
    assert.ok(result.reachedGoal);
    assert.ok(game.won);
    assert.equal(values(game)[0][0], GOAL);
    game.continueAfterWin();
    assert.ok(game.keepPlaying);
    const again = game.move('right');
    assert.equal(again.reachedGoal, false);
});

test('盤面滿了且沒有相鄰相同數字就結束', () => {
    const game = board([
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 0, 4],
    ]);
    // 往左滑：最後一列變成 4 2 4 _，新方塊 2 補進唯一空格，盤面成為棋盤格
    const result = game.move('left');
    assert.ok(result.over);
    assert.ok(game.over);
    assert.equal(game.move('left'), null);
});

test('滿了但還能合併就不算結束', () => {
    const game = board([
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 4],
    ]);
    assert.equal(game.over, false);
    assert.ok(game.hasMoves());
});

test('復原上一步：盤面與分數都回去，只能復原一步', () => {
    const game = board([
        [2, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ]);
    const before = values(game);
    game.move('left');
    assert.equal(game.score, 4);
    assert.ok(game.undo());
    assert.deepEqual(values(game), before);
    assert.equal(game.score, 0);
    assert.equal(game.canUndo, false);
    assert.equal(game.undo(), false);
});

test('結束後可以復原回到還能動的盤面', () => {
    const game = board([
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 0, 4],
    ]);
    game.move('left');
    assert.ok(game.over);
    game.undo();
    assert.equal(game.over, false);
});

test('存檔與讀檔；壞掉的存檔改為開新局', () => {
    const game = board([
        [2, 2, 0, 0],
        [0, 64, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 8],
    ]);
    game.move('left');
    const saved = JSON.parse(JSON.stringify(game.toJSON()));
    const loaded = createGame({ state: saved });
    assert.deepEqual(values(loaded), values(game));
    assert.equal(loaded.score, game.score);
    assert.equal(loaded.maxTile(), 64);

    for (const bad of [{ size: 4, cells: [3], score: 0 }, { size: 4, cells: Array(16).fill(0), score: 0 }, null, 'x']) {
        const fresh = createGame({ random: seeded(2), state: bad });
        assert.equal(fresh.cells.filter(Boolean).length, 2);
        assert.equal(fresh.score, 0);
    }
});
