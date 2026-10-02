import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NO_CAPTURE_LIMIT,
    START_FEN,
    chooseMove,
    createXiangqi,
    evaluate,
    legalMoves,
    perft,
    squareIndex,
    squareName,
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

// 某一格的子可以走到哪些格子（排序後的座標）
const targets = (fen, square) =>
    legalMoves(fen)
        .filter((m) => m.from === squareIndex(square))
        .map((m) => squareName(m.to))
        .sort();
function playAll(game, list) {
    for (const iccs of list) assert.ok(game.play(iccs), `走不了：${iccs}（${game.fen()}）`);
    return game;
}

test('座標：index 0 = a9、89 = i0，雙向轉換一致', () => {
    assert.equal(squareName(0), 'a9');
    assert.equal(squareName(89), 'i0');
    assert.equal(squareIndex('e0'), 85);
    for (let i = 0; i < 90; i++) assert.equal(squareIndex(squareName(i)), i);
});

test('開局：紅先、44 種走法，棋子擺放正確', () => {
    const game = createXiangqi();
    assert.equal(game.turn, 'r');
    assert.equal(game.moves.length, 44);
    assert.equal(game.fen(), START_FEN);
    assert.equal(game.board[squareIndex('e0')], 'K');
    assert.equal(game.board[squareIndex('h2')], 'C');
    assert.equal(game.board[squareIndex('e9')], 'k');
    assert.equal(game.board[squareIndex('c6')], 'p');
    // 馬：b1 被相擋住 d1，只能跳 a2 / c2
    assert.deepEqual(targets(START_FEN, 'b0'), ['a2', 'c2']);
    // 炮：直走到碰到子為止，隔著 b7 的馬吃 b9 的馬（翻山）
    assert.deepEqual(targets(START_FEN, 'b2'), [
        'a2',
        'b1',
        'b3',
        'b4',
        'b5',
        'b6',
        'b9',
        'c2',
        'd2',
        'e2',
        'f2',
        'g2',
    ]);
    // 帥只能在九宮裡走、仕只能斜走
    assert.deepEqual(targets(START_FEN, 'e0'), ['e1']);
    assert.deepEqual(targets(START_FEN, 'd0'), ['e1']);
});

// perft 數字（開局與 Fairy-Stockfish 的象棋測試局面）
const PERFT = [
    ['開局', START_FEN, [44, 1920, 79666]],
    ['中局', 'r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2BAKAB2 w - - 0 1', [38, 1128, 43929]],
    ['被將', '1cbak4/9/n2a5/2p1p3p/5cp2/2n2N3/6PCP/3AB4/2C6/3A1K1N1 w - - 0 1', [7, 281, 8620]],
    ['殘局 1', '5a3/3k5/3aR4/9/5r3/5n3/9/3A1A3/5K3/2BC2B2 w - - 0 1', [25, 424, 9850]],
    ['殘局 2', 'CRN1k1b2/3ca4/4ba3/9/2nr5/9/9/4B4/4A4/4KA3 w - - 0 1', [28, 516, 14808]],
    ['殘局 3', 'R1N1k1b2/9/3aba3/9/2nr5/2B6/9/4B4/4A4/4KA3 w - - 0 1', [21, 364, 7626]],
];
for (const [name, fen, counts] of PERFT) {
    test(`perft：${name}`, () => {
        counts.forEach((count, k) => assert.equal(perft(fen, k + 1), count, `depth ${k + 1}`));
    });
}

test('perft：開局第 4 層 3,290,240', () => {
    assert.equal(perft(START_FEN, 4), 3290240);
});

test('馬：絆馬腳的方向不能跳', () => {
    // e4 的馬，e5 有子擋住往上的兩步、d4 有子擋住往左的兩步
    const fen = '3k5/9/9/9/4p4/3pN4/9/9/9/5K3 w - - 0 1';
    assert.deepEqual(targets(fen, 'e4'), ['d2', 'f2', 'g3', 'g5']);
});

test('相：塞象眼不能走、不能過河', () => {
    // c4 的相：往上會過河，d3 塞住象眼；只能走 a2
    const fen = '3k5/9/9/9/9/2B6/3p5/9/9/5K3 w - - 0 1';
    assert.deepEqual(targets(fen, 'c4'), ['a2']);
    // 黑象同樣不能過河
    const black = '3k5/9/2b6/9/9/9/9/9/9/5K3 b - - 0 1';
    assert.deepEqual(targets(black, 'c7'), ['a5', 'a9', 'e5', 'e9']);
});

