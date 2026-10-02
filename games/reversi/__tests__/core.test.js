import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SIZE,
    bitMoves,
    cellName,
    chooseMove,
    countDiscs,
    createReversi,
    flipsFor,
    indexOf,
    legalMoves,
    other,
    startBoard,
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

// 8 列字串（'.BW'）畫出整個盤面
function board(rows) {
    assert.equal(rows.length, 8);
    return rows.flatMap((row) => [...row].map((ch) => (ch === '.' ? null : ch)));
}
const at = (name) => indexOf(Number(name[1]) - 1, 'ABCDEFGH'.indexOf(name[0]));
const names = (list) => list.map(cellName).sort();

// 用固定種子從開局隨機下 plies 步，取得各種中盤局面
function randomPosition(plies, random) {
    const game = createReversi();
    for (let k = 0; k < plies && game.status === 'playing'; k++)
        game.play(game.moves[Math.floor(random() * game.moves.length)].index);
    return game;
}

// 暴力 minimax 算出終盤的最佳子數差（以 mark 的角度），對照電腦的終盤計算
function solve(cells, mark, passed = false) {
    const moves = legalMoves(cells, mark);
    if (moves.length === 0) {
        if (passed) {
            const { B, W } = countDiscs(cells);
            return mark === 'B' ? B - W : W - B;
        }
        return -solve(cells, other(mark), true);
    }
    let best = -Infinity;
    for (const { index, flips } of moves) {
        const next = [...cells];
        next[index] = mark;
        for (const i of flips) next[i] = mark;
        best = Math.max(best, -solve(next, other(mark)));
    }
    return best;
}

test('座標名稱：A–H 由左到右、1–8 由上到下；開局四子在中央', () => {
    assert.equal(cellName(0), 'A1');
    assert.equal(cellName(SIZE - 1), 'H8');
    assert.equal(at('D3'), 19);
    const start = startBoard();
    assert.equal(start[at('D4')], 'W');
    assert.equal(start[at('E5')], 'W');
    assert.equal(start[at('E4')], 'B');
    assert.equal(start[at('D5')], 'B');
    assert.deepEqual(countDiscs(start), { B: 2, W: 2 });
});

test('開局黑先，有 D3、C4、F5、E6 四個合法步，各翻一子', () => {
    const game = createReversi();
    assert.equal(game.turn, 'B');
    assert.deepEqual(names(game.moves.map((m) => m.index)), ['C4', 'D3', 'E6', 'F5']);
    for (const move of game.moves) assert.equal(move.flips.length, 1);
    assert.deepEqual(game.flipsOf(at('D3')), [at('D4')]);
});

test('一步可以同時往多個方向翻，夾不住的方向不翻', () => {
    const cells = board([
        'B.B.B...',
        '.WWW....',
        'BW.WB...',
        '.WWW....',
        'B.B.W...',
        '........',
        '........',
        '........',
    ]);
    // C3 往八個方向：右下 D4 → E5 是白，夾不住；其他七個方向都夾得住
    const flips = flipsFor(cells, at('C3'), 'B');
    assert.deepEqual(names(flips), ['B2', 'B3', 'B4', 'C2', 'C4', 'D2', 'D3']);
    // 已經有棋子的格子、旁邊沒有對方棋子的格子都不能下
    assert.deepEqual(flipsFor(cells, at('A1'), 'B'), []);
    assert.deepEqual(flipsFor(cells, at('H8'), 'B'), []);
    // 一整排對方棋子碰到盤邊（沒有自己的棋子收尾）不能翻
    const edge = board([
        '.WWWWWWW',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
    ]);
    assert.deepEqual(flipsFor(edge, at('A1'), 'B'), []);
});

test('下子後翻面、換人，回傳這一步翻了哪些子', () => {
    const game = createReversi();
    const result = game.play(at('D3'));
    assert.deepEqual(result, { index: at('D3'), mark: 'B', flips: [at('D4')] });
    assert.equal(game.board[at('D4')], 'B');
    assert.deepEqual(game.score(), { B: 4, W: 1 });
    assert.equal(game.turn, 'W');
    assert.equal(game.lastIndex(), at('D3'));
    // 不合法的步：不改變任何東西
    assert.equal(game.play(at('A1')), null);
    assert.equal(game.play(at('D3')), null);
    assert.equal(game.turn, 'W');
});

