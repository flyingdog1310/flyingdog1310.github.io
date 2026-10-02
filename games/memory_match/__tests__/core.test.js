import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, SYMBOL_COUNT, createMemoryMatch } from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// 2 × 2：圖案 0 在左上、右下，圖案 1 在右上、左下
const small = () => createMemoryMatch({ rows: 2, cols: 2, deck: [0, 1, 1, 0] });

test('三種難度的大小，最難的盤面圖案也夠用', () => {
    assert.deepEqual(LEVELS.easy, { rows: 3, cols: 4 });
    assert.deepEqual(LEVELS.normal, { rows: 4, cols: 5 });
    assert.deepEqual(LEVELS.hard, { rows: 6, cols: 6 });
    for (const { rows, cols } of Object.values(LEVELS)) assert.ok((rows * cols) / 2 <= SYMBOL_COUNT);
    assert.throws(() => createMemoryMatch({ rows: 3, cols: 3 }));
    assert.throws(() => createMemoryMatch({ rows: 8, cols: 8 }));
    assert.throws(() => createMemoryMatch({ rows: 2, cols: 2, deck: [0, 0] }));
});

test('每種圖案剛好兩張、圖案不重複，洗牌由亂數決定', () => {
    for (let seed = 1; seed <= 20; seed++) {
        for (const level of Object.values(LEVELS)) {
            const game = createMemoryMatch({ ...level, random: seeded(seed) });
            const counts = new Map();
            for (const card of game.cards) counts.set(card.symbol, (counts.get(card.symbol) ?? 0) + 1);
            assert.equal(counts.size, game.pairs);
            assert.ok([...counts.values()].every((n) => n === 2));
            assert.ok([...counts.keys()].every((s) => s >= 0 && s < SYMBOL_COUNT));
            assert.ok(game.cards.every((c) => c.state === 'down'));
        }
    }
    const a = createMemoryMatch({ ...LEVELS.hard, random: seeded(1) }).cards.map((c) => c.symbol);
    const b = createMemoryMatch({ ...LEVELS.hard, random: seeded(1) }).cards.map((c) => c.symbol);
    const c = createMemoryMatch({ ...LEVELS.hard, random: seeded(2) }).cards.map((c) => c.symbol);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
});

test('翻第一張開始遊戲，翻兩張算一步', () => {
    const game = small();
    assert.equal(game.status, 'ready');
    assert.deepEqual(game.flip(0), { flipped: 0 });
    assert.equal(game.status, 'playing');
    assert.equal(game.moves, 0);
    assert.deepEqual(game.openCards(), [0]);
    game.flip(1);
    assert.equal(game.moves, 1);
});

test('配對成功：兩張保持翻開並標記為 matched', () => {
    const game = small();
    game.flip(0);
    const result = game.flip(3);
    assert.deepEqual(result.match, [0, 3]);
    assert.equal(game.cards[0].state, 'matched');
    assert.equal(game.cards[3].state, 'matched');
    assert.equal(game.matches, 1);
    assert.deepEqual(game.openCards(), []);
});

test('配錯：兩張保持翻開直到 settle 或翻下一張', () => {
    const game = small();
    game.flip(0);
    const result = game.flip(1);
    assert.deepEqual(result.mismatch, [0, 1]);
    assert.equal(game.cards[0].state, 'up');
    assert.equal(game.cards[1].state, 'up');
    assert.deepEqual(game.settle(), [0, 1]);
    assert.ok(game.cards.every((c) => c.state === 'down'));
    assert.equal(game.settle(), null);

    // 不等蓋回直接翻第三張：先蓋回那兩張
    game.flip(0);
    game.flip(1);
    const next = game.flip(2);
    assert.deepEqual(next, { flipped: 2, hidden: [0, 1] });
    assert.equal(game.cards[0].state, 'down');
    assert.deepEqual(game.openCards(), [2]);
});

test('已翻開或已配對的牌不能再翻', () => {
    const game = small();
    game.flip(0);
    assert.equal(game.flip(0), null);
    game.settle();
    game.flip(0);
    game.flip(3);
    assert.equal(game.flip(3), null);
    assert.equal(game.flip(99), null);
});

test('配錯等待蓋回時點其中一張：另一張蓋回，這張當作下一步的第一張', () => {
    const game = small();
    game.flip(0);
    game.flip(1);
    const result = game.flip(1);
    assert.deepEqual(result, { flipped: 1, hidden: [0] });
    assert.equal(game.cards[0].state, 'down');
    assert.equal(game.cards[1].state, 'up');
    assert.deepEqual(game.openCards(), [1]);
    assert.equal(game.moves, 1);
    assert.deepEqual(game.flip(2).match, [1, 2]);
    assert.equal(game.moves, 2);
});

test('全部配對完成就贏，之後不能再翻', () => {
    const game = small();
    game.flip(0);
    game.flip(3);
    game.flip(1);
    const result = game.flip(2);
    assert.deepEqual(result.match, [1, 2]);
    assert.equal(result.won, true);
    assert.equal(game.status, 'won');
    assert.equal(game.moves, 2);
    assert.equal(game.flip(0), null);
});

test('連續配對：配錯就歸零，記錄最長', () => {
    const game = createMemoryMatch({ rows: 2, cols: 3, deck: [0, 0, 1, 2, 1, 2] });
    game.flip(0);
    game.flip(1);
    assert.equal(game.streak, 1);
    game.flip(2);
    game.flip(3);
    assert.equal(game.streak, 0);
    assert.equal(game.bestStreak, 1);
    game.settle();
    game.flip(2);
    game.flip(4);
    game.flip(3);
    game.flip(5);
    assert.equal(game.streak, 2);
    assert.equal(game.bestStreak, 2);
    assert.equal(game.moves, 4);
    assert.equal(game.status, 'won');
});
