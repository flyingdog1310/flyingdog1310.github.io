import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CENTER,
    N,
    SIZE,
    SCORE,
    WINDOWS,
    candidates,
    cellName,
    chooseMove,
    createGomoku,
    findVcf,
    findVct,
    fivePoints,
    indexOf,
    lineAt,
    rateCell,
    winnerOf,
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

// 只畫出盤面中間的一塊：rows 是從 (top, left) 開始的幾列字串（'.BW'），其他格子是空的
function board(rows, top = 4, left = 4) {
    const cells = Array(SIZE).fill(null);
    rows.forEach((row, r) =>
        [...row].forEach((ch, c) => {
            if (ch !== '.') cells[indexOf(top + r, left + c)] = ch;
        })
    );
    return cells;
}
const at = (r, c) => indexOf(r, c);

test('座標名稱：A–O 由左到右、1–15 由下到上，中央是 H8', () => {
    assert.equal(cellName(CENTER), 'H8');
    assert.equal(cellName(0), 'A15');
    assert.equal(cellName(SIZE - 1), 'O1');
    assert.equal(cellName(at(14, 0)), 'A1');
});

test('572 個五格窗；四個方向都能判定連五，長連也算贏', () => {
    assert.equal(WINDOWS.length, 572);
    const cases = [
        ['BBBBB'],
        ['B', 'B', 'B', 'B', 'B'],
        ['B....', '.B...', '..B..', '...B.', '....B'],
        ['....W', '...W.', '..W..', '.W...', 'W....'],
    ];
    for (const rows of cases) {
        const win = winnerOf(board(rows));
        assert.ok(win, rows.join('/'));
        assert.equal(win.cells.length, 5);
        assert.equal(win.lines.length, 1);
    }
    assert.equal(winnerOf(board(cases[3])).mark, 'W');
    // 長連：六子也贏，連線包含全部六子
    const six = winnerOf(board(['BBBBBB'], 0, 0));
    assert.deepEqual(six.cells, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(six.lines, [[0, 5]]);
    assert.equal(winnerOf(board(['BBBB.B'])), null);
    assert.equal(winnerOf(board(['BBBBW'])), null);
    assert.equal(winnerOf(Array(SIZE).fill(null)), null);
});

test('連線不會跨過盤邊接到下一列', () => {
    const cells = Array(SIZE).fill(null);
    for (const i of [12, 13, 14, 15, 16]) cells[i] = 'B';
    assert.equal(winnerOf(cells), null);
});

test('一步同時連成兩條五：兩條都回傳', () => {
    const cells = board(['BBBB.', '....B', '....B', '....B', '....B'], 0, 0);
    cells[at(0, 4)] = 'B';
    const { cells: line, lines } = lineAt(cells, at(0, 4));
    assert.equal(lines.length, 2);
    assert.equal(line.length, 9);
});

test('一局：黑先、輪流下，不能下在有棋子的地方，連五結束後不能再下', () => {
    const game = createGomoku();
    assert.equal(game.turn, 'B');
    assert.deepEqual(game.play(CENTER), { index: CENTER, mark: 'B' });
    assert.equal(game.turn, 'W');
    assert.equal(game.play(CENTER), null);
    assert.equal(game.play(-1), null);
    assert.equal(game.play(SIZE), null);
    assert.equal(game.play(1.5), null);
    // 黑在第 7 列連成五，白在第 8 列
    for (let k = 1; k < 4; k++) {
        game.play(at(8, 7 + k));
        game.play(at(7, 7 + k));
    }
    game.play(at(8, 4));
    const result = game.play(at(7, 6));
    assert.equal(result.mark, 'B');
    assert.deepEqual(result.won.cells, [at(7, 6), at(7, 7), at(7, 8), at(7, 9), at(7, 10)]);
    assert.equal(game.status, 'won');
    assert.equal(game.play(at(0, 0)), null);
    assert.equal(game.lastIndex(), at(7, 6));
});

test('收回：回到上一步的盤面與輪到的一方，結束的局收回後可以繼續', () => {
    const game = createGomoku();
    assert.equal(game.undo(), null);
    for (let k = 0; k < 4; k++) {
        game.play(at(0, k));
        game.play(at(1, k));
    }
    game.play(at(0, 4));
    assert.equal(game.status, 'won');
    assert.deepEqual(game.undo(), { index: at(0, 4), mark: 'B' });
    assert.equal(game.status, 'playing');
    assert.equal(game.winner, null);
    assert.equal(game.turn, 'B');
    assert.equal(game.board[at(0, 4)], null);
    assert.equal(game.lastIndex(), at(1, 3));
});

test('存檔：toJSON 還原後局面相同；不合法的存檔丟出錯誤', () => {
    const game = createGomoku();
    for (const i of [CENTER, CENTER + 1, CENTER + N, 0]) game.play(i);
    const restored = createGomoku({ state: JSON.parse(JSON.stringify(game.toJSON())) });
    assert.deepEqual(restored.board, game.board);
    assert.equal(restored.turn, game.turn);
    assert.throws(() => createGomoku({ state: { moves: [1, 1] } }));
    assert.throws(() => createGomoku({ state: {} }));
});

test('下滿盤面沒有人連五是和局', () => {
    // (r + 2c) mod 4 分黑白：橫向黑白交錯，直向與兩個斜向都是兩子一組，不會連五
    const order = [];
    const marks = Array(SIZE).fill(null);
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) marks[at(r, c)] = (r + 2 * c) % 4 < 2 ? 'B' : 'W';
    }
    assert.equal(winnerOf(marks), null);
    const blacks = marks.flatMap((m, i) => (m === 'B' ? [i] : []));
    const whites = marks.flatMap((m, i) => (m === 'W' ? [i] : []));
    // 黑比白多一子；照順序交錯下
    assert.equal(blacks.length, whites.length + 1);
    blacks.forEach((b, k) => order.push(b, ...(k < whites.length ? [whites[k]] : [])));
    const game = createGomoku({ state: { moves: order } });
    assert.equal(game.status, 'draw');
    assert.equal(chooseMove(game.board, 'W'), null);
});