test('仕與帥：不能離開九宮', () => {
    const fen = '3k5/9/9/9/9/9/9/5A3/5K3/9 w - - 0 1';
    assert.deepEqual(targets(fen, 'f2'), ['e1']);
    assert.deepEqual(targets(fen, 'f1'), ['e1', 'f0']);
});

test('炮：沒有炮架不能吃、隔兩個子也不能吃', () => {
    // e2 的炮：往上 e3 是自己的兵（炮架），e6 的卒可以吃；往右沒有炮架，i2 的車吃不到
    const fen = '5k3/9/9/4p4/9/9/4P4/4C3r/9/3K5 w - - 0 1';
    const moves = targets(fen, 'e2');
    assert.ok(moves.includes('e6'));
    assert.ok(!moves.includes('i2'));
    assert.ok(moves.includes('h2'));
    // 炮架後面隔兩個子：e3 兵、e6 卒，e7 的子吃不到
    const two = '5k3/9/4p4/4p4/9/9/4P4/4C4/9/3K5 w - - 0 1';
    assert.ok(!targets(two, 'e2').includes('e7'));
});

test('兵：過河前只能往前，過河後可以橫走，永遠不能後退', () => {
    const fen = '3k5/9/9/9/2P6/6P2/9/9/9/5K3 w - - 0 1';
    assert.deepEqual(targets(fen, 'g4'), ['g5']);
    assert.deepEqual(targets(fen, 'c5'), ['b5', 'c6', 'd5']);
    // 黑卒在底線只能橫走
    assert.deepEqual(targets('3k5/9/9/9/9/9/9/9/9/p4K3 b - - 0 1', 'a0'), ['b0']);
});

test('帥將不能照面：讓開中間的子、或帥走到同一直行都不行', () => {
    // e 行只有 e5 的兵隔著：兵不能橫走離開（雖然已經過河）
    const fen = '4k4/9/9/9/4P4/9/9/9/9/4K4 w - - 0 1';
    assert.deepEqual(targets(fen, 'e5'), ['e6']);
    // 帥在 d0，e 行空著：不能走到 e0（與 e9 的將照面）
    assert.deepEqual(targets('4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1', 'd0'), ['d1']);
});

test('被將軍時只能解將；被牽制的子不能離開', () => {
    // 黑車在 e7 將軍（e 行），紅可以用車擋、或帥走開（f0 會和 f8 的將照面）
    const fen = '9/5k3/4r4/9/9/9/9/9/R8/4K4 w - - 0 1';
    const game = createXiangqi({ fen });
    assert.equal(game.check, squareIndex('e0'));
    assert.deepEqual(game.moves.map((m) => m.iccs).sort(), ['a1e1', 'e0d0']);
    // e1 的仕被 e7 的車牽制？仕斜走離開 e 行就被將：不能走
    const pinned = '3k5/9/4r4/9/9/9/9/9/4A4/4K4 w - - 0 1';
    assert.deepEqual(targets(pinned, 'e1'), []);
});

test('將死：車將軍，帥封住 e 行、另一個車封住 8 列', () => {
    const game = createXiangqi({ fen: '3k5/R8/9/9/7R1/9/9/9/9/4K4 w - - 0 1' });
    const result = game.play('h5d5');
    assert.equal(result.notation, 'Rh5-d5#');
    assert.ok(result.check && result.mate);
    assert.deepEqual(result.over, { winner: 'r', reason: 'checkmate' });
    assert.equal(game.status, 'over');
    assert.equal(game.play('d9d8'), null);
});

test('困斃：沒有步可走就輸（不是和局）', () => {
    const game = createXiangqi({ fen: '3k5/9/R8/9/9/9/9/9/9/4K4 w - - 0 1' });
    const result = game.play('a7a8');
    assert.equal(result.check, false);
    assert.deepEqual(result.over, { winner: 'r', reason: 'stalemate' });
});

test('長將：同一局面第三次出現、一方一直在將軍，將軍的一方輸', () => {
    const game = createXiangqi({ fen: '3k5/9/R8/9/9/9/9/9/9/5K3 w - - 0 1' });
    const cycle = ['a9a8', 'd8d9', 'a8a9', 'd9d8'];
    playAll(game, ['a7a9', 'd9d8', ...cycle]);
    assert.equal(game.status, 'playing');
    assert.equal(game.repeats(), 2);
    playAll(game, cycle.slice(0, 2));
    const result = game.play('a8a9');
    assert.deepEqual(result.over, { winner: 'b', reason: 'perpetual' });
});

