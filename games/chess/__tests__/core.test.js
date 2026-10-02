import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FIFTY_LIMIT,
    START_FEN,
    chooseMove,
    createChess,
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

const sans = (fen) =>
    legalMoves(fen)
        .map((m) => m.san)
        .sort();
const sansFrom = (fen, square) =>
    legalMoves(fen)
        .filter((m) => m.from === squareIndex(square))
        .map((m) => m.san)
        .sort();
// 依序走 SAN（測試寫起來比較好讀）
function playSan(game, list) {
    for (const san of list) {
        const move = legalMoves(game.fen()).find((m) => m.san === san);
        assert.ok(move, `不合法的一步：${san}（${game.fen()}）`);
        assert.ok(game.play(move.uci), `走不了：${san}`);
    }
    return game;
}

test('座標：index 0 = a8、63 = h1，雙向轉換一致', () => {
    assert.equal(squareName(0), 'a8');
    assert.equal(squareName(63), 'h1');
    assert.equal(squareIndex('e4'), 36);
    for (let i = 0; i < 64; i++) assert.equal(squareIndex(squareName(i)), i);
});

test('開局：白先、20 種走法，棋子擺放正確', () => {
    const game = createChess();
    assert.equal(game.turn, 'w');
    assert.equal(game.moves.length, 20);
    assert.equal(game.fen(), START_FEN);
    assert.equal(game.board[squareIndex('e1')], 'K');
    assert.equal(game.board[squareIndex('d8')], 'q');
    assert.deepEqual(game.movable().map(squareName).sort(), [
        'a2',
        'b1',
        'b2',
        'c2',
        'd2',
        'e2',
        'f2',
        'g1',
        'g2',
        'h2',
    ]);
    assert.deepEqual(sansFrom(START_FEN, 'g1'), ['Nf3', 'Nh3']);
});

