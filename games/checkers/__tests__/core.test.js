import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DARK,
    QUIET_LIMIT,
    SIZE,
    applyMove,
    cellName,
    chooseMove,
    countPieces,
    createCheckers,
    evaluate,
    legalMoves,
    narrowMoves,
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

// 'c3' → index
const at = (name) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
// 依座標擺子：place({ c3: 'r', d4: 'b', e1: 'R' })；只能擺在深色格
function place(pieces) {
    const board = Array(SIZE).fill(null);
    for (const [name, piece] of Object.entries(pieces)) {
        assert.ok(DARK.includes(at(name)), `${name} 不是深色格`);
        board[at(name)] = piece;
    }
    return board;
}
// 一步的寫法：走 c3-d4、吃 c3xe5xc7
const notation = (m) => m.path.map(cellName).join(m.captures.length ? 'x' : '-');
const notations = (moves) => moves.map(notation).sort();

test('座標名稱：a–h 由左到右、紅方底線是第 1 列；開局各 12 子都在深色格', () => {
    assert.equal(cellName(at('a1')), 'a1');
    assert.equal(at('a8'), 0);
    assert.equal(at('h1'), SIZE - 1);
    assert.equal(DARK.length, 32);
    const start = startBoard();
    assert.deepEqual(countPieces(start), { r: { men: 12, kings: 0 }, b: { men: 12, kings: 0 } });
    for (let i = 0; i < SIZE; i++) if (start[i]) assert.ok(DARK.includes(i));
    // a1 是深色格（紅方左下角），h8 也是
    assert.equal(start[at('a1')], 'r');
    assert.equal(start[at('h8')], 'b');
});

test('開局紅先，有 7 種走法，都是往前斜走一格', () => {
    const game = createCheckers();
    assert.equal(game.turn, 'r');
    assert.deepEqual(notations(game.moves), ['a3-b4', 'c3-b4', 'c3-d4', 'e3-d4', 'e3-f4', 'g3-f4', 'g3-h4']);
    assert.equal(game.mustCapture(), false);
    assert.deepEqual(game.movable().map(cellName).sort(), ['a3', 'c3', 'e3', 'g3']);
});

test('兵只能往前，王可以前後走；盤邊不會繞到另一邊', () => {
    const b = place({ a1: 'r', c5: 'r', e3: 'R', h8: 'b' });
    assert.deepEqual(notations(legalMoves(b, 'r')), ['a1-b2', 'c5-b6', 'c5-d6', 'e3-d2', 'e3-d4', 'e3-f2', 'e3-f4']);
    assert.deepEqual(notations(legalMoves(b, 'b')), ['h8-g7']);
});

test('能吃就一定要吃：有吃子的步時，其他步都不能走', () => {
    const b = place({ c3: 'r', h2: 'r', d4: 'b', a7: 'b' });
    const moves = legalMoves(b, 'r');
    assert.deepEqual(notations(moves), ['c3xe5']);
    assert.deepEqual(moves[0].captures, [at('d4')]);
    const game = createCheckers({ board: b });
    assert.equal(game.mustCapture(), true);
    assert.deepEqual(game.movable(), [at('c3')]);
    assert.equal(game.play([at('h2'), at('g3')]), null);
    const result = game.play([at('c3'), at('e5')]);
    assert.deepEqual(result.captured, ['b']);
    assert.equal(game.board[at('d4')], null);
    assert.equal(game.board[at('e5')], 'r');
});

test('兵不能往後吃', () => {
    // 紅兵 c5、黑兵 b4 互相在對方的後方
    const b = place({ c5: 'r', b4: 'b' });
    assert.deepEqual(notations(legalMoves(b, 'r')), ['c5-b6', 'c5-d6']);
    assert.deepEqual(notations(legalMoves(b, 'b')), ['b4-a3', 'b4-c3']);
});

test('連跳要跳到底；分岔時可以選任一條路，不一定要吃最多', () => {
    // c3 吃 d4 到 e5，之後可以吃 d6 到 c7，或吃 f6 到 g7；不能停在 e5
    const b = place({ c3: 'r', d4: 'b', d6: 'b', f6: 'b' });
    const moves = legalMoves(b, 'r');
    assert.deepEqual(notations(moves), ['c3xe5xc7', 'c3xe5xg7']);
    assert.deepEqual(moves.find((m) => m.to === at('g7')).captures, [at('d4'), at('f6')]);

    // c3 往右可以連吃兩子，往左與 a3 都只能吃一子：三種都可以選
    const branch = place({ a3: 'r', c3: 'r', b4: 'b', d4: 'b', f6: 'b' });
    assert.deepEqual(notations(legalMoves(branch, 'r')), ['a3xc5', 'c3xa5', 'c3xe5xg7']);
});

