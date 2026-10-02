import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COLS,
    ROWS,
    WINDOWS,
    chooseMove,
    createConnectFour,
    evaluate,
    landingRow,
    openColumns,
    rateColumns,
    winnerOf,
    winningColumns,
} from '../core.js';

// mulberry32：小的種子第一個值也分布均勻
function seeded(seed = 1) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 由上到下 6 列、每列 7 個字元（'.RY'）→ 盤面
const parse = (rows) => {
    const text = rows.join('');
    assert.equal(text.length, ROWS * COLS);
    return [...text].map((c) => (c === '.' ? null : c));
};

// '3324…' 這種一行一個數字的下法
const replay = (moves, options) => {
    const game = createConnectFour(options);
    for (const col of moves) assert.ok(game.play(Number(col)), `第 ${col} 行應該能下`);
    return game;
};

test('69 個四格窗；四個方向都能判定勝負，連成五子時回傳全部的格子', () => {
    assert.equal(WINDOWS.length, 69);
    const cases = [
        ['.......', '.......', '.......', '.......', '.......', 'YRRRR..'],
        ['.......', '.......', '...R...', '...R...', '...R...', '...R...'],
        ['.......', '.......', '...R...', '..RY...', '.RYY...', 'RYYR...'],
        ['.......', '.......', 'Y......', 'RY.....', 'RRY....', 'RRRY...'],
    ];
    for (const rows of cases) {
        const win = winnerOf(parse(rows));
        assert.ok(win);
        assert.equal(win.cells.length, 4);
    }
    assert.equal(winnerOf(parse(cases[3])).mark, 'Y');
    assert.deepEqual(winnerOf(parse(['.......', '.......', '.......', '.......', '.......', 'RRRRR..'])).cells, [
        35, 36, 37, 38, 39,
    ]);
    assert.equal(winnerOf(parse(['.......', '.......', '.......', '.......', '.......', 'RRR.RRR'])), null);
    assert.equal(winnerOf(Array(42).fill(null)), null);
});

test('棋子落在最下面的空格，輪流下，先手由參數決定', () => {
    const game = createConnectFour();
    assert.equal(game.turn, 'R');
    assert.deepEqual(game.play(3), { col: 3, row: 5, index: 38, mark: 'R' });
    assert.equal(game.turn, 'Y');
    assert.deepEqual(game.play(3), { col: 3, row: 4, index: 31, mark: 'Y' });
    assert.equal(game.turn, 'R');
    assert.deepEqual(game.moves, [3, 3]);
    assert.equal(game.lastIndex(), 31);
    assert.equal(landingRow(game.board, 3), 3);

    const second = createConnectFour({ first: 'Y' });
    assert.equal(second.turn, 'Y');
    assert.equal(second.lastIndex(), -1);
    assert.equal(second.play(0).mark, 'Y');
    assert.throws(() => createConnectFour({ first: 'X' }));
});

test('滿的行、超出範圍、結束後都不能下', () => {
    const game = replay('000000');
    assert.equal(landingRow(game.board, 0), -1);
    assert.equal(game.play(0), null);
    assert.equal(game.play(7), null);
    assert.equal(game.play(-1), null);
    assert.equal(game.play(2.5), null);
    assert.deepEqual(game.legalMoves(), [1, 2, 3, 4, 5, 6]);
    assert.equal(game.turn, 'R');

    // 紅在第 0 列連成四子
    const won = replay('1213141');
    assert.equal(won.status, 'won');
    assert.deepEqual(won.winner, { mark: 'R', cells: [1, 8, 15, 22].map((i) => i + 14) });
    assert.equal(won.play(5), null);
    assert.deepEqual(won.legalMoves(), []);
});

test('下滿 42 格沒有連線是和局；最後一步連成四子算贏', () => {
    const draw = replay('22102263464431133601046324352656105145550');
    assert.equal(draw.status, 'playing');
    assert.deepEqual(draw.play(0), { col: 0, row: 0, index: 0, mark: 'Y', draw: true });
    assert.equal(draw.status, 'draw');
    assert.equal(draw.winner, null);

    const full = replay('36422343334104236145450020150211552065661');
    assert.equal(full.status, 'playing');
    const last = full.play(6);
    assert.equal(last.won.mark, 'Y');
    assert.equal(last.draw, undefined);
    assert.equal(full.status, 'won');
});

test('收回一步會還原輪到誰與結束狀態', () => {
    const game = createConnectFour();
    assert.equal(game.undo(), null);
    for (const col of [1, 2, 1, 3, 1, 4, 1]) game.play(col);
    assert.equal(game.status, 'won');
    assert.deepEqual(game.undo(), { col: 1, row: 2, index: 15, mark: 'R' });
    assert.equal(game.status, 'playing');
    assert.equal(game.winner, null);
    assert.equal(game.turn, 'R');
    assert.equal(game.board[15], null);
    assert.equal(game.lastIndex(), 39);
    assert.deepEqual(game.undo(), { col: 4, row: 5, index: 39, mark: 'Y' });
    assert.equal(game.turn, 'Y');
});

test('存檔可以接著玩，不合法的存檔會丟錯', () => {
    const game = replay('334', { first: 'Y' });
    const saved = JSON.parse(JSON.stringify(game.toJSON()));
    assert.deepEqual(saved, { first: 'Y', moves: [3, 3, 4] });

    const restored = createConnectFour({ state: saved });
    assert.deepEqual(restored.board, game.board);
    assert.equal(restored.turn, 'R');
    assert.equal(restored.first, 'Y');
    assert.throws(() => createConnectFour({ state: { first: 'R', moves: [0, 0, 0, 0, 0, 0, 0] } }));
    assert.throws(() => createConnectFour({ state: { first: 'R', moves: [1, 2, 1, 2, 1, 2, 1, 2] } }));
    assert.throws(() => createConnectFour({ state: { first: 'R', moves: [9] } }));
    assert.throws(() => createConnectFour({ state: { first: 'R' } }));
});