test('對方沒有合法步時 pass，由同一方繼續下', () => {
    // 白下 C8 翻掉 B8 之後，黑只剩 H2：往上的白子碰到盤邊、其他方向都是空格，夾不住任何白子，輪到白再下
    const cells = board([
        '.......W',
        '.......B',
        '........',
        '........',
        '........',
        '........',
        '........',
        'WB......',
    ]);
    const game = createReversi({ board: cells, turn: 'W' });
    assert.deepEqual(game.flipsOf(at('C8')), [at('B8')]);
    const result = game.play(at('C8'));
    assert.equal(result.passed, 'B');
    assert.equal(game.turn, 'W');
    assert.equal(game.status, 'playing');
    assert.deepEqual(names(game.moves.map((m) => m.index)), ['H3']);
    assert.deepEqual(legalMoves(game.board, 'B'), []);

    // 隨機下很多局：每次 pass 時被跳過的一方確實沒有合法步
    const random = seeded(21);
    let passes = 0;
    for (let g = 0; g < 40; g++) {
        const play = createReversi();
        while (play.status === 'playing') {
            const r = play.play(play.moves[Math.floor(random() * play.moves.length)].index);
            if (!r.passed) continue;
            passes++;
            assert.equal(play.turn, r.mark);
            assert.deepEqual(legalMoves(play.board, r.passed), []);
        }
    }
    assert.ok(passes > 0);
});

test('雙方都不能下時結束：子多的贏，同數是和局', () => {
    // 黑下 C1 吃掉 B1，盤上只剩黑子
    const wipe = createReversi({ board: board(['BW......', ...Array(7).fill('........')]), turn: 'B' });
    assert.equal(wipe.isLegal(at('C1')), true);
    const result = wipe.play(at('C1'));
    assert.deepEqual(result.over, { winner: 'B', B: 3, W: 0 });
    assert.equal(wipe.status, 'over');
    assert.equal(wipe.winner, 'B');
    assert.equal(wipe.play(at('D1')), null);

    // 下滿：最後一步之後雙方都沒有空格可下
    const full = board([
        'BBBBBBBB',
        'BBBBBBBB',
        'BBBBBBBB',
        'BBBBBBBB',
        'WWWWWWWW',
        'WWWWWWWW',
        'WWWWWWWW',
        '.BWWWWWW',
    ]);
    const last = createReversi({ board: full, turn: 'W' });
    // 白下 A8 往上夾住 A7…A5？A5–A7 是白，往右上 B7 是白；只有往右翻 B8
    assert.deepEqual(last.flipsOf(at('A8')), [at('B8')]);
    const end = last.play(at('A8'));
    assert.deepEqual(end.over, { winner: null, B: 32, W: 32 });
    assert.equal(last.winner, null);
});

test('收回一步：棋子翻回、輪回原本下的一方（含 pass 之後與結束之後）', () => {
    const game = createReversi();
    game.play(at('D3'));
    game.play(at('C3'));
    const before = [...game.board];
    game.play(at('B3'));
    const undone = game.undo();
    assert.equal(undone.index, at('B3'));
    assert.deepEqual(game.board, before);
    assert.equal(game.turn, 'B');
    game.undo();
    game.undo();
    assert.deepEqual(game.board, startBoard());
    assert.equal(game.undo(), null);

    const wipe = createReversi({ board: board(['BW......', ...Array(7).fill('........')]), turn: 'B' });
    wipe.play(at('C1'));
    wipe.undo();
    assert.equal(wipe.status, 'playing');
    assert.equal(wipe.winner, null);
    assert.equal(wipe.turn, 'B');
    assert.deepEqual(wipe.score(), { B: 1, W: 1 });
});

test('存檔：依序重播每一步還原局面；不合法的存檔會拋出錯誤', () => {
    const random = seeded(7);
    const game = randomPosition(30, random);
    const restored = createReversi({ state: JSON.parse(JSON.stringify(game.toJSON())) });
    assert.deepEqual(restored.board, game.board);
    assert.equal(restored.turn, game.turn);
    assert.equal(restored.history.length, 30);

    // 從指定盤面開始的局，存檔也包含起始盤面
    const custom = createReversi({ board: board(['BW......', ...Array(7).fill('........')]), turn: 'B' });
    assert.deepEqual(createReversi({ state: custom.toJSON() }).board, custom.board);

    assert.throws(() => createReversi({ state: { moves: [0] } }));
    assert.throws(() => createReversi({ state: {} }));
});