test('兵吃到底線升王，這一步就結束（不能用王的身分接著往回吃）', () => {
    // b6 吃 c7 到 d8 升王；如果是王可以接著吃 e7，但升王時這一步結束
    const b = place({ b6: 'r', c7: 'b', e7: 'b' });
    const moves = legalMoves(b, 'r');
    assert.deepEqual(notations(moves), ['b6xd8']);
    assert.equal(moves[0].promote, true);
    const game = createCheckers({ board: b });
    const result = game.play(moves[0]);
    assert.equal(result.promote, true);
    assert.equal(game.board[at('d8')], 'R');
    assert.equal(game.board[at('e7')], 'b');
    assert.equal(game.turn, 'b');
});

test('走到底線升王；王可以往回吃', () => {
    const game = createCheckers({ board: place({ c7: 'r', h6: 'b' }) });
    assert.deepEqual(notations(game.moves), ['c7-b8', 'c7-d8']);
    assert.ok(game.moves.every((m) => m.promote));
    game.play([at('c7'), at('d8')]);
    assert.equal(game.board[at('d8')], 'R');

    const king = place({ d4: 'R', c3: 'b' });
    const moves = legalMoves(king, 'r');
    assert.deepEqual(notations(moves), ['d4xb2']);
    assert.equal(moves[0].promote, false);
    // 黑兵走到第 1 列升王
    const black = createCheckers({ board: place({ b2: 'b', h8: 'r' }), turn: 'b' });
    black.play([at('b2'), at('c1')]);
    assert.equal(black.board[at('c1')], 'B');
});

test('王連跳：同一子不能吃兩次，可以經過出發的格子，被吃的子要整步走完才拿掉', () => {
    // 王在 c3，d4、f4、f2、d2 各一個黑子：繞一圈吃掉四子回到 c3（順時針、逆時針兩種）
    const loop = place({ c3: 'R', d4: 'b', f4: 'b', f2: 'b', d2: 'b' });
    const moves = legalMoves(loop, 'r');
    assert.deepEqual(notations(moves), ['c3xe1xg3xe5xc3', 'c3xe5xg3xe1xc3']);
    for (const m of moves) {
        assert.equal(m.to, at('c3'));
        assert.equal(new Set(m.captures).size, 4);
    }
    // 走完之後四子都被拿掉，王回到原位；applyMove 不改原本的盤面
    const after = applyMove(loop, moves[0]);
    assert.deepEqual(countPieces(after), { r: { men: 0, kings: 1 }, b: { men: 0, kings: 0 } });
    assert.equal(after[at('c3')], 'R');
    assert.equal(loop[at('d4')], 'b');

    // 被吃但還沒拿掉的子擋住落點：王吃 d4 到 e5 之後，不能再落到 c3 以外被佔住的格子
    const blocked = place({ a1: 'R', b2: 'b', d4: 'b', e5: 'b' });
    assert.deepEqual(notations(legalMoves(blocked, 'r')), ['a1xc3']);
});

test('narrowMoves：選子之後依序點落點，算出下一個可以點的格子與終點', () => {
    const moves = legalMoves(place({ c3: 'r', d4: 'b', d6: 'b', f6: 'b' }), 'r');
    const first = narrowMoves(moves, at('c3'));
    assert.deepEqual(first.next, [at('e5')]);
    assert.deepEqual(first.ends.map(cellName).sort(), ['c7', 'g7']);
    assert.equal(first.done, null);
    const second = narrowMoves(moves, at('c3'), [at('e5')]);
    assert.deepEqual(second.next.map(cellName).sort(), ['c7', 'g7']);
    assert.equal(second.done, null);
    const third = narrowMoves(moves, at('c3'), [at('e5'), at('g7')]);
    assert.deepEqual(third.next, []);
    assert.equal(notation(third.done), 'c3xe5xg7');
    // 點錯落點或不能動的子：沒有任何步
    assert.equal(narrowMoves(moves, at('c3'), [at('a5')]).moves.length, 0);
    assert.equal(narrowMoves(moves, at('d6')).moves.length, 0);
});