test('重複局面：沒有人長將時第三次出現是和局', () => {
    const game = createXiangqi({ fen: '5k3/9/9/9/8r/R8/9/9/9/3K5 w - - 0 1' });
    const cycle = ['a4b4', 'i5h5', 'b4a4', 'h5i5'];
    playAll(game, [...cycle, ...cycle.slice(0, 3)]);
    assert.equal(game.status, 'playing');
    const result = game.play('h5i5');
    assert.deepEqual(result.over, { winner: null, reason: 'repetition' });
});

test('60 回合沒有吃子是和局；吃子重新計算', () => {
    const fen = `5k3/9/9/9/8r/R8/9/9/9/3K5 w - - ${NO_CAPTURE_LIMIT - 2} 70`;
    const game = createXiangqi({ fen });
    game.play('a4b4');
    assert.equal(game.status, 'playing');
    assert.deepEqual(game.play('i5h5').over, { winner: null, reason: 'nocapture' });
    // 吃子之後重新計算
    const other = createXiangqi({ fen: `5k3/9/9/9/8r/8R/9/9/9/3K5 w - - ${NO_CAPTURE_LIMIT - 1} 70` });
    other.play('i4i5');
    assert.equal(other.halfmove, 0);
    assert.equal(other.status, 'playing');
});

test('和局：雙方都沒有能過河攻擊的子', () => {
    const game = createXiangqi({ fen: '3k1a3/4a4/4b4/9/9/9/9/4B4/4A4/5K3 w - - 0 1' });
    assert.equal(game.status, 'over');
    assert.equal(game.reason, 'material');
    assert.equal(game.winner, null);
});

test('收回：局面、輪到誰、沒有吃子的步數都還原', () => {
    const game = createXiangqi();
    playAll(game, ['h2e2', 'h9g7', 'e2e6']);
    assert.equal(game.board[squareIndex('e6')], 'C');
    assert.equal(game.halfmove, 0);
    const taken = game.undo();
    assert.equal(taken.captured, 'p');
    assert.equal(game.board[squareIndex('e6')], 'p');
    assert.equal(game.turn, 'r');
    assert.equal(game.halfmove, 2);
    game.undo();
    game.undo();
    assert.equal(game.fen(), START_FEN);
    assert.equal(game.undo(), null);
});

test('存檔：toJSON 之後可以接著玩；不合法的存檔丟出錯誤', () => {
    const game = playAll(createXiangqi(), ['h2e2', 'h9g7', 'h0g2']);
    const restored = createXiangqi({ state: JSON.parse(JSON.stringify(game.toJSON())) });
    assert.equal(restored.fen(), game.fen());
    assert.equal(restored.history.length, 3);
    assert.equal(restored.history[0].notation, 'Ch2-e2');
    const fen = '3k5/9/R8/9/9/9/9/9/9/5K3 w - - 0 1';
    const fromFen = playAll(createXiangqi({ fen }), ['a7a9']);
    assert.equal(createXiangqi({ state: fromFen.toJSON() }).fen(), fromFen.fen());
    assert.throws(() => createXiangqi({ state: { moves: ['e0e2'] } }));
    assert.throws(() => createXiangqi({ state: { moves: 'h2e2' } }));
});

test('記譜：吃子用 x、將軍加 +', () => {
    const game = playAll(createXiangqi(), ['h2e2', 'h9g7']);
    const result = game.play('e2e6');
    assert.equal(result.notation, 'Ce2xe6');
    assert.equal(result.check, false);
    const check = createXiangqi({ fen: '3k5/9/R8/9/9/9/9/9/9/5K3 w - - 0 1' }).play('a7a9');
    assert.equal(check.notation, 'Ra7-a9+');
    assert.ok(check.check);
});

test('吃掉的子與子力差', () => {
    const game = playAll(createXiangqi(), ['h2e2', 'h9g7', 'e2e6', 'g7e6']);
    const { taken, diff } = game.material();
    assert.deepEqual(taken, { r: ['p'], b: ['c'] });
    assert.equal(diff, -3);
});

