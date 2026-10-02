// 數獨的遊戲規則（純邏輯，不碰 DOM）
// 盤面是 81 格的陣列（列優先），值 0 代表空格；筆記是每格一個 9 bit 的遮罩（bit d-1 代表數字 d）

// clues：目標提示數（挖到這個數量就停；挖不到時停在能維持唯一解的最少數量）
// grade：需要的解題技巧（見 grade()），簡單難度不需要猜也不需要進階技巧
export const LEVELS = {
    easy: { clues: 40, grade: 0 },
    medium: { clues: 32, grade: 0 },
    hard: { clues: 26, grade: 1 },
    expert: { clues: 22, grade: 2 },
};

const ALL = 0x1ff;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const HISTORY_LIMIT = 500;

// ---------- 格子關係 ----------

export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

// 27 個單位（9 列、9 行、9 宮），每個是 9 個格子的索引
const UNITS = [];
for (let k = 0; k < 9; k++) {
    UNITS.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
    UNITS.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
    const r0 = Math.floor(k / 3) * 3;
    const c0 = (k % 3) * 3;
    UNITS.push(Array.from({ length: 9 }, (_, j) => (r0 + Math.floor(j / 3)) * 9 + c0 + (j % 3)));
}

// 每格的 20 個同列 / 同行 / 同宮的格子
export const PEERS = Array.from({ length: 81 }, (_, i) => {
    const peers = [];
    for (let j = 0; j < 81; j++) {
        if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) peers.push(j);
    }
    return peers;
});

const bit = (d) => 1 << (d - 1);
const popcount = (m) => {
    let n = 0;
    for (; m; m &= m - 1) n++;
    return n;
};
const digitsOf = (mask) => {
    const result = [];
    for (let d = 1; d <= 9; d++) if (mask & bit(d)) result.push(d);
    return result;
};

function candidates(grid, i) {
    let used = 0;
    for (const p of PEERS[i]) if (grid[p]) used |= bit(grid[p]);
    return ALL & ~used;
}

// ---------- 解題 ----------

// 回傳解的數量（數到 limit 就停）；fill 為 true 時把第一個解寫回 grid
// random：每一步打亂候選數字的嘗試順序（產生隨機終盤用）
function search(grid, { limit = 2, fill = false, random = null } = {}) {
    const rows = new Array(9).fill(0);
    const cols = new Array(9).fill(0);
    const boxes = new Array(9).fill(0);
    const empty = [];
    for (let i = 0; i < 81; i++) {
        const d = grid[i];
        if (!d) {
            empty.push(i);
            continue;
        }
        const b = bit(d);
        // 題目本身就有重複數字：無解
        if ((rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]) & b) return 0;
        rows[rowOf(i)] |= b;
        cols[colOf(i)] |= b;
        boxes[boxOf(i)] |= b;
    }

    let count = 0;
    let solved = null;
    const work = grid.slice();

    function step(remaining) {
        if (remaining === 0) {
            count++;
            if (fill && !solved) solved = work.slice();
            return count >= limit;
        }
        // 先填候選數最少的格子
        let best = -1;
        let bestMask = 0;
        let bestCount = 10;
        for (const i of empty) {
            if (work[i]) continue;
            const mask = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
            const n = popcount(mask);
            if (n < bestCount) {
                best = i;
                bestMask = mask;
                bestCount = n;
                if (n <= 1) break;
            }
        }
        if (bestCount === 0) return false;
        const r = rowOf(best);
        const c = colOf(best);
        const x = boxOf(best);
        const order = random ? shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], random) : DIGITS;
        for (const d of order) {
            const b = bit(d);
            if (!(bestMask & b)) continue;
            work[best] = d;
            rows[r] |= b;
            cols[c] |= b;
            boxes[x] |= b;
            const done = step(remaining - 1);
            work[best] = 0;
            rows[r] &= ~b;
            cols[c] &= ~b;
            boxes[x] &= ~b;
            if (done) return true;
        }
        return false;
    }

    step(empty.length);
    if (fill && solved) for (let i = 0; i < 81; i++) grid[i] = solved[i];
    return count;
}