test('對方沒有棋子或沒有步可走就贏', () => {
    const game = createCheckers({ board: place({ c3: 'r', d4: 'b' }) });
    const result = game.play([at('c3'), at('e5')]);
    assert.deepEqual(result.over, { winner: 'r', reason: 'no-moves' });
    assert.equal(game.status, 'over');
    assert.equal(game.winner, 'r');
    assert.equal(game.play(game.moves[0] ?? [at('e5'), at('d6')]), null);

    // 黑兵 h6 前面是 g5，後面 f4 也有紅子，不能走也不能吃；紅走 a1-b2 之後黑還有棋子但沒有步可走
    const stuck = createCheckers({ board: place({ h6: 'b', g5: 'r', f4: 'r', a1: 'r' }) });
    const end = stuck.play([at('a1'), at('b2')]);
    assert.deepEqual(end.over, { winner: 'r', reason: 'no-moves' });
});

test('同一局面第三次出現是和局；收回後恢復', () => {
    const game = createCheckers({ board: place({ b8: 'R', g1: 'B' }) });
    const shuffle = [
        [at('b8'), at('a7')],
        [at('g1'), at('h2')],
        [at('a7'), at('b8')],
        [at('h2'), at('g1')],
    ];
    for (const path of shuffle) assert.ok(game.play(path));
    assert.equal(game.status, 'playing');
    for (const path of shuffle.slice(0, 3)) assert.ok(game.play(path));
    const result = game.play(shuffle[3]);
    assert.deepEqual(result.over, { winner: null, reason: 'repetition' });
    game.undo();
    assert.equal(game.status, 'playing');
    assert.equal(game.turn, 'b');
});

test('太久沒有吃子也沒有動兵是和局；動兵或吃子會重新計算', () => {
    assert.equal(QUIET_LIMIT, 80);
    const game = createCheckers({ board: place({ b8: 'R', g1: 'B' }), quietLimit: 6 });
    const path = ['b8-c7', 'g1-f2', 'c7-d6', 'f2-g3', 'd6-c5'];
    for (const step of path) assert.ok(game.play(step.split('-').map(at)));
    assert.equal(game.quiet, 5);
    assert.equal(game.status, 'playing');
    assert.deepEqual(game.play([at('g3'), at('h4')]).over, { winner: null, reason: 'quiet' });

    const fresh = createCheckers({ board: place({ b8: 'R', g1: 'B', a3: 'r' }) });
    fresh.play([at('b8'), at('c7')]);
    fresh.play([at('g1'), at('f2')]);
    assert.equal(fresh.quiet, 2);
    fresh.play([at('a3'), at('b4')]);
    assert.equal(fresh.quiet, 0);
    fresh.undo();
    assert.equal(fresh.quiet, 2);
});

test('收回一步恢復盤面、輪到誰與被吃的子；存檔可以接著玩', () => {
    const game = createCheckers();
    const random = seeded(5);
    for (let k = 0; k < 30 && game.status === 'playing'; k++) {
        game.play(game.moves[Math.floor(random() * game.moves.length)]);
    }
    const saved = JSON.parse(JSON.stringify(game.toJSON()));
    const restored = createCheckers({ state: saved });
    assert.deepEqual(restored.board, game.board);
    assert.equal(restored.turn, game.turn);
    assert.equal(restored.history.length, game.history.length);

    const before = [...game.board];
    const turn = game.turn;
    const move = game.moves[0];
    game.play(move);
    const undone = game.undo();
    assert.deepEqual(undone.path, move.path);
    assert.deepEqual(game.board, before);
    assert.equal(game.turn, turn);
    while (game.undo());
    assert.deepEqual(game.board, startBoard());
    assert.equal(game.turn, 'r');
    assert.equal(game.undo(), null);

    // 指定盤面的存檔也要帶著盤面
    const custom = createCheckers({ board: place({ c3: 'r', d4: 'b', a7: 'b' }) });
    custom.play([at('c3'), at('e5')]);
    const again = createCheckers({ state: JSON.parse(JSON.stringify(custom.toJSON())) });
    assert.deepEqual(again.board, custom.board);
    assert.throws(() => createCheckers({ state: { moves: [[at('a3'), at('a4')]] } }));
    assert.throws(() => createCheckers({ state: { board: [1, 2], moves: [] } }));
});

