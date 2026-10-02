import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, PEERS, countSolutions, createSudoku, generate, grade, solve } from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

const parse = (text) => [...text.replace(/\s/g, '')].map((ch) => (ch === '.' ? 0 : Number(ch)));

// 只靠唯一候選數 / 唯一位置就能解的題目，答案在 SOLUTION
const PUZZLE = parse(`
    53..7....
    6..195...
    .98....6.
    8...6...3
    4..8.3..1
    7...2...6
    .6....28.
    ...419..5
    ....8..79
`);
const SOLUTION = parse(`
    534678912
    672195348
    198342567
    859761423
    426853791
    713924856
    961537284
    287419635
    345286179
`);

// 有效的完整盤面：每一列、行、宮都是 1–9
function isValidSolution(grid) {
    return grid.every((v, i) => v >= 1 && v <= 9 && PEERS[i].every((p) => grid[p] !== v));
}

test('解題與計算解的數量', () => {
    assert.deepEqual(solve(PUZZLE), SOLUTION);
    assert.equal(countSolutions(PUZZLE), 1);
    // 空盤有很多解，數到上限就停
    assert.equal(countSolutions(new Array(81).fill(0), 2), 2);
    // 題目本身有重複數字：無解
    const broken = PUZZLE.slice();
    broken[2] = 5;
    assert.equal(countSolutions(broken), 0);
    assert.equal(solve(broken), null);
});

test('出題：唯一解、提示對稱、提示數與難度符合設定', () => {
    for (const [name, level] of Object.entries(LEVELS)) {
        for (let seed = 1; seed <= 6; seed++) {
            const { puzzle, solution } = generate(level, seeded(seed * 31));
            assert.ok(isValidSolution(solution), `${name} 終盤`);
            assert.ok(
                puzzle.every((v, i) => v === 0 || v === solution[i]),
                `${name} 提示與答案一致`
            );
            assert.equal(countSolutions(puzzle), 1, `${name} 唯一解`);
            assert.ok(
                puzzle.every((v, i) => Boolean(v) === Boolean(puzzle[80 - i])),
                `${name} 對稱`
            );
            const clues = puzzle.filter(Boolean).length;
            assert.ok(clues >= level.clues, `${name} 提示數 ${clues}`);
            assert.equal(grade(puzzle), level.grade, `${name} 難度`);
        }
    }
    // 簡單的提示比較多
    const easy = generate(LEVELS.easy, seeded(3)).puzzle.filter(Boolean).length;
    const hard = generate(LEVELS.hard, seeded(3)).puzzle.filter(Boolean).length;
    assert.ok(easy > hard);
});

test('同一個種子產生同一題', () => {
    const a = createSudoku({ level: 'medium', random: seeded(7) });
    const b = createSudoku({ level: 'medium', random: seeded(7) });
    assert.deepEqual(a.toJSON(), b.toJSON());
});

test('難度評等', () => {
    assert.equal(grade(PUZZLE), 0);
    // 需要區塊排除 / 數對的題目，以及更難的題目（Arto Inkala）
    const hard = generate(LEVELS.hard, seeded(11)).puzzle;
    assert.equal(grade(hard), 1);
    const inkala = parse(`
        8........
        ..36.....
        .7..9.2..
        .5...7...
        ....457..
        ...1...3.
        ..1....68
        ..85...1.
        .9....4..
    `);
    assert.equal(grade(inkala), 2);
});

test('提示格不能改，空格可以填數字與清除', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    assert.equal(game.isGiven(0), true);
    assert.equal(game.setValue(0, 1), null);
    assert.equal(game.erase(0), null);
    assert.equal(game.toggleNote(0, 1), null);

    const result = game.setValue(2, 4);
    assert.equal(result.index, 2);
    assert.equal(result.value, 4);
    assert.equal(game.values[2], 4);
    // 填同一個數字等於清除
    assert.equal(game.setValue(2, 4).value, 0);
    assert.equal(game.values[2], 0);
    assert.equal(game.erase(2), null);
    assert.equal(game.setValue(2, 0), null);
    assert.equal(game.setValue(2, 10), null);
});

test('衝突：同列、同行、同宮的重複數字', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    assert.equal(game.conflicts().size, 0);
    // 第 1 列已經有 5（索引 0）
    game.setValue(2, 5);
    assert.deepEqual([...game.conflicts()].sort((a, b) => a - b), [0, 2]);
    // 第 3 欄已經有 8（索引 20），同宮也有 8（索引 19 是 9、索引 20 是 8）
    game.setValue(2, 8);
    assert.deepEqual([...game.conflicts()].sort((a, b) => a - b), [2, 20]);
    game.erase(2);
    assert.equal(game.conflicts().size, 0);
});

