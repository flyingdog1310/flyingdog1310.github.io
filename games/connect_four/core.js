// 四子棋的遊戲規則與電腦對手（純邏輯，不碰 DOM）
// 盤面是長度 42 的陣列（列優先，0 = 左上、41 = 右下），每格 null | 'R'（紅）| 'Y'（黃）
// 棋子從上方投入，落在該行最下面的空格

export const ROWS = 6;
export const COLS = 7;
export const SIZE = ROWS * COLS;

// 電腦對手的難度：easy 常常漏看、normal 會贏會擋但只看兩三步、hard 往前算 8 步
export const LEVELS = ['easy', 'normal', 'hard'];
const DEPTH = { normal: 3, hard: 8 };

export const other = (mark) => (mark === 'R' ? 'Y' : 'R');
export const indexOf = (row, col) => row * COLS + col;

// 所有可能連成四子的位置（橫、直、兩個斜向，共 69 組）
export const WINDOWS = [];
for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
        for (const [dr, dc] of [
            [0, 1],
            [1, 0],
            [1, 1],
            [1, -1],
        ]) {
            const endR = r + dr * 3;
            const endC = c + dc * 3;
            if (endR < 0 || endR >= ROWS || endC < 0 || endC >= COLS) continue;
            WINDOWS.push([0, 1, 2, 3].map((k) => indexOf(r + dr * k, c + dc * k)));
        }
    }
}

// 這一行棋子會落在第幾列；滿了回傳 -1
export function landingRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[indexOf(r, col)] === null) return r;
    return -1;
}

export const openColumns = (board) => [...Array(COLS).keys()].filter((c) => board[c] === null);

// 有人連成四子時回傳 { mark, cells }（cells 是所有連線上的格子，由小到大），否則 null
export function winnerOf(board) {
    let mark = null;
    const cells = new Set();
    for (const w of WINDOWS) {
        const first = board[w[0]];
        if (first && first === board[w[1]] && first === board[w[2]] && first === board[w[3]]) {
            mark = first;
            for (const i of w) cells.add(i);
        }
    }
    return mark ? { mark, cells: [...cells].sort((a, b) => a - b) } : null;
}

// 剛下在 index 的棋子是否連成四子（只看經過這一格的線，搜尋時用）
function connects(board, index) {
    const mark = board[index];
    const r0 = Math.floor(index / COLS);
    const c0 = index % COLS;
    for (const [dr, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
    ]) {
        let count = 1;
        for (const sign of [1, -1]) {
            let r = r0 + dr * sign;
            let c = c0 + dc * sign;
            while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === mark) {
                count++;
                r += dr * sign;
                c += dc * sign;
            }
        }
        if (count >= 4) return true;
    }
    return false;
}

// 下在哪幾行能讓 mark 立刻連成四子
export function winningColumns(board, mark) {
    const work = [...board];
    return openColumns(board).filter((col) => {
        const index = indexOf(landingRow(work, col), col);
        work[index] = mark;
        const win = connects(work, index);
        work[index] = null;
        return win;
    });
}

// ---------- 電腦對手 ----------

// 從中間往外試，alpha-beta 剪枝效果最好
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;

// 盤面評分（以 mark 的角度）：每個還沒被對方擋住的四格窗，自己的子越多分數越高；中間那一行的子另外加分
export function evaluate(board, mark) {
    const opp = other(mark);
    let score = 0;
    for (const w of WINDOWS) {
        let mine = 0;
        let theirs = 0;
        for (const i of w) {
            if (board[i] === mark) mine++;
            else if (board[i] === opp) theirs++;
        }
        if (mine && theirs) continue;
        if (mine === 3) score += 5;
        else if (mine === 2) score += 2;
        else if (theirs === 3) score -= 5;
        else if (theirs === 2) score -= 2;
    }
    for (let r = 0; r < ROWS; r++) {
        const cell = board[indexOf(r, 3)];
        if (cell === mark) score += 3;
        else if (cell === opp) score -= 3;
    }
    return score;
}