test('bitboard 算出的合法步與翻面和逐格檢查的結果一致', () => {
    const random = seeded(11);
    for (let k = 0; k < 120; k++) {
        const game = randomPosition(Math.floor(random() * 58), random);
        for (const mark of ['B', 'W']) {
            const slow = legalMoves(game.board, mark).map((m) => ({
                index: m.index,
                flips: [...m.flips].sort((a, b) => a - b),
            }));
            assert.deepEqual(bitMoves(game.board, mark), slow);
        }
    }
});

test('電腦：沒有合法步回傳 -1，只有一步就下那一步', () => {
    const none = board(['BW......', ...Array(7).fill('........')]);
    for (const level of ['easy', 'normal', 'hard']) {
        assert.equal(chooseMove(none, 'W', level), -1);
        assert.equal(chooseMove(none, 'B', level), at('C1'));
    }
});

test('電腦 normal / hard 會搶角，hard 不下送角的 X 位', () => {
    // 白可以下 A1（角）或其他步；normal、hard 都會選角
    const corner = board([
        '........',
        '.B......',
        '..BW....',
        '...BW...',
        '...BWB..',
        '........',
        '........',
        '........',
    ]);
    assert.ok(flipsFor(corner, at('A1'), 'W').length > 0);
    for (const level of ['normal', 'hard']) {
        for (let seed = 1; seed <= 5; seed++)
            assert.equal(chooseMove(corner, 'W', level, { random: seeded(seed) }), at('A1'));
    }

    // 開局附近：hard 不會主動下 B2 / G2 / B7 / G7（X 位）
    const random = seeded(5);
    for (let k = 0; k < 20; k++) {
        const game = randomPosition(8 + Math.floor(random() * 8), random);
        if (game.status !== 'playing') continue;
        const move = chooseMove(game.board, game.turn, 'hard', { random });
        const xSquares = game.moves.filter((m) => ['B2', 'G2', 'B7', 'G7'].includes(cellName(m.index)));
        if (xSquares.length < game.moves.length) assert.ok(!['B2', 'G2', 'B7', 'G7'].includes(cellName(move)));
    }
});

test('電腦 hard 在終盤算到底：選的步和暴力搜尋的最佳結果相同', () => {
    const random = seeded(3);
    let checked = 0;
    while (checked < 12) {
        const game = randomPosition(52 + Math.floor(random() * 4), random);
        if (game.status !== 'playing') continue;
        const mark = game.turn;
        const best = solve(game.board, mark);
        const move = chooseMove(game.board, mark, 'hard', { random });
        const next = createReversi({ board: game.board, turn: mark });
        next.play(move);
        // 下了之後（輪到誰就以誰的角度）再算到底，換算回 mark 的角度要等於最佳值
        const after = solve(next.board, next.turn);
        assert.equal(next.turn === mark ? after : -after, best, `${cellName(move)} 不是最佳步`);
        checked++;
    }
});

function playMatch(levelA, levelB, games, seed = 1) {
    const tally = { a: 0, b: 0, draw: 0 };
    let slowest = 0;
    for (let g = 0; g < games; g++) {
        const random = seeded(seed + g);
        const game = createReversi();
        const sideA = g % 2 === 0 ? 'B' : 'W';
        while (game.status === 'playing') {
            const level = game.turn === sideA ? levelA : levelB;
            const t = performance.now();
            const move = chooseMove(game.board, game.turn, level, { random });
            slowest = Math.max(slowest, performance.now() - t);
            assert.ok(game.play(move), `${level} 下了不合法的步`);
        }
        if (!game.winner) tally.draw++;
        else if (game.winner === sideA) tally.a++;
        else tally.b++;
    }
    return { ...tally, slowest };
}

test('各難度對下：normal 穩贏 easy，hard 大多贏 normal', () => {
    const normalVsEasy = playMatch('normal', 'easy', 8);
    assert.ok(normalVsEasy.a >= 7, JSON.stringify(normalVsEasy));
    const hardVsNormal = playMatch('hard', 'normal', 8, 100);
    assert.ok(hardVsNormal.a >= 6, JSON.stringify(hardVsNormal));
});

test('電腦 hard 每一步都很快（節點上限保護）', () => {
    const { slowest } = playMatch('hard', 'hard', 3, 50);
    // Node 上最慢一步約 25 ms；留寬鬆的餘裕避免 CI 機器慢時誤判
    assert.ok(slowest < 250, `最慢一步 ${slowest.toFixed(0)} ms`);
});