test('評估：子力多的一方分數高，以輪到的一方的角度', () => {
    assert.equal(evaluate(START_FEN), 0);
    const up = '3k5/9/9/9/9/9/9/9/9/R3K4 w - - 0 1';
    assert.ok(evaluate(up) > 400);
    assert.ok(evaluate(up.replace(' w ', ' b ')) < -400);
});

test('電腦：一步將死就將死、有白送的車就吃', () => {
    // 黑卒還能動（不是困斃）；Rh5-d5 與 Rh5-h9 都是一步將死
    const fen = '3k5/R8/9/9/7R1/9/8p/9/9/4K4 w - - 0 1';
    for (const level of ['easy', 'normal', 'hard']) {
        const game = createXiangqi({ fen });
        const move = chooseMove(game, level, { random: () => 0.5 });
        assert.ok(game.play(move).mate, `${level}：${move.iccs}`);
    }
    // 黑車在 a5 沒人保護，紅車可以吃
    for (const level of ['easy', 'normal', 'hard']) {
        const free = chooseMove('4ka3/4a4/9/9/r8/9/9/9/9/R3K4 w - - 0 1', level, { random: () => 0.5 });
        assert.equal(free.iccs, 'a0a5', level);
    }
});

test('電腦：不走會被一步將死的步', () => {
    // 黑方威脅 Rh4-d4#（照上面的將死局面上下對調）：紅方要先防
    const fen = '4k4/9/8R/9/9/7r1/9/9/r8/3K5 w - - 0 1';
    const game = createXiangqi({ fen });
    const move = chooseMove(game, 'hard');
    game.play(move);
    assert.ok(
        !game.moves.some((m) => {
            const copy = createXiangqi({ state: game.toJSON() });
            return copy.play(m).mate;
        })
    );
});

test('電腦：大幅領先時不會長將（會輸）', () => {
    const game = createXiangqi({ fen: '3k5/9/R8/9/9/9/9/9/9/5K3 w - - 0 1' });
    playAll(game, ['a7a9', 'd9d8', 'a9a8', 'd8d9']);
    const move = chooseMove(game, 'hard');
    assert.notEqual(move.iccs, 'a8a9');
});

test('電腦：只有一步時直接走、沒有步時回傳 null、回傳的一定是合法步', () => {
    const game = createXiangqi({ fen: '3k5/9/4r4/9/9/9/9/9/9/4K4 w - - 0 1' });
    assert.equal(game.moves.length, 1);
    assert.equal(chooseMove(game, 'hard').iccs, 'e0f0');
    assert.equal(chooseMove('3k5/R8/9/9/9/9/9/9/9/4K4 b - - 0 1', 'hard'), null);
    const play = createXiangqi();
    const random = seeded(11);
    for (let k = 0; k < 30 && play.status === 'playing'; k++) {
        const move = chooseMove(play, ['easy', 'normal', 'hard'][k % 3], { random });
        assert.ok(play.moves.some((m) => m.iccs === move.iccs));
        assert.ok(play.play(move));
    }
});

test('電腦：各難度對下，強的贏多；每一步都很快', () => {
    const times = { easy: [], normal: [], hard: [] };
    const play = (red, black, seed) => {
        const random = seeded(seed);
        const game = createXiangqi();
        while (game.status === 'playing' && game.history.length < 240) {
            const level = game.turn === 'r' ? red : black;
            const start = performance.now();
            const move = chooseMove(game, level, { random });
            times[level].push(performance.now() - start);
            game.play(move);
        }
        return game.winner;
    };
    let hardWins = 0;
    for (let seed = 1; seed <= 2; seed++) {
        if (play('hard', 'easy', seed) === 'r') hardWins++;
        if (play('easy', 'hard', seed + 10) === 'b') hardWins++;
    }
    assert.ok(hardWins >= 3, `hard 對 easy 只贏了 ${hardWins} 局`);
    let normalWins = 0;
    for (let seed = 1; seed <= 2; seed++) if (play('normal', 'easy', seed + 20) === 'r') normalWins++;
    assert.ok(normalWins >= 1, `normal 對 easy 只贏了 ${normalWins} 局`);
    const median = (list) => list.sort((a, b) => a - b)[list.length >> 1];
    // 手機大約慢 3–4 倍：Node 上 hard 的中位數要在 40 ms 以內
    assert.ok(median(times.hard) < 40, `hard 中位數 ${median(times.hard).toFixed(1)} ms`);
    assert.ok(median(times.normal) < 15, `normal 中位數 ${median(times.normal).toFixed(1)} ms`);
});