test('筆記：切換、填數字時同步移除同列 / 行 / 宮的筆記', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    game.toggleNote(2, 1);
    game.toggleNote(2, 4);
    game.toggleNote(2, 2);
    assert.deepEqual(game.noteDigits(2), [1, 2, 4]);
    assert.deepEqual(game.toggleNote(2, 2).notes, [1, 4]);
    // 同列的另一格與不相關的格子
    game.toggleNote(3, 4);
    game.toggleNote(72, 4);
    const result = game.setValue(2, 4);
    assert.deepEqual(result.cleared, [3]);
    assert.deepEqual(game.noteDigits(2), []);
    assert.deepEqual(game.noteDigits(3), []);
    assert.deepEqual(game.noteDigits(72), [4]);
    // 有數字的格子不能寫筆記；清除先清數字，空格才清筆記
    assert.equal(game.toggleNote(2, 1), null);
    game.erase(2);
    game.toggleNote(2, 7);
    game.erase(2);
    assert.deepEqual(game.noteDigits(2), []);
});

test('復原：數字、筆記與被同步移除的筆記一起還原', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    assert.equal(game.canUndo(), false);
    assert.equal(game.undo(), null);
    game.toggleNote(3, 4);
    game.setValue(2, 4);
    assert.deepEqual(game.undo().sort(), [2, 3]);
    assert.equal(game.values[2], 0);
    assert.deepEqual(game.noteDigits(3), [4]);
    assert.deepEqual(game.undo(), [3]);
    assert.deepEqual(game.noteDigits(3), []);
    assert.equal(game.canUndo(), false);
});

test('完成一列 / 行 / 宮', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    // 第 1 列剩下的格子
    const row = [2, 3, 5, 6, 7, 8];
    for (const i of row.slice(0, -1)) assert.deepEqual(Object.keys(game.setValue(i, SOLUTION[i]).completed), []);
    const last = game.setValue(8, SOLUTION[8]);
    assert.deepEqual(Object.keys(last.completed), ['row']);
    assert.deepEqual(last.completed.row, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // 填錯的數字不算完成
    const other = createSudoku({ puzzle: PUZZLE });
    for (const i of row.slice(0, -1)) other.setValue(i, SOLUTION[i]);
    assert.deepEqual(other.setValue(8, 9).completed, {});
});

test('填完正確答案就獲勝，之後不能再改', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    const empty = PUZZLE.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    // 先填錯一格，填滿時不算贏
    game.setValue(empty[0], SOLUTION[empty[0]] === 1 ? 2 : 1);
    let result;
    for (const i of empty.slice(1)) result = game.setValue(i, SOLUTION[i]);
    assert.equal(result.won, false);
    assert.equal(game.status, 'playing');
    result = game.setValue(empty[0], SOLUTION[empty[0]]);
    assert.equal(result.won, true);
    assert.equal(game.status, 'won');
    assert.equal(game.setValue(empty[1], 1), null);
    assert.equal(game.undo(), null);
    assert.equal(game.hasProgress(), false);
});

test('提示：填入答案、優先修正填錯的格子、選最容易推出的空格', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    // 選取的空格
    assert.equal(game.hintTarget(2), 2);
    const result = game.hint(2);
    assert.equal(result.hint, true);
    assert.equal(game.values[2], SOLUTION[2]);
    assert.equal(game.hintsUsed, 1);
    // 已經正確的格子不能再提示；改找其他格
    assert.equal(game.hint(2), null);
    const target = game.hintTarget(2);
    assert.notEqual(target, 2);
    assert.equal(game.values[target], 0);
    // 有填錯的格子時先修正它
    game.setValue(3, SOLUTION[3] === 1 ? 2 : 1);
    assert.equal(game.hintTarget(0), 3);
    game.hint(3);
    assert.equal(game.values[3], SOLUTION[3]);
    assert.equal(game.hintsUsed, 2);
});

test('數字計數與進度', () => {
    const game = createSudoku({ puzzle: PUZZLE });
    assert.equal(game.givenCount(), 30);
    assert.equal(game.hasProgress(), false);
    game.toggleNote(2, 1);
    assert.equal(game.hasProgress(), false);
    game.setValue(2, 4);
    assert.equal(game.hasProgress(), true);
    const counts = game.counts();
    assert.equal(counts[4], PUZZLE.filter((v) => v === 4).length + 1);
    assert.equal(game.filledCount(), 31);
});

test('存檔後可以接著玩（含筆記、復原紀錄、提示次數）', () => {
    const game = createSudoku({ level: 'hard', random: seeded(5) });
    const empty = game.values.findIndex((v) => v === 0);
    game.toggleNote(empty, 3);
    const other = game.values.findIndex((v, i) => v === 0 && i !== empty);
    game.hint(other);
    const saved = JSON.parse(JSON.stringify(game.toJSON()));

    const restored = createSudoku({ state: saved });
    assert.equal(restored.level, 'hard');
    assert.deepEqual(restored.values, game.values);
    assert.deepEqual(restored.noteDigits(empty), [3]);
    assert.equal(restored.hintsUsed, 1);
    assert.equal(restored.isGiven(other), false);
    assert.deepEqual(restored.undo(), [other]);
    assert.equal(restored.values[other], 0);
});