test('候選格：空盤面只有天元，之後是棋子周圍兩格以內的空格', () => {
    assert.deepEqual(candidates(Array(SIZE).fill(null)), [CENTER]);
    const cells = Array(SIZE).fill(null);
    cells[CENTER] = 'B';
    assert.equal(candidates(cells).length, 24);
    cells[0] = 'W';
    assert.equal(candidates(cells).length, 24 + 8);
});

test('棋型評分：連五 > 活四 > 四三 > 雙活三 > 活三、衝四 > 眠三', () => {
    // 黑下在 (7, 7) 的價值；rows 從 (7, 3) 開始畫
    const rate = (rows) => rateCell(board(rows, 7, 3), at(7, 7), 'B');
    assert.equal(rate(['BBBB.']), SCORE.FIVE);
    assert.equal(rate(['.BBB..']), SCORE.OPEN_FOUR);
    // 同一條線上兩個連五點（B.BB_.B）也擋不住
    assert.equal(rate(['B.BB..B']), SCORE.OPEN_FOUR);
    assert.ok(rate(['WBBB..']) < SCORE.OPEN_FOUR);
    assert.ok(rate(['WBBB..']) >= SCORE.FOUR);
    assert.ok(rate(['..BB..']) >= SCORE.OPEN_THREE);
    // 被擋住一邊的三只是眠三
    assert.ok(rate(['.WBB..']) < SCORE.FOUR);
    assert.ok(rate(['.WBB..']) >= SCORE.THREE);
    // 兩邊空間不夠連成五：連眠三都不算
    assert.ok(rate(['W.BB.W']) < SCORE.THREE);
    // 四三：橫的衝四 + 直的活三
    const fourThree = board(['WBBB'], 7, 3);
    fourThree[at(5, 7)] = 'B';
    fourThree[at(6, 7)] = 'B';
    assert.equal(rateCell(fourThree, at(7, 7), 'B'), SCORE.FOUR_THREE);
    // 雙四（兩條都被擋一邊）也是必勝
    fourThree[at(4, 7)] = 'B';
    fourThree[at(3, 7)] = 'W';
    assert.equal(rateCell(fourThree, at(7, 7), 'B'), SCORE.OPEN_FOUR);
    // 雙活三
    const double = Array(SIZE).fill(null);
    for (const i of [at(7, 5), at(7, 6), at(5, 7), at(6, 7)]) double[i] = 'B';
    assert.equal(rateCell(double, at(7, 7), 'B'), SCORE.DOUBLE_THREE);
});