// 每一格屬於哪幾個四格窗（搜尋時只更新受影響的窗）
const WINDOWS_OF = Array.from({ length: SIZE }, () => []);
WINDOWS.forEach((w, k) => w.forEach((i) => WINDOWS_OF[i].push(k)));
// 一個窗裡紅 / 黃各有幾子時，對紅方的分數（與 evaluate 一致）
const windowScore = (red, yellow) =>
    red && yellow ? 0 : red === 3 ? 5 : red === 2 ? 2 : yellow === 3 ? -5 : yellow === 2 ? -2 : 0;

// 搜尋用的盤面：落子與收回時增量更新評分，葉節點不用重新掃過 69 個窗
function createSearch(board) {
    const work = [...board];
    const heights = [...Array(COLS).keys()].map((c) => ROWS - 1 - landingRow(work, c));
    const counts = { R: new Int8Array(WINDOWS.length), Y: new Int8Array(WINDOWS.length) };
    WINDOWS.forEach((w, k) => w.forEach((i) => work[i] && counts[work[i]][k]++));
    // 以紅方角度的分數
    let red = evaluate(work, 'R');

    function change(index, mark, delta) {
        for (const k of WINDOWS_OF[index]) {
            red -= windowScore(counts.R[k], counts.Y[k]);
            counts[mark][k] += delta;
            red += windowScore(counts.R[k], counts.Y[k]);
        }
        if (index % COLS === 3) red += (mark === 'R' ? 3 : -3) * delta;
    }

    return {
        // 落子並回傳格子位置；行已滿回傳 -1
        drop(col, mark) {
            if (heights[col] === ROWS) return -1;
            const index = indexOf(ROWS - 1 - heights[col], col);
            work[index] = mark;
            heights[col]++;
            change(index, mark, 1);
            return index;
        },
        lift(col) {
            heights[col]--;
            const index = indexOf(ROWS - 1 - heights[col], col);
            change(index, work[index], -1);
            work[index] = null;
        },
        connects: (index) => connects(work, index),
        score: (mark) => (mark === 'R' ? red : -red),
    };
}

// negamax + alpha-beta：輪到 mark 下，回傳以 mark 角度的分數（越快贏越高、越慢輸越好）
function negamax(search, mark, depth, alpha, beta, ply) {
    // 先看有沒有一步就贏的行：不然要等其他行都深入搜尋完才會試到
    for (const col of ORDER) {
        const index = search.drop(col, mark);
        if (index === -1) continue;
        const win = search.connects(index);
        search.lift(col);
        if (win) return WIN - ply;
    }
    let moved = false;
    let best = -Infinity;
    for (const col of ORDER) {
        const index = search.drop(col, mark);
        if (index === -1) continue;
        moved = true;
        let value;
        if (depth <= 1) value = search.score(mark);
        else value = -negamax(search, other(mark), depth - 1, -beta, -alpha, ply + 1);
        search.lift(col);
        if (value > best) best = value;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }
    // 盤面下滿：和局
    return moved ? best : 0;
}

// 每個能下的行對 mark 而言的分數（給選步與測試用），依行的順序排列
// margin：只需要知道與最好的一步相差 margin 以內的步時傳入，比最好的步差更多的分數只是上限，但可以剪掉大半的搜尋
export function rateColumns(board, mark, depth = DEPTH.hard, margin = Infinity) {
    const search = createSearch(board);
    const rated = [];
    let best = -Infinity;
    for (const col of ORDER) {
        const index = search.drop(col, mark);
        if (index === -1) continue;
        let score;
        if (search.connects(index)) score = WIN;
        else if (depth <= 1) score = search.score(mark);
        else {
            // 分數是整數，所以下限設成 best - margin - 1：等於門檻的步仍是精確分數
            const alpha = best - margin - 1;
            score = -negamax(search, other(mark), depth - 1, -Infinity, -alpha, 2) || 0;
        }
        search.lift(col);
        best = Math.max(best, score);
        rated.push({ col, score });
    }
    return rated.sort((a, b) => a.col - b.col);
}