// 標準的 perft 數字（https://www.chessprogramming.org/Perft_Results）
const PERFT = [
    ['開局', START_FEN, [20, 400, 8902, 197281]],
    ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['局面 3（吃過路兵、牽制）', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['局面 4（升變、入堡）', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['局面 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
for (const [name, fen, counts] of PERFT) {
    test(`perft：${name}`, () => {
        counts.forEach((count, d) => assert.equal(perft(fen, d + 1), count, `depth ${d + 1}`));
    });
}

test('不能走到被攻擊的格子，被牽制的子不能離開', () => {
    // 白王 e1、白馬 e2 被 e8 的黑車牽制；黑主教 b4 控制 d2
    const fen = '4r2k/8/8/8/1b6/8/4N3/4K3 w - - 0 1';
    assert.deepEqual(sansFrom(fen, 'e2'), []);
    assert.deepEqual(sansFrom(fen, 'e1'), ['Kd1', 'Kf1', 'Kf2']);
});

test('被將軍時只能解將：擋、吃、或走王', () => {
    const fen = '4k3/8/8/8/8/8/3B4/r3K3 w - - 0 1';
    const game = createChess({ fen });
    assert.equal(game.check, squareIndex('e1'));
    assert.deepEqual(sans(fen), ['Bc1', 'Ke2', 'Kf2']);
});

test('入堡：兩邊都可以；中間有子、被將時、經過或停在被攻擊的格子都不行', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    assert.ok(sansFrom(fen, 'e1').includes('O-O'));
    assert.ok(sansFrom(fen, 'e1').includes('O-O-O'));
    // 中間有子
    assert.ok(!sansFrom('r3k2r/8/8/8/8/8/8/R2QK1NR w KQkq - 0 1', 'e1').some((s) => s.startsWith('O-O')));
    // 被將時不能入堡
    assert.ok(!sansFrom('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1', 'e1').some((s) => s.startsWith('O-O')));
    // f1 被攻擊：不能短入堡，長入堡可以
    let moves = sansFrom('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1', 'e1');
    assert.ok(!moves.includes('O-O'));
    // （f2 的車將不到 e1，但 f1 被攻擊）
    assert.ok(moves.includes('O-O-O'));
    // g1 被攻擊（停的格子）：不能短入堡
    moves = sansFrom('r3k2r/8/8/8/8/8/6r1/R3K2R w KQkq - 0 1', 'e1');
    assert.ok(!moves.includes('O-O'));
    // 長入堡時只有 b1 被攻擊沒關係（王不經過 b1）
    moves = sansFrom('r3k2r/8/8/8/8/8/1r6/R3K2R w KQkq - 0 1', 'e1');
    assert.ok(moves.includes('O-O-O'));
    // 沒有入堡權
    assert.ok(!sansFrom('r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1', 'e1').some((s) => s.startsWith('O-O')));
});

test('入堡：王與車一起移動；王或車動過、車被吃之後就失去入堡權', () => {
    const game = createChess({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    const result = game.play('e1g1');
    assert.equal(result.castle, 'king');
    assert.equal(result.san, 'O-O');
    assert.equal(game.board[squareIndex('g1')], 'K');
    assert.equal(game.board[squareIndex('f1')], 'R');
    assert.equal(game.board[squareIndex('h1')], null);
    assert.ok(game.fen().includes(' b kq '));
    // 黑車 a8 走掉 → 黑方失去長入堡
    game.play('a8b8');
    assert.ok(game.fen().includes(' w k '));
    // 白車吃掉 h8 的車 → 黑方也失去短入堡
    const capture = createChess({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    capture.play('h1h8');
    assert.ok(capture.fen().includes(' b Qq '));
    // 王走一步再走回來也沒有入堡權
    const king = createChess({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    king.play('e1e2');
    king.play('e8e7');
    king.play('e2e1');
    king.play('e7e8');
    assert.ok(!king.movesFrom(squareIndex('e1')).some((m) => m.castle));
});

test('吃過路兵：只能在對方走兩格的下一手；吃完拿掉旁邊的兵', () => {
    const game = createChess({ fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1' });
    game.play('d7d5');
    assert.ok(game.fen().includes(' d6 '));
    const ep = game.moves.find((m) => m.enPassant);
    assert.equal(ep.uci, 'e5d6');
    const result = game.play('e5d6');
    assert.equal(result.san, 'exd6');
    assert.equal(result.captured, 'p');
    assert.equal(result.capturedAt, squareIndex('d5'));
    assert.equal(game.board[squareIndex('d5')], null);
    assert.equal(game.board[squareIndex('d6')], 'P');
    // 沒有馬上吃就不能再吃
    const late = createChess({ fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1' });
    late.play('d7d5');
    late.play('e1e2');
    late.play('e8e7');
    assert.ok(!late.moves.some((m) => m.enPassant));
    // 吃了之後同一列的車會將到自己的王：不合法
    assert.ok(!legalMoves('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1').some((m) => m.enPassant));
    // 沒有兵可以吃時不記錄目標格（重複局面才比得準）
    const none = createChess();
    none.play('e2e4');
    assert.ok(none.fen().includes(' - '));
});

test('升變：四種棋子可選，沒有指定就不能走；升變可以將軍（b8 的馬擋住時 a8=Q 不是將軍）', () => {
    const fen = '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    assert.deepEqual(sansFrom(fen, 'a7'), ['a8=B', 'a8=N', 'a8=Q', 'a8=R', 'axb8=B', 'axb8=N', 'axb8=Q+', 'axb8=R+']);
    const game = createChess({ fen });
    assert.ok(game.needsPromotion(squareIndex('a7'), squareIndex('a8')));
    assert.ok(!game.needsPromotion(squareIndex('e1'), squareIndex('e2')));
    assert.equal(game.play({ from: squareIndex('a7'), to: squareIndex('a8') }), null);
    const result = game.play({ from: squareIndex('a7'), to: squareIndex('b8'), promotion: 'n' });
    assert.equal(result.san, 'axb8=N');
    assert.equal(result.captured, 'n');
    assert.equal(game.board[squareIndex('b8')], 'N');
    // 收回之後還原成兵
    game.undo();
    assert.equal(game.board[squareIndex('a7')], 'P');
    assert.equal(game.board[squareIndex('b8')], 'n');
});

test('記譜：同種棋子都能走到同一格時加上出發的直行或橫列', () => {
    // 兩匹馬 b1、f1 都能到 d2；兩個車 a1、a5 都能到 a3
    const fen = '4k3/8/8/R7/8/8/8/RN2KN2 w - - 0 1';
    const moves = sans(fen);
    assert.ok(moves.includes('Nbd2'));
    assert.ok(moves.includes('Nfd2'));
    assert.ok(moves.includes('R1a3'));
    assert.ok(moves.includes('R5a3'));
    assert.ok(moves.includes('Nc3'));
});

test('記譜：三個后的消歧義（直行相同用橫列、都相同寫完整的格子）', () => {
    // a1、a4、d1 三個后都能到 d4
    const fen = '6k1/8/8/8/Q7/8/8/Q2QK3 w - - 0 1';
    const toD4 = legalMoves(fen)
        .filter((m) => m.to === squareIndex('d4'))
        .map((m) => m.san)
        .sort();
    assert.deepEqual(toD4, ['Q4d4', 'Qa1d4', 'Qdd4']);
});

test('將死：Fool’s mate，記譜加上 #', () => {
    const game = playSan(createChess(), ['f3', 'e5', 'g4']);
    const result = game.play('d8h4');
    assert.equal(result.san, 'Qh4#');
    assert.equal(result.mate, true);
    assert.deepEqual(result.over, { winner: 'b', reason: 'checkmate' });
    assert.equal(game.status, 'over');
    assert.equal(game.check, squareIndex('e1'));
    assert.equal(game.play('e1f2'), null);
});

test('逼和：沒有步可走但沒被將軍是和局', () => {
    // 黑王 a8 的 a7、b7、b8 都被 c7 的后控制，但沒被將軍
    const stale = createChess({ fen: 'k7/2Q5/8/8/8/8/8/7K w - - 0 1' });
    const r = stale.play('h1g1');
    assert.equal(r.san, 'Kg1');
    assert.deepEqual(r.over, { winner: null, reason: 'stalemate' });
});

test('和局：雙方都不可能將死對方', () => {
    const cases = [
        ['8/8/8/4k3/8/8/8/4K3 w - - 0 1', true],
        ['8/8/8/4k3/8/8/8/4KB2 w - - 0 1', true],
        ['8/8/8/4k3/8/8/8/4KN2 w - - 0 1', true],
        // 同色格的象
        ['8/8/8/3bk3/8/8/8/4KB2 w - - 0 1', true],
        // 不同色格的象可以將死
        ['8/8/8/2b1k3/8/8/8/4KB2 w - - 0 1', false],
        ['8/8/8/3nk3/8/8/8/4KN2 w - - 0 1', false],
        ['8/8/8/4k3/8/8/8/4KNN1 w - - 0 1', false],
        ['8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', false],
    ];
    for (const [fen, dead] of cases) {
        const game = createChess({ fen });
        assert.equal(game.reason === 'material', dead, fen);
    }
});

test('和局：吃掉最後的子之後只剩雙王', () => {
    const game = createChess({ fen: '8/8/8/4k3/8/8/4r3/4K3 w - - 0 1' });
    const result = game.play('e1e2');
    assert.equal(result.san, 'Kxe2');
    assert.deepEqual(result.over, { winner: null, reason: 'material' });
});

test('和局：同一局面第三次出現（三次重複）', () => {
    const game = createChess();
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    for (const uci of shuffle) game.play(uci);
    assert.equal(game.status, 'playing');
    assert.equal(game.repeats(), 2);
    for (const uci of shuffle.slice(0, 3)) game.play(uci);
    assert.equal(game.status, 'playing');
    const result = game.play('f6g8');
    assert.deepEqual(result.over, { winner: null, reason: 'repetition' });
    // 收回之後繼續
    game.undo();
    assert.equal(game.status, 'playing');
});

test('和局：50 回合沒有吃子也沒有動兵', () => {
    const game = createChess({ fen: `4k3/8/8/8/8/8/8/R3K3 w - - ${FIFTY_LIMIT - 1} 80` });
    assert.equal(game.status, 'playing');
    const result = game.play('a1a2');
    assert.deepEqual(result.over, { winner: null, reason: 'fifty' });
    // 吃子或動兵就重新計算
    const reset = createChess({ fen: `4k3/8/8/8/8/8/4P3/R3K3 w - - ${FIFTY_LIMIT - 1} 80` });
    reset.play('e2e3');
    assert.equal(reset.status, 'playing');
    assert.equal(reset.halfmove, 0);
});

test('將死比 50 回合優先', () => {
    const game = createChess({ fen: `k7/8/1K6/8/8/8/8/7R w - - ${FIFTY_LIMIT - 1} 80` });
    const result = game.play('h1h8');
    assert.equal(result.san, 'Rh8#');
    assert.equal(result.over.reason, 'checkmate');
});

test('收回：局面、入堡權、吃過路兵、輪到誰都還原', () => {
    const game = createChess();
    const fens = [game.fen()];
    for (const uci of ['e2e4', 'd7d5', 'e4e5', 'f7f5', 'e5f6', 'e8f7', 'f6g7', 'f7g6', 'g7h8q']) {
        assert.ok(game.play(uci), uci);
        fens.push(game.fen());
    }
    assert.equal(game.last().san, 'gxh8=Q');
    while (game.history.length) {
        fens.pop();
        game.undo();
        assert.equal(game.fen(), fens.at(-1));
    }
    assert.equal(game.undo(), null);
    assert.equal(game.moves.length, 20);
});

test('存檔：toJSON 之後可以接著玩；不合法的存檔丟出錯誤', () => {
    const game = playSan(createChess(), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'O-O']);
    const saved = JSON.parse(JSON.stringify(game.toJSON()));
    assert.deepEqual(saved, { moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'e1g1'] });
    const restored = createChess({ state: saved });
    assert.equal(restored.fen(), game.fen());
    assert.equal(restored.history.length, 7);
    assert.equal(restored.last().san, 'O-O');
    // 從指定局面開始的也存得回來
    const custom = createChess({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' });
    custom.play('a7a8q');
    const again = createChess({ state: JSON.parse(JSON.stringify(custom.toJSON())) });
    assert.equal(again.fen(), custom.fen());
    assert.throws(() => createChess({ state: { moves: ['e2e5'] } }));
    assert.throws(() => createChess({ state: { moves: 'e2e4' } }));
    assert.throws(() => createChess({ fen: 'not a fen' }));
});

test('吃掉的子與子力差', () => {
    const game = playSan(createChess(), ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qxa2', 'Rxa2']);
    const { taken, diff } = game.material();
    assert.deepEqual(taken, { w: ['q', 'p'], b: ['p', 'p'] });
    assert.equal(diff, 9 - 1);
});

test('評估：子力多的一方分數高，以輪到的一方的角度', () => {
    assert.equal(evaluate(START_FEN), 0);
    assert.ok(evaluate('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1') > 800);
    assert.ok(evaluate('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1') < -800);
});

test('電腦：一步將死就將死、有白送的后就吃', () => {
    for (const level of ['easy', 'normal', 'hard']) {
        const random = seeded(7);
        // 後排將死
        const mate = chooseMove('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', level, { random: () => 0.99 });
        if (level !== 'easy') assert.equal(mate.uci, 'a1a8', level);
        // 白送的后
        const queen = chooseMove('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', level, { random });
        if (level !== 'easy') assert.equal(queen.uci, 'd1d5', level);
    }
});

test('電腦：不走會被一步將死的步、會擋將死', () => {
    // 黑方 Qh4 威脅 Qxf2#（主教 c5 支援）：白方必須防守
    const fen = 'r1b1k1nr/pppp1ppp/2n5/2b1p3/2B1P2q/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5';
    for (const level of ['normal', 'hard']) {
        const move = chooseMove(fen, level, { random: seeded(3) });
        const game = createChess({ fen });
        game.play(move.uci);
        const reply = chooseMove(game, 'hard', { random: seeded(1) });
        const after = createChess({ fen: game.fen() });
        after.play(reply.uci);
        assert.notEqual(after.reason, 'checkmate', `${level} 走了 ${move.uci}`);
    }
});

test('電腦：王 + 后對單王會將死', () => {
    for (const level of ['normal', 'hard']) {
        const random = seeded(5);
        const game = createChess({ fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1' });
        while (game.status === 'playing') game.play(chooseMove(game, game.turn === 'w' ? level : 'hard', { random }));
        assert.equal(game.reason, 'checkmate', level);
        assert.equal(game.winner, 'w');
    }
});

test('電腦：只有一步時直接走、沒有步時回傳 null、回傳的一定是合法步', () => {
    assert.equal(chooseMove('k7/2Q5/8/8/8/8/8/7K b - - 0 1', 'hard'), null);
    const only = chooseMove('k7/8/1K6/8/8/8/8/1R6 b - - 0 1', 'hard');
    assert.ok(only);
    const game = createChess();
    const random = seeded(11);
    for (let k = 0; k < 30 && game.status === 'playing'; k++) {
        const move = chooseMove(game, ['easy', 'normal', 'hard'][k % 3], { random });
        assert.ok(game.moves.some((m) => m.uci === move.uci));
        assert.ok(game.play(move));
    }
});

test('電腦：各難度對下，強的贏多；每一步都很快', () => {
    const times = { easy: [], normal: [], hard: [] };
    const play = (white, black, seed) => {
        const random = seeded(seed);
        const game = createChess();
        while (game.status === 'playing' && game.history.length < 240) {
            const level = game.turn === 'w' ? white : black;
            const start = performance.now();
            const move = chooseMove(game, level, { random });
            times[level].push(performance.now() - start);
            game.play(move);
        }
        return game.winner;
    };
    let hardWins = 0;
    for (let seed = 1; seed <= 2; seed++) {
        if (play('hard', 'easy', seed) === 'w') hardWins++;
        if (play('easy', 'hard', seed + 10) === 'b') hardWins++;
    }
    assert.ok(hardWins >= 3, `hard 對 easy 只贏了 ${hardWins} 局`);
    let normalWins = 0;
    for (let seed = 1; seed <= 2; seed++) if (play('normal', 'easy', seed + 20) === 'w') normalWins++;
    assert.ok(normalWins >= 1, `normal 對 easy 只贏了 ${normalWins} 局`);
    const median = (list) => list.sort((a, b) => a - b)[list.length >> 1];
    // 手機大約慢 3–4 倍：Node 上 hard 的中位數要在 40 ms 以內
    assert.ok(median(times.hard) < 40, `hard 中位數 ${median(times.hard).toFixed(1)} ms`);
    assert.ok(median(times.normal) < 15, `normal 中位數 ${median(times.normal).toFixed(1)} ms`);
});