test('評分：多一子的一方分數比較高，雙方角度相反', () => {
    const b = startBoard();
    assert.equal(evaluate(b, 'r') + evaluate(b, 'b'), 0);
    const extra = [...b];
    extra[at('b6')] = null;
    assert.ok(evaluate(extra, 'r') > 50);
});

test('電腦：只有一步時直接走；能連吃兩子時不會只吃一子；沒有步時回傳 null', () => {
    const forced = place({ c3: 'r', d4: 'b', a7: 'b' });
    for (const level of ['easy', 'normal', 'hard']) assert.equal(notation(chooseMove(forced, 'r', level)), 'c3xe5');

    const branch = place({ a3: 'r', c3: 'r', b4: 'b', d4: 'b', f6: 'b', h8: 'b' });
    for (const level of ['normal', 'hard']) {
        for (let seed = 1; seed <= 3; seed++) {
            const move = chooseMove(branch, 'r', level, { random: seeded(seed) });
            assert.equal(notation(move), 'c3xe5xg7', level);
        }
    }
    assert.equal(chooseMove(place({ h8: 'b' }), 'r'), null);
});

test('電腦：Normal / Hard 不會白白送子', () => {
    // 紅 c3 走 d4 會被 e5 吃回
    const b = place({ c3: 'r', e1: 'r', e5: 'b', h8: 'b' });
    for (const level of ['normal', 'hard']) {
        for (let seed = 1; seed <= 5; seed++) {
            const move = chooseMove(b, 'r', level, { random: seeded(seed) });
            assert.notEqual(notation(move), 'c3-d4', level);
        }
    }
});

test('電腦：看得出送一子換兩子的戰術', () => {
    // 紅 c3-d4 送子：黑只能用 e5 吃到 c3（e3 擋住 c5 的吃法、a1 擋住黑接著連跳），紅 b2 再連吃兩子，黑子全滅
    const b = place({ c3: 'r', b2: 'r', a1: 'r', e3: 'r', c5: 'b', e5: 'b' });
    for (const level of ['normal', 'hard']) {
        const move = chooseMove(b, 'r', level, { random: seeded(4) });
        assert.equal(notation(move), 'c3-d4', level);
    }
});

test('各難度對下：Hard 贏 Easy、Normal 贏 Easy，而且每一步都很快', () => {
    const play = (red, black, seed) => {
        const random = seeded(seed);
        const game = createCheckers();
        let slowest = 0;
        while (game.status === 'playing') {
            const level = game.turn === 'r' ? red : black;
            const t = performance.now();
            const move = chooseMove(game.board, game.turn, level, { random });
            slowest = Math.max(slowest, performance.now() - t);
            game.play(move);
        }
        return { winner: game.winner, slowest };
    };
    let hardWins = 0;
    let normalWins = 0;
    let slowest = 0;
    for (let seed = 1; seed <= 4; seed++) {
        const red = seed % 2 === 1;
        const a = play(red ? 'hard' : 'easy', red ? 'easy' : 'hard', seed);
        if (a.winner === (red ? 'r' : 'b')) hardWins++;
        const b = play(red ? 'normal' : 'easy', red ? 'easy' : 'normal', seed + 10);
        if (b.winner === (red ? 'r' : 'b')) normalWins++;
        slowest = Math.max(slowest, a.slowest, b.slowest);
    }
    assert.ok(hardWins >= 3, `hard won ${hardWins}/4`);
    assert.ok(normalWins >= 3, `normal won ${normalWins}/4`);
    // 手機大約慢 3 倍：Node 上每一步要遠低於 100 ms
    assert.ok(slowest < 150, `slowest move ${slowest.toFixed(1)} ms`);
});

test('Hard 贏 Normal 的局數比較多', () => {
    let hard = 0;
    let normal = 0;
    for (let seed = 1; seed <= 4; seed++) {
        const random = seeded(seed + 20);
        const hardSide = seed % 2 ? 'r' : 'b';
        const game = createCheckers();
        while (game.status === 'playing') {
            game.play(chooseMove(game.board, game.turn, game.turn === hardSide ? 'hard' : 'normal', { random }));
        }
        if (game.winner === hardSide) hard++;
        else if (game.winner) normal++;
    }
    assert.ok(hard > normal, `hard ${hard}, normal ${normal}`);
});