test('連五點：只算對方沒擋住的窗', () => {
    assert.deepEqual(fivePoints(board(['.BBBB.'], 7, 3), 'B').sort((a, b) => a - b), [at(7, 3), at(7, 8)]);
    assert.deepEqual(fivePoints(board(['WBBBB.'], 7, 3), 'B'), [at(7, 8)]);
    assert.deepEqual(fivePoints(board(['BB.BB'], 7, 3), 'B'), [at(7, 5)]);
    assert.deepEqual(fivePoints(board(['.BBB..'], 7, 3), 'B'), []);
});

// 橫、直各有三子且各被擋住一端，交會點 (7, 7) 空著：下在交會點就是雙四
function cross() {
    const cells = Array(SIZE).fill(null);
    for (const i of [at(7, 4), at(7, 5), at(7, 6), at(4, 7), at(5, 7), at(6, 7)]) cells[i] = 'B';
    for (const i of [at(7, 3), at(3, 7), at(12, 2), at(12, 6), at(1, 13)]) cells[i] = 'W';
    return cells;
}

// 跳四 + 斜線的四：黑下在 (7, 8) 同時形成橫的跳四（連五點在 (7, 7)）與斜的四
function splitFour() {
    const cells = Array(SIZE).fill(null);
    for (const i of [at(7, 4), at(7, 5), at(7, 6), at(4, 11), at(5, 10), at(6, 9)]) cells[i] = 'B';
    for (const i of [at(7, 3), at(3, 12), at(4, 8), at(5, 8), at(0, 0), at(0, 2)]) cells[i] = 'W';
    return cells;
}

test('連續衝四必勝（VCF）：照著走、對方每次只能擋，最後一定連五', () => {
    for (const make of [cross, splitFour]) {
        const work = make();
        assert.notEqual(findVcf(work, 'B'), -1);
        let turn = 'B';
        for (let guard = 0; !winnerOf(work) && guard < 30; guard++) {
            if (turn === 'B') {
                const fives = fivePoints(work, 'B');
                const move = fives.length ? fives[0] : findVcf(work, 'B');
                assert.notEqual(move, -1);
                work[move] = 'B';
            } else {
                const block = fivePoints(work, 'B');
                assert.ok(block.length >= 1, '黑每一步都是四');
                work[block[0]] = 'W';
            }
            turn = turn === 'B' ? 'W' : 'B';
        }
        assert.equal(winnerOf(work)?.mark, 'B');
    }
    // 被擋住一端的三：衝四之後就被擋死，沒有 VCF
    assert.equal(findVcf(board(['WBBB..'], 7, 3), 'B'), -1);
    // 活三本身就是 VCF：下成活四
    assert.notEqual(findVcf(board(['.BBB..'], 7, 3), 'B'), -1);
    // 對方已經有四：我的衝四不算數
    const blocked = cross();
    for (const i of [at(0, 0), at(0, 1), at(0, 2), at(0, 3)]) blocked[i] = 'W';
    assert.equal(findVcf(blocked, 'B'), -1);
});

test('活三與衝四交替的必勝（VCT）：雙活三找得到，VCF 找不到', () => {
    const cells = Array(SIZE).fill(null);
    for (const i of [at(7, 5), at(7, 6), at(5, 7), at(6, 7)]) cells[i] = 'B';
    for (const i of [at(0, 0), at(0, 14), at(14, 0), at(14, 14)]) cells[i] = 'W';
    assert.equal(findVcf(cells, 'B'), -1);
    assert.notEqual(findVct(cells, 'B'), -1);
    // 白有四可以衝時，黑的活三不算先手
    for (const i of [at(10, 2), at(10, 3), at(10, 4)]) cells[i] = 'W';
    cells[at(10, 1)] = 'B';
    assert.equal(findVct(cells, 'B'), -1);
    // 兩子而已：沒有必勝
    assert.equal(findVct(board(['..BB..'], 7, 3), 'B'), -1);
});

