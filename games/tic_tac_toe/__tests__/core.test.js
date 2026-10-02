import test from 'node:test';
import assert from 'node:assert/strict';
import { LINES, chooseMove, createTicTacToe, emptyCells, rateMoves, winnerOf, winningMoves } from '../core.js';

// mulberry32：小的種子第一個值也分布均勻
function seeded(seed = 1) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// '.XO' 字串 → 盤面
const parse = (text) => [...text.replace(/\s/g, '')].map((c) => (c === '.' ? null : c));

test('八條線都能判定勝負，沒連線時回傳 null', () => {
    assert.equal(LINES.length, 8);
    for (const line of LINES) {
        const board = Array(9).fill(null);
        for (const i of line) board[i] = 'O';
        assert.deepEqual(winnerOf(board), { mark: 'O', line });
    }
    assert.equal(winnerOf(parse('XOX XOO OXX')), null);
    assert.equal(winnerOf(Array(9).fill(null)), null);
});

test('輪流下棋，先手由參數決定', () => {
    const game = createTicTacToe();
    assert.equal(game.turn, 'X');
    assert.deepEqual(game.play(4), { index: 4, mark: 'X' });
    assert.equal(game.turn, 'O');
    assert.deepEqual(game.play(0), { index: 0, mark: 'O' });
    assert.equal(game.turn, 'X');
    assert.deepEqual(game.moves, [4, 0]);

    const second = createTicTacToe({ first: 'O' });
    assert.equal(second.turn, 'O');
    assert.equal(second.play(8).mark, 'O');
    assert.equal(second.turn, 'X');
    assert.throws(() => createTicTacToe({ first: 'Z' }));
});

test('已有棋子、超出範圍、結束後都不能下', () => {
    const game = createTicTacToe();
    game.play(0);
    assert.equal(game.play(0), null);
    assert.equal(game.play(9), null);
    assert.equal(game.play(-1), null);
    assert.equal(game.play(1.5), null);
    assert.equal(game.turn, 'O');
    for (const i of [3, 1, 4]) game.play(i);
    const result = game.play(2);
    assert.deepEqual(result, { index: 2, mark: 'X', won: { mark: 'X', line: [0, 1, 2] } });
    assert.equal(game.status, 'won');
    assert.equal(game.play(8), null);
    assert.deepEqual(game.legalMoves(), []);
});

test('九格下滿沒有連線是和局；最後一步連成一線算贏', () => {
    const draw = createTicTacToe();
    // X O X / X O O / O X X
    const moves = [0, 1, 2, 4, 3, 5, 7, 6, 8];
    let last;
    for (const i of moves) last = draw.play(i);
    assert.deepEqual(last, { index: 8, mark: 'X', draw: true });
    assert.equal(draw.status, 'draw');
    assert.equal(draw.winner, null);

    // 第 9 步同時填滿盤面並連線：算贏不算和（X O O / O X X / X O X）
    const full = createTicTacToe();
    for (const i of [0, 1, 5, 2, 6, 3, 4, 7]) full.play(i);
    assert.equal(full.status, 'playing');
    const final = full.play(8);
    assert.equal(final.won.mark, 'X');
    assert.equal(full.status, 'won');
});

test('收回一步會還原輪到誰與結束狀態', () => {
    const game = createTicTacToe();
    assert.equal(game.undo(), null);
    for (const i of [0, 3, 1, 4, 2]) game.play(i);
    assert.equal(game.status, 'won');
    assert.deepEqual(game.undo(), { index: 2, mark: 'X' });
    assert.equal(game.status, 'playing');
    assert.equal(game.winner, null);
    assert.equal(game.turn, 'X');
    assert.equal(game.board[2], null);
    assert.deepEqual(game.legalMoves(), [2, 5, 6, 7, 8]);
});

test('存檔可以接著玩，不合法的存檔會丟錯', () => {
    const game = createTicTacToe({ first: 'O' });
    for (const i of [4, 0, 8]) game.play(i);
    const saved = JSON.parse(JSON.stringify(game.toJSON()));
    assert.deepEqual(saved, { first: 'O', moves: [4, 0, 8] });

    const restored = createTicTacToe({ state: saved });
    assert.deepEqual(restored.board, game.board);
    assert.equal(restored.turn, 'X');
    assert.equal(restored.first, 'O');
    assert.throws(() => createTicTacToe({ state: { first: 'X', moves: [0, 0] } }));
    assert.throws(() => createTicTacToe({ state: { first: 'X', moves: [0, 3, 1, 4, 2, 5] } }));
    assert.throws(() => createTicTacToe({ state: { first: 'X' } }));
});