test('找出能立刻連成四子的行', () => {
    const board = parse(['.......', '.......', '.......', 'Y......', 'Y......', 'YRRR...']);
    assert.deepEqual(winningColumns(board, 'R'), [4]);
    assert.deepEqual(winningColumns(board, 'Y'), [0]);
    assert.deepEqual(openColumns(board), [0, 1, 2, 3, 4, 5, 6]);
});

test('評分：自己的三子比對方的好；搜尋時的增量評分與完整評分一致', () => {
    const board = parse(['.......', '.......', '.......', '.......', '.......', '.RRR.YY']);
    assert.ok(evaluate(board, 'R') > 0);
    assert.equal(evaluate(board, 'Y'), -evaluate(board, 'R'));

    const random = seeded(7);
    for (let n = 0; n < 30; n++) {
        const game = createConnectFour();
        for (let k = 0; k < 14 && game.status === 'playing'; k++) {
            const open = game.legalMoves();
            game.play(open[Math.floor(random() * open.length)]);
        }
        if (game.status !== 'playing') continue;
        for (const { col, score } of rateColumns(game.board, game.turn, 1)) {
            const next = [...game.board];
            next[landingRow(next, col) * COLS + col] = game.turn;
            if (!winnerOf(next)) assert.equal(score, evaluate(next, game.turn));
        }
    }
});

test('hard：能贏就贏、該擋就擋、不會墊高讓對方贏', () => {
    // 紅能在第 4 行贏，黃也能在第 0 行贏：先贏
    const both = parse(['.......', '.......', '.......', 'Y......', 'Y......', 'YRRR...']);
    // 黃威脅第 0 行：紅要擋（紅自己下第 4 行會有雙重威脅，但黃會先贏）
    const block = parse(['.......', '.......', '.......', 'Y......', 'Y......', 'YR.R.R.']);
    // 黃在由下數第 2 層有三子，等著第 3 行；紅下第 3 行會把那一格墊高讓黃贏
    const trap = parse(['.......', '.......', '.......', '.......', 'YYY....', 'RYR..RR']);
    assert.deepEqual(winningColumns(trap, 'Y'), []);
    for (let seed = 1; seed <= 6; seed++) {
        assert.equal(chooseMove(both, 'R', 'hard', seeded(seed)), 4);
        assert.equal(chooseMove(both, 'Y', 'hard', seeded(seed)), 0);
        assert.equal(chooseMove(block, 'R', 'hard', seeded(seed)), 0);
        assert.notEqual(chooseMove(trap, 'R', 'hard', seeded(seed)), 3);
    }
    const full = replay('22102263464431133601046324352656105145550').board;
    full[0] = 'Y';
    assert.equal(chooseMove(full, 'R', 'hard'), null);
});

test('hard 看得出雙重威脅：底線兩子時做出兩頭空的三子', () => {
    const board = parse(['.......', '.......', '.......', '.......', '..YY...', '..RR...']);
    const rated = rateColumns(board, 'R');
    const wins = rated.filter((m) => m.score > 900_000).map((m) => m.col);
    assert.deepEqual(wins, [1, 4]);
    assert.ok([1, 4].includes(chooseMove(board, 'R', 'hard', seeded(2))));
});

// 兩個難度對下一局，回傳贏家（'draw' 為和局）
function duel(red, yellow, seed) {
    const random = seeded(seed);
    const game = createConnectFour({ first: seed % 2 ? 'R' : 'Y' });
    while (game.status === 'playing') {
        const level = game.turn === 'R' ? red : yellow;
        assert.ok(game.play(chooseMove(game.board, game.turn, level, random)));
    }
    return game.winner?.mark ?? 'draw';
}

test('難度有差：hard 贏 easy、normal 大多贏 easy', () => {
    for (let seed = 1; seed <= 6; seed++) assert.equal(duel('hard', 'easy', seed), 'R');
    let normalWins = 0;
    for (let seed = 1; seed <= 20; seed++) if (duel('normal', 'easy', seed) === 'R') normalWins += 1;
    assert.ok(normalWins >= 15, `normal 贏 ${normalWins} 局`);
});

test('normal：一定會贏與擋', () => {
    const both = parse(['.......', '.......', '.......', 'Y......', 'Y......', 'YRRR...']);
    const block = parse(['.......', '.......', '.......', 'Y......', 'Y......', 'YR.R.R.']);
    for (let seed = 1; seed <= 30; seed++) {
        assert.equal(chooseMove(both, 'R', 'normal', seeded(seed)), 4);
        assert.equal(chooseMove(block, 'R', 'normal', seeded(seed)), 0);
    }
});

test('easy：只下沒滿的行，而且會漏看', () => {
    const board = parse(['R......', 'Y......', 'R......', 'Y......', 'Y......', 'YRRR...']);
    let missedWin = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const move = chooseMove(board, 'R', 'easy', seeded(seed));
        assert.ok(openColumns(board).includes(move));
        if (move !== 4) missedWin += 1;
    }
    assert.ok(missedWin > 20 && missedWin < 180);
});

test('同一個種子結果相同；normal 開局不總是同一步', () => {
    const empty = Array(42).fill(null);
    assert.equal(chooseMove(empty, 'R', 'hard', seeded(5)), chooseMove(empty, 'R', 'hard', seeded(5)));
    const picks = new Set();
    for (let seed = 1; seed <= 30; seed++) picks.add(chooseMove(empty, 'R', 'normal', seeded(seed)));
    assert.ok(picks.size > 1);
});