test('電腦：空盤面下天元；能連五就連五、對方要連五一定擋（normal / hard）', () => {
    for (const level of ['normal', 'hard']) {
        assert.equal(chooseMove(Array(SIZE).fill(null), 'B', level, seeded(1)), CENTER);
        // 白有活三（會被黑擋），但黑自己能連五
        const win = board(['.BBBB.', '..WWW.'], 7, 3);
        assert.ok([at(7, 3), at(7, 8)].includes(chooseMove(win, 'B', level, seeded(2))));
        // 白有衝四：黑一定要擋
        const block = board(['WWWW.', '.B.B.', 'B....'], 7, 3);
        block[at(7, 2)] = 'B';
        assert.equal(chooseMove(block, 'B', level, seeded(3)), at(7, 7));
    }
});

test('電腦：對方的活三要擋在兩端之一；自己能做活四時先做活四', () => {
    for (const level of ['normal', 'hard']) {
        for (let seed = 1; seed <= 5; seed++) {
            const cells = board(['.WWW..', '......', '.B.B..'], 7, 3);
            const move = chooseMove(cells, 'B', level, seeded(seed));
            assert.ok([at(7, 3), at(7, 7), at(7, 8)].includes(move), `${level} 下在 ${cellName(move)}`);
        }
        const attack = board(['.WWW..', '......', '..BBB.', '...W..'], 7, 3);
        attack[at(0, 0)] = 'W';
        const move = chooseMove(attack, 'B', level, seeded(1));
        assert.ok([at(9, 4), at(9, 8)].includes(move), `${level} 下在 ${cellName(move)}`);
    }
});

test('hard 會走連續衝四的必勝；輪到對方時會擋掉', () => {
    for (const make of [cross, splitFour]) {
        const cells = make();
        assert.equal(chooseMove(cells, 'B', 'hard', seeded(1)), findVcf(cells, 'B'));
        // 同一個盤面輪到白：白下完之後黑不能再有 VCF
        const reply = chooseMove(cells, 'W', 'hard', seeded(1));
        cells[reply] = 'W';
        assert.equal(findVcf(cells, 'B'), -1, `白下在 ${cellName(reply)}`);
    }
});

test('電腦對下：hard 勝過 normal、normal 勝過 easy；hard 每步都很快', () => {
    const play = (black, white, seed) => {
        const random = seeded(seed);
        const game = createGomoku();
        let slowest = 0;
        while (game.status === 'playing') {
            const start = performance.now();
            const move = chooseMove(game.board, game.turn, game.turn === 'B' ? black : white, random);
            slowest = Math.max(slowest, performance.now() - start);
            assert.ok(game.play(move));
        }
        return { winner: game.winner?.mark ?? null, slowest };
    };
    // 兩邊都會擋活三，下滿和局不少；hard 要贏得比輸得多
    let hardWins = 0;
    let hardLosses = 0;
    let normalWins = 0;
    let slowest = 0;
    for (let seed = 1; seed <= 6; seed++) {
        for (const [black, white] of [
            ['hard', 'normal'],
            ['normal', 'hard'],
        ]) {
            const result = play(black, white, seed);
            slowest = Math.max(slowest, result.slowest);
            const hard = black === 'hard' ? 'B' : 'W';
            if (result.winner === hard) hardWins++;
            else if (result.winner) hardLosses++;
        }
        if (seed > 3) continue;
        for (const [black, white] of [
            ['normal', 'easy'],
            ['easy', 'normal'],
        ]) {
            const result = play(black, white, seed);
            if (result.winner === (black === 'normal' ? 'B' : 'W')) normalWins++;
        }
    }
    assert.ok(hardWins >= 4 && hardLosses <= 1, `hard 贏 ${hardWins}、輸 ${hardLosses} / 12`);
    assert.ok(normalWins >= 5, `normal 贏 ${normalWins} / 6`);
    assert.ok(slowest < 100, `最慢一步 ${slowest.toFixed(1)} ms`);
});