const pick = (list, random) => list[Math.floor(random() * list.length)];

// 電腦這一步下在哪一行；同樣好的步隨機挑一個，讓每局不一樣
export function chooseMove(board, mark, level = 'hard', random = Math.random) {
    const open = openColumns(board);
    if (open.length === 0 || winnerOf(board)) return null;

    if (level === 'easy') {
        // 看到能贏的步只有一半機會下、該擋的只有三分之一機會擋；其餘偏向中間隨便下
        const wins = winningColumns(board, mark);
        if (wins.length && random() < 0.5) return pick(wins, random);
        const blocks = winningColumns(board, other(mark));
        if (blocks.length && random() < 0.35) return pick(blocks, random);
        const weighted = open.flatMap((c) => Array(4 - Math.abs(c - 3)).fill(c));
        return pick(weighted, random);
    }

    // normal 在差不多好的步裡隨機挑（必贏、必擋的分數差距很大，不會被影響）
    const margin = level === 'normal' ? 4 : 0;
    const rated = rateColumns(board, mark, DEPTH[level] ?? DEPTH.hard, margin);
    const top = Math.max(...rated.map((m) => m.score));
    return pick(
        rated.filter((m) => m.score >= top - margin).map((m) => m.col),
        random
    );
}

// ---------- 一局 ----------

// first：先手的顏色；state：存檔（toJSON 的結果），用來接著玩
export function createConnectFour({ first = 'R', state } = {}) {
    if (state) first = state.first;
    if (first !== 'R' && first !== 'Y') throw new Error('first 必須是 R 或 Y');

    const game = {
        first,
        board: Array(SIZE).fill(null),
        // 依序下過的行
        moves: [],
        turn: first,
        // playing | won | draw
        status: 'playing',
        // 結束時 { mark, cells }
        winner: null,
    };

    function refresh() {
        game.turn = game.moves.length % 2 === 0 ? first : other(first);
        game.winner = winnerOf(game.board);
        game.status = game.winner ? 'won' : game.moves.length === SIZE ? 'draw' : 'playing';
    }

    // 回傳 { col, row, index, mark, won?: { mark, cells }, draw? }；不能下（行已滿、已結束）時回傳 null
    function play(col) {
        if (game.status !== 'playing' || !Number.isInteger(col) || col < 0 || col >= COLS) return null;
        const row = landingRow(game.board, col);
        if (row === -1) return null;
        const mark = game.turn;
        const index = indexOf(row, col);
        game.board[index] = mark;
        game.moves.push(col);
        refresh();
        const result = { col, row, index, mark };
        if (game.status === 'won') result.won = game.winner;
        if (game.status === 'draw') result.draw = true;
        return result;
    }

    // 收回最後一步，回傳 { col, row, index, mark }；沒有可以收回的回傳 null
    function undo() {
        if (game.moves.length === 0) return null;
        const col = game.moves.pop();
        const row = landingRow(game.board, col) + 1;
        const index = indexOf(row, col);
        const mark = game.board[index];
        game.board[index] = null;
        refresh();
        return { col, row, index, mark };
    }

    const legalMoves = () => (game.status === 'playing' ? openColumns(game.board) : []);
    const lastIndex = () => {
        const col = game.moves.at(-1);
        return col === undefined ? -1 : indexOf(landingRow(game.board, col) + 1, col);
    };
    const toJSON = () => ({ first, moves: [...game.moves] });

    Object.assign(game, { play, undo, legalMoves, lastIndex, toJSON });

    if (state) {
        if (!Array.isArray(state.moves)) throw new Error('存檔格式不符');
        for (const col of state.moves) if (!play(col)) throw new Error('存檔裡有不合法的一步');
    }
    return game;
}