export const countSolutions = (grid, limit = 2) => search(grid, { limit });

export function solve(grid) {
    const result = grid.slice();
    return search(result, { limit: 1, fill: true }) ? result : null;
}

// ---------- 評等：模擬人用技巧解題 ----------

// 0：只靠唯一候選數 / 唯一位置就能解完
// 1：還需要區塊排除（pointing / claiming）與數對（naked pair）
// 2：以上都解不完，需要更進階的技巧
function solveLogically(grid, maxGrade) {
    const values = grid.slice();
    const cand = values.map((v, i) => (v ? 0 : candidates(values, i)));

    function place(i, d) {
        values[i] = d;
        cand[i] = 0;
        for (const p of PEERS[i]) cand[p] &= ~bit(d);
    }

    function singles() {
        let progress = false;
        for (let i = 0; i < 81; i++) {
            if (!values[i] && popcount(cand[i]) === 1) {
                place(i, digitsOf(cand[i])[0]);
                progress = true;
            }
        }
        for (const unit of UNITS) {
            for (const d of DIGITS) {
                const spots = unit.filter((i) => cand[i] & bit(d));
                if (spots.length === 1) {
                    place(spots[0], d);
                    progress = true;
                }
            }
        }
        return progress;
    }

    // 某數字在一個單位裡的候選格全部落在另一個單位（宮 ∩ 列 / 行）時，另一個單位的其他格不能是這個數字
    function lockedCandidates() {
        let progress = false;
        for (const unit of UNITS) {
            for (const d of DIGITS) {
                const b = bit(d);
                const spots = unit.filter((i) => cand[i] & b);
                if (spots.length < 2) continue;
                for (const key of [rowOf, colOf, boxOf]) {
                    const k = key(spots[0]);
                    if (!spots.every((i) => key(i) === k)) continue;
                    for (let j = 0; j < 81; j++) {
                        if (key(j) === k && cand[j] & b && !unit.includes(j)) {
                            cand[j] &= ~b;
                            progress = true;
                        }
                    }
                }
            }
        }
        return progress;
    }

    // 同一單位裡兩格的候選數都是同樣兩個數字，其他格就不能是這兩個數字
    function nakedPairs() {
        let progress = false;
        for (const unit of UNITS) {
            const pairs = unit.filter((i) => popcount(cand[i]) === 2);
            for (let a = 0; a < pairs.length; a++) {
                for (let b = a + 1; b < pairs.length; b++) {
                    const mask = cand[pairs[a]];
                    if (cand[pairs[b]] !== mask) continue;
                    for (const i of unit) {
                        if (i !== pairs[a] && i !== pairs[b] && cand[i] & mask) {
                            cand[i] &= ~mask;
                            progress = true;
                        }
                    }
                }
            }
        }
        return progress;
    }

    for (;;) {
        if (singles()) continue;
        if (maxGrade >= 1 && (lockedCandidates() || nakedPairs())) continue;
        break;
    }
    return values.every(Boolean);
}

export function grade(grid) {
    if (solveLogically(grid, 0)) return 0;
    if (solveLogically(grid, 1)) return 1;
    return 2;
}

// ---------- 出題 ----------

function shuffle(list, random) {
    for (let k = list.length - 1; k > 0; k--) {
        const j = Math.floor(random() * (k + 1));
        [list[k], list[j]] = [list[j], list[k]];
    }
    return list;
}

const MAX_TRIES = 40;