test('找出能立刻連線的格子', () => {
    const board = parse('XX. OO. ...');
    assert.deepEqual(winningMoves(board, 'X'), [2]);
    assert.deepEqual(winningMoves(board, 'O'), [5]);
    assert.deepEqual(emptyCells(board), [2, 5, 6, 7, 8]);
});

test('hard：能贏就贏、該擋就擋、空盤每一步都是和局', () => {
    for (let seed = 1; seed <= 10; seed++) {
        assert.equal(chooseMove(parse('XX. OO. ...'), 'O', 'hard', seeded(seed)), 5);
        assert.equal(chooseMove(parse('XX. O.. ...'), 'O', 'hard', seeded(seed)), 2);
    }
    assert.ok(rateMoves(Array(9).fill(null), 'X').every((m) => m.score === 0));
    // 角落開局時只有中央不會輸
    assert.equal(chooseMove(parse('X.. ... ...'), 'O', 'hard'), 4);
    assert.equal(chooseMove(parse('XOX OXO XOX'), 'O', 'hard'), null);
});

// 玩家每一種下法都試一遍，電腦用 hard 回應
function exhaust(game, cpu, random, outcomes) {
    if (game.status !== 'playing') {
        outcomes[game.status === 'draw' ? 'draw' : game.winner.mark === cpu ? 'cpu' : 'human'] += 1;
        return;
    }
    if (game.turn === cpu) {
        game.play(chooseMove(game.board, cpu, 'hard', random));
        exhaust(game, cpu, random, outcomes);
        game.undo();
        return;
    }
    for (const i of game.legalMoves()) {
        game.play(i);
        exhaust(game, cpu, random, outcomes);
        game.undo();
    }
}

test('hard 永遠不會輸（不論誰先下）', () => {
    for (const first of ['X', 'O']) {
        const outcomes = { human: 0, cpu: 0, draw: 0 };
        exhaust(createTicTacToe({ first }), 'O', seeded(3), outcomes);
        assert.equal(outcomes.human, 0, `先手 ${first}`);
        assert.ok(outcomes.cpu > 0 && outcomes.draw > 0);
    }
});

test('normal：一定會贏與擋，但會被雙殺', () => {
    for (let seed = 1; seed <= 30; seed++) {
        const random = seeded(seed);
        assert.equal(chooseMove(parse('OO. XX. X..'), 'O', 'normal', random), 2);
        assert.equal(chooseMove(parse('XX. O.. ...'), 'O', 'normal', random), 2);
    }
    // X 在兩個對角，O 在中央：X 下 8 形成雙殺之後，normal 只能擋一邊
    const fork = parse('X.. .O. ..X');
    fork[6] = 'X';
    assert.equal(winningMoves(fork, 'X').length, 2);
    const reply = chooseMove(fork, 'O', 'normal', seeded(1));
    fork[reply] = 'O';
    assert.equal(winningMoves(fork, 'X').length, 1);
});

test('easy：只下合法的格子，而且會漏看', () => {
    let missedWin = 0;
    let missedBlock = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const board = parse('XX. OO. ...');
        const move = chooseMove(board, 'O', 'easy', seeded(seed));
        assert.ok(emptyCells(board).includes(move));
        if (move !== 5) missedWin += 1;
        const block = chooseMove(parse('XX. O.. ...'), 'O', 'easy', seeded(seed));
        if (block !== 2) missedBlock += 1;
    }
    assert.ok(missedWin > 20 && missedWin < 180);
    assert.ok(missedBlock > 50);
});

test('同樣好的步由亂數挑選，同一個種子結果相同', () => {
    const empty = Array(9).fill(null);
    const picks = new Set();
    for (let seed = 1; seed <= 40; seed++) picks.add(chooseMove(empty, 'X', 'hard', seeded(seed)));
    assert.ok(picks.size > 3);
    assert.equal(chooseMove(empty, 'X', 'hard', seeded(5)), chooseMove(empty, 'X', 'hard', seeded(5)));
});