// 從隨機終盤挖洞：每次挖對中心點對稱的一對，挖完仍是唯一解、且難度不超過 maxGrade 才保留
function dig(clues, maxGrade, random) {
    const solution = new Array(81).fill(0);
    search(solution, { limit: 1, fill: true, random });
    const puzzle = solution.slice();
    let count = 81;
    const order = shuffle(
        Array.from({ length: 41 }, (_, i) => i),
        random
    );
    for (const i of order) {
        const pair = i === 40 ? [40] : [i, 80 - i];
        if (count - pair.length < clues) continue;
        for (const j of pair) puzzle[j] = 0;
        if (countSolutions(puzzle) === 1 && (maxGrade >= 2 || solveLogically(puzzle, maxGrade))) {
            count -= pair.length;
        } else {
            for (const j of pair) puzzle[j] = solution[j];
        }
    }
    return { puzzle, solution };
}

// 回傳 { puzzle, solution }：唯一解、提示數字對中心點對稱、難度剛好是 level.grade
// 試 MAX_TRIES 次都沒有剛好的難度時，回傳最接近的一題
export function generate({ clues, grade: target }, random = Math.random) {
    let fallback = null;
    let fallbackGrade = -1;
    for (let t = 0; t < MAX_TRIES; t++) {
        const result = dig(clues, target, random);
        const g = grade(result.puzzle);
        if (g === target) return result;
        if (g > fallbackGrade) {
            fallback = result;
            fallbackGrade = g;
        }
    }
    return fallback;
}

// ---------- 遊戲 ----------

// level：LEVELS 的名稱；state：toJSON() 存下來的進行中局面（接著玩）；puzzle：指定題目（測試用，會自動解出答案）
export function createSudoku({ level = 'easy', random = Math.random, state = null, puzzle = null } = {}) {
    let given;
    let solution;
    let values;
    let notes;
    let history;
    let hintsUsed;

    if (state) {
        level = state.level;
        given = [...state.puzzle].map(Number);
        solution = [...state.solution].map(Number);
        values = [...state.values].map(Number);
        notes = state.notes.slice();
        history = state.history ?? [];
        hintsUsed = state.hintsUsed ?? 0;
    } else {
        if (puzzle) {
            given = puzzle.slice();
            solution = solve(puzzle);
            if (!solution) throw new Error('題目無解');
        } else {
            ({ puzzle: given, solution } = generate(LEVELS[level], random));
        }
        values = given.slice();
        notes = new Array(81).fill(0);
        history = [];
        hintsUsed = 0;
    }

    const game = {
        level,
        solution,
        values,
        notes,
        hintsUsed,
        status: 'playing',
    };

    const isGiven = (i) => given[i] !== 0;
    const isEditable = (i) => game.status === 'playing' && !isGiven(i);

    // ---------- 查詢 ----------

    // 和同列 / 同行 / 同宮重複的格子
    function conflicts() {
        const result = new Set();
        for (let i = 0; i < 81; i++) {
            if (!values[i]) continue;
            for (const p of PEERS[i]) {
                if (values[p] === values[i]) {
                    result.add(i);
                    result.add(p);
                }
            }
        }
        return result;
    }

    // 每個數字已經填了幾格（不管對錯），給數字鍵盤顯示剩幾個
    function counts() {
        const result = new Array(10).fill(0);
        for (const v of values) result[v]++;
        return result;
    }

    const isComplete = (unit) => unit.every((i) => values[i]) && new Set(unit.map((i) => values[i])).size === 9;

    // 這一格填下去之後剛好完成的列 / 行 / 宮
    function completedAt(i) {
        const result = {};
        const units = { row: UNITS[rowOf(i) * 3], col: UNITS[colOf(i) * 3 + 1], box: UNITS[boxOf(i) * 3 + 2] };
        for (const [name, unit] of Object.entries(units)) if (isComplete(unit)) result[name] = unit;
        return result;
    }

    function checkWin() {
        // 唯一解，所以填滿且沒有衝突就等於答案
        if (values.every((v, i) => v === solution[i])) {
            game.status = 'won';
            history = [];
            return true;
        }
        return false;
    }

    // ---------- 動作 ----------

    // 一次動作會改到的格子，先存下原本的值與筆記，給復原用
    function record(indices) {
        const entry = indices.map((i) => ({ i, v: values[i], n: notes[i] }));
        history.push(entry);
        if (history.length > HISTORY_LIMIT) history.shift();
        return entry;
    }

    // 填數字（填同一個數字等於清除）
    // 結果：{ index, value, cleared: [同步移除筆記的格子], completed: { row?, col?, box? }, won }；沒有變化回傳 null
    function setValue(i, d) {
        if (!isEditable(i) || d < 1 || d > 9) return null;
        if (values[i] === d) return erase(i);
        // 同列 / 同行 / 同宮的筆記裡有這個數字的，一起移除
        const cleared = PEERS[i].filter((p) => !values[p] && notes[p] & bit(d));
        record([i, ...cleared]);
        values[i] = d;
        notes[i] = 0;
        for (const p of cleared) notes[p] &= ~bit(d);
        return { index: i, value: d, cleared, completed: completedAt(i), won: checkWin() };
    }

    // 切換筆記；已經有數字的格子不能寫筆記
    function toggleNote(i, d) {
        if (!isEditable(i) || values[i] || d < 1 || d > 9) return null;
        record([i]);
        notes[i] ^= bit(d);
        return { index: i, notes: digitsOf(notes[i]) };
    }

    // 清除數字；沒有數字時清除筆記
    function erase(i) {
        if (!isEditable(i) || (!values[i] && !notes[i])) return null;
        record([i]);
        if (values[i]) values[i] = 0;
        else notes[i] = 0;
        return { index: i, value: 0, cleared: [], completed: {}, won: false };
    }

    // 提示：填入正確答案；目標由 hintTarget 決定
    function hint(i) {
        if (!isEditable(i) || values[i] === solution[i]) return null;
        const result = setValue(i, solution[i]);
        game.hintsUsed = ++hintsUsed;
        return { ...result, hint: true };
    }

    // 提示要填哪一格：選取的格子是空的或填錯了就填它，否則找候選數最少的空格（最容易推出來的）
    function hintTarget(selected) {
        if (game.status !== 'playing') return -1;
        if (selected >= 0 && !isGiven(selected) && values[selected] !== solution[selected]) return selected;
        // 有填錯的格子先修正（不然候選數會被錯誤的數字影響）
        const wrong = values.findIndex((v, i) => v && v !== solution[i]);
        if (wrong >= 0) return wrong;
        let best = -1;
        let bestCount = 10;
        for (let i = 0; i < 81; i++) {
            if (values[i]) continue;
            const n = popcount(candidates(values, i));
            if (n < bestCount) {
                best = i;
                bestCount = n;
            }
        }
        return best;
    }

    // 復原上一步；回傳改到的格子索引，沒有可復原的回傳 null
    function undo() {
        if (game.status !== 'playing' || history.length === 0) return null;
        const entry = history.pop();
        for (const { i, v, n } of entry) {
            values[i] = v;
            notes[i] = n;
        }
        return entry.map(({ i }) => i);
    }

    const noteDigits = (i) => digitsOf(notes[i]);
    const canUndo = () => game.status === 'playing' && history.length > 0;
    // 玩家有沒有動過盤面（開新局前要不要確認）
    const hasProgress = () => game.status === 'playing' && values.some((v, i) => v && !isGiven(i));
    const filledCount = () => values.filter(Boolean).length;
    const givenCount = () => given.filter(Boolean).length;

    function toJSON() {
        return {
            level,
            puzzle: given.join(''),
            solution: solution.join(''),
            values: values.join(''),
            notes: notes.slice(),
            history,
            hintsUsed,
        };
    }

    Object.assign(game, {
        isGiven,
        isEditable,
        conflicts,
        counts,
        setValue,
        toggleNote,
        erase,
        hint,
        hintTarget,
        undo,
        canUndo,
        noteDigits,
        hasProgress,
        filledCount,
        givenCount,
        toJSON,
    });
    checkWin();
    return game;
}
