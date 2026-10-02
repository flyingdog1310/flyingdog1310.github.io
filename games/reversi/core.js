// 黑白棋的遊戲規則與電腦對手（純邏輯，不碰 DOM）
// 盤面是長度 64 的陣列（列優先，0 = 左上 A1、63 = 右下 H8），每格 null | 'B'（黑）| 'W'（白）
// 規則：黑先；下的子要和自己的棋子夾住對方至少一子，夾住的全部翻面；沒有合法步時由對方繼續下（pass），
// 雙方都不能下時結束，棋子多的一方贏（空格不計，同數是和局）

export const N = 8;
export const SIZE = N * N;

// 電腦對手的難度：easy 只挑翻最多子的步（常送角）、normal 往前看兩步並懂得搶角、hard 往前算到 6 步、最後 10 格算到底
export const LEVELS = ['easy', 'normal', 'hard'];

export const other = (mark) => (mark === 'B' ? 'W' : 'B');
export const indexOf = (row, col) => row * N + col;

// 座標名稱：行 A–H（左到右）、列 1–8（上到下），開局的四子在 D4、E4、D5、E5
const LETTERS = 'ABCDEFGH';
export const cellName = (index) => `${LETTERS[index % N]}${Math.floor(index / N) + 1}`;

export const DIRS = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
];

const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

// 開局：D4、E5 白，E4、D5 黑
export function startBoard() {
    const board = Array(SIZE).fill(null);
    board[indexOf(3, 3)] = 'W';
    board[indexOf(4, 4)] = 'W';
    board[indexOf(3, 4)] = 'B';
    board[indexOf(4, 3)] = 'B';
    return board;
}

// mark 下在 index 會翻過來的對方棋子（依方向、由近到遠）；不能下時回傳空陣列
export function flipsFor(board, index, mark) {
    if (board[index] !== null) return [];
    const opp = other(mark);
    const r0 = Math.floor(index / N);
    const c0 = index % N;
    const flips = [];
    for (const [dr, dc] of DIRS) {
        let r = r0 + dr;
        let c = c0 + dc;
        const run = [];
        while (inside(r, c) && board[indexOf(r, c)] === opp) {
            run.push(indexOf(r, c));
            r += dr;
            c += dc;
        }
        if (run.length && inside(r, c) && board[indexOf(r, c)] === mark) flips.push(...run);
    }
    return flips;
}

// mark 的所有合法步：[{ index, flips }]，依 index 排序
export function legalMoves(board, mark) {
    const moves = [];
    for (let i = 0; i < SIZE; i++) {
        if (board[i] !== null) continue;
        const flips = flipsFor(board, i, mark);
        if (flips.length) moves.push({ index: i, flips });
    }
    return moves;
}

export function countDiscs(board) {
    let B = 0;
    let W = 0;
    for (const mark of board) {
        if (mark === 'B') B++;
        else if (mark === 'W') W++;
    }
    return { B, W };
}

// ---------- 電腦對手：bitboard（每方 64 位元，拆成上半 hi = 第 5–8 列、下半 lo = 第 1–4 列兩個 32 位元整數） ----------
// 格子 i 對應第 i 位元；一次用位元運算算出所有合法步與翻面，手機上每步也只要幾十毫秒

// 位置分數：角最好，角旁邊的 X 位（斜角）與 C 位最差（容易把角送給對方），邊次之
// prettier-ignore
const WEIGHTS = [
    120, -25, 20,  5,  5, 20, -25, 120,
    -25, -45, -5, -5, -5, -5, -45, -25,
     20,  -5, 15,  3,  3, 15,  -5,  20,
      5,  -5,  3,  3,  3,  3,  -5,   5,
      5,  -5,  3,  3,  3,  3,  -5,   5,
     20,  -5, 15,  3,  3, 15,  -5,  20,
    -25, -45, -5, -5, -5, -5, -45, -25,
    120, -25, 20,  5,  5, 20, -25, 120,
];

// 一組格子的遮罩 [hi, lo]
function maskOf(cells) {
    let hi = 0;
    let lo = 0;
    for (const i of cells) {
        if (i < 32) lo |= 1 << i;
        else hi |= 1 << (i - 32);
    }
    return [hi, lo];
}

// 同分的格子歸成一類；搜尋時依分數由高到低試（角先、X 位最後），剪枝比較有效
const CLASSES = [...new Set(WEIGHTS)]
    .sort((a, b) => b - a)
    .map((weight) => [weight, ...maskOf(WEIGHTS.flatMap((w, i) => (w === weight ? [i] : [])))]);
// 角被佔了以後，旁邊三格就不再危險：[角, 旁邊三格各自的 [分數, hi, lo]]
const CORNERS = [
    [0, [1, 8, 9]],
    [7, [6, 15, 14]],
    [56, [57, 48, 49]],
    [63, [62, 55, 54]],
].map(([corner, near]) => [maskOf([corner]), near.map((i) => [WEIGHTS[i], ...maskOf([i])])]);

const NOT_A = 0xfefefefe | 0; // 去掉 A 行（往右移時從前一列繞過來的位元）
const NOT_H = 0x7f7f7f7f; // 去掉 H 行
// 八個方向：[位移量, 往高位移（index 變大）, 遮罩]
const SHIFTS = [
    [1, true, NOT_A], // 右
    [1, false, NOT_H], // 左
    [8, true, -1], // 下
    [8, false, -1], // 上
    [9, true, NOT_A], // 右下
    [7, true, NOT_H], // 左下
    [7, false, NOT_A], // 右上
    [9, false, NOT_H], // 左上
];

// 位移的結果放在這兩個變數（避免每次都建立陣列）
let RH = 0;
let RL = 0;
function shift(h, l, d) {
    const [n, up, mask] = SHIFTS[d];
    if (up) {
        RH = ((h << n) | (l >>> (32 - n))) & mask;
        RL = (l << n) & mask;
    } else {
        RL = ((l >>> n) | (h << (32 - n))) & mask;
        RH = (h >>> n) & mask;
    }
}

function popcount(x) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

// p（輪到的一方）的所有合法步，結果放在 RH / RL
function movesOf(ph, pl, oh, ol) {
    const eh = ~(ph | oh);
    const el = ~(pl | ol);
    let mh = 0;
    let ml = 0;
    for (let d = 0; d < 8; d++) {
        shift(ph, pl, d);
        let xh = RH & oh;
        let xl = RL & ol;
        for (let k = 0; k < 5; k++) {
            shift(xh, xl, d);
            xh |= RH & oh;
            xl |= RL & ol;
        }
        shift(xh, xl, d);
        mh |= RH & eh;
        ml |= RL & el;
    }
    RH = mh;
    RL = ml;
}

// p 下在 s 翻過來的棋子，結果放在 RH / RL
function flipsAt(ph, pl, oh, ol, s) {
    const bh = s >= 32 ? 1 << (s - 32) : 0;
    const bl = s < 32 ? 1 << s : 0;
    let fh = 0;
    let fl = 0;
    for (let d = 0; d < 8; d++) {
        let lh = 0;
        let ll = 0;
        shift(bh, bl, d);
        let xh = RH;
        let xl = RL;
        while ((xh & oh) | (xl & ol)) {
            lh |= xh;
            ll |= xl;
            shift(xh, xl, d);
            xh = RH;
            xl = RL;
        }
        if ((xh & ph) | (xl & pl)) {
            fh |= lh;
            fl |= ll;
        }
    }
    RH = fh;
    RL = fl;
}

// 一組遮罩裡，p 比 o 多幾子
const diffIn = (ph, pl, oh, ol, h, l) => popcount(ph & h) + popcount(pl & l) - popcount(oh & h) - popcount(ol & l);

// 評估盤面（以 p 的角度）：位置分數 + 行動力（能下的步數差，佔比越懸殊越重要）
function evaluate(ph, pl, oh, ol) {
    let pos = 0;
    for (const [weight, h, l] of CLASSES) pos += weight * diffIn(ph, pl, oh, ol, h, l);
    for (const [[ch, cl], near] of CORNERS) {
        if (((ph | oh) & ch) | ((pl | ol) & cl)) {
            for (const [weight, h, l] of near) pos -= weight * diffIn(ph, pl, oh, ol, h, l);
        }
    }
    movesOf(ph, pl, oh, ol);
    const mine = popcount(RH) + popcount(RL);
    movesOf(oh, ol, ph, pl);
    const theirs = popcount(RH) + popcount(RL);
    return pos + (120 * (mine - theirs)) / (mine + theirs + 2);
}

// 用 bitboard 算出的合法步與翻面（和 legalMoves 同格式；給測試對照兩種算法一致）
export function bitMoves(board, mark) {
    const toBits = (want) => maskOf(board.flatMap((m, i) => (m === want ? [i] : [])));
    const [ph, pl] = toBits(mark);
    const [oh, ol] = toBits(other(mark));
    const cellsOf = (h, l) =>
        Array.from({ length: SIZE }, (_, i) => i).filter((i) => (i < 32 ? (l >>> i) & 1 : (h >>> (i - 32)) & 1));
    movesOf(ph, pl, oh, ol);
    return cellsOf(RH, RL).map((index) => {
        flipsAt(ph, pl, oh, ol, index);
        return { index, flips: cellsOf(RH, RL) };
    });
}

// 搜尋的設定：normal 看 2 步、最後 6 格算到底；hard 逐層加深到 6 步、最後 10 格算到底，超過節點上限就用前一層的結果
export const LIMITS = {
    normal: { depth: 2, exact: 6 },
    hard: { depth: 6, exact: 10, nodes: 30000, exactNodes: 100000 },
};
// 算到底時的分數：子數差 × 1000，壓過一般評分
const FINAL = 1000;

class Abort extends Error {}

function createEngine(board, mark) {
    let ph = 0;
    let pl = 0;
    let oh = 0;
    let ol = 0;
    for (let i = 0; i < SIZE; i++) {
        if (board[i] === null) continue;
        const own = board[i] === mark;
        if (i < 32) {
            if (own) pl |= 1 << i;
            else ol |= 1 << i;
        } else if (own) ph |= 1 << (i - 32);
        else oh |= 1 << (i - 32);
    }
    const empties = SIZE - popcount(ph) - popcount(pl) - popcount(oh) - popcount(ol);
    let nodes = 0;
    let limit = Infinity;

    const final = (ph, pl, oh, ol) => FINAL * (popcount(ph) + popcount(pl) - popcount(oh) - popcount(ol));

    // 依序呼叫 visit(s, 下了之後的 p 與 o 四個整數)；visit 回傳 true 代表剪枝、停止
    function forEachMove(ph, pl, oh, ol, mh, ml, visit) {
        for (const [, h, l] of CLASSES) {
            let m = ml & l;
            while (m) {
                const b = m & -m;
                m ^= b;
                const s = 31 - Math.clz32(b);
                flipsAt(ph, pl, oh, ol, s);
                if (visit(s, ph | RH, pl | RL | b, oh & ~RH, ol & ~RL)) return;
            }
            m = mh & h;
            while (m) {
                const b = m & -m;
                m ^= b;
                const s = 63 - Math.clz32(b);
                flipsAt(ph, pl, oh, ol, s);
                if (visit(s, ph | RH | b, pl | RL, oh & ~RH, ol & ~RL)) return;
            }
        }
    }

    // negamax + alpha-beta；exact 時算到底（depth 不用）
    function negamax(ph, pl, oh, ol, depth, alpha, beta, exact, passed) {
        if (++nodes > limit) throw new Abort();
        if (!exact && depth === 0) return evaluate(ph, pl, oh, ol);
        movesOf(ph, pl, oh, ol);
        const mh = RH;
        const ml = RL;
        if ((mh | ml) === 0) {
            if (passed) return final(ph, pl, oh, ol);
            return -negamax(oh, ol, ph, pl, depth, -beta, -alpha, exact, true);
        }
        let best = -Infinity;
        if (exact && popcount(~(ph | oh)) + popcount(~(pl | ol)) > 5) {
            // 終盤：先試讓對方能下的步最少的（fastest-first），剪枝效果好很多
            const children = [];
            forEachMove(ph, pl, oh, ol, mh, ml, (s, nph, npl, noh, nol) => {
                movesOf(noh, nol, nph, npl);
                children.push([popcount(RH) + popcount(RL), nph, npl, noh, nol]);
            });
            children.sort((a, b) => a[0] - b[0]);
            for (const [, nph, npl, noh, nol] of children) {
                const score = -negamax(noh, nol, nph, npl, 0, -beta, -alpha, true, false);
                if (score > best) best = score;
                if (score > alpha) alpha = score;
                if (alpha >= beta) break;
            }
            return best;
        }
        forEachMove(ph, pl, oh, ol, mh, ml, (s, nph, npl, noh, nol) => {
            const score = -negamax(noh, nol, nph, npl, depth - 1, -beta, -alpha, exact, false);
            if (score > best) best = score;
            if (score > alpha) alpha = score;
            return alpha >= beta;
        });
        return best;
    }

    return {
        empties,
        get nodes() {
            return nodes;
        },
        // 根節點每一步的分數 [{ s, score }]，由高到低；first 先試（逐層加深時上一層最好的步）
        // 和目前最好的步差在 window 以內（含同分）的步分數都會算準，其他步只知道比較差
        rootScores(depth, exact, { first = -1, window = 0 } = {}) {
            movesOf(ph, pl, oh, ol);
            const children = [];
            forEachMove(ph, pl, oh, ol, RH, RL, (s, nph, npl, noh, nol) => {
                children.push([s, nph, npl, noh, nol]);
            });
            if (first >= 0) children.sort((a, b) => (b[0] === first) - (a[0] === first));
            let alpha = -Infinity;
            const out = [];
            for (const [s, nph, npl, noh, nol] of children) {
                // 下限再減一點點：和最好的步同分的步也要算出準確的分數，而不是只知道「不比較好」
                const score = -negamax(
                    noh,
                    nol,
                    nph,
                    npl,
                    depth - 1,
                    -Infinity,
                    -(alpha - window - 1e-6),
                    exact,
                    false
                );
                out.push({ s, score });
                if (score > alpha) alpha = score;
            }
            return out.sort((a, b) => b.score - a.score);
        },
        // 有節點上限（所有呼叫合計）的搜尋：超過時中止並回傳 null
        run(fn, maxNodes) {
            limit = maxNodes;
            try {
                return fn();
            } catch (error) {
                if (error instanceof Abort) return null;
                throw error;
            } finally {
                limit = Infinity;
            }
        },
    };
}

function pick(list, random) {
    return list[Math.floor(random() * list.length)];
}

// 電腦選一步：回傳格子 index；沒有合法步時回傳 -1
export function chooseMove(board, mark, level = 'normal', { random = Math.random } = {}) {
    const moves = legalMoves(board, mark);
    if (moves.length === 0) return -1;
    if (moves.length === 1) return moves[0].index;

    if (level === 'easy') {
        // 初學者的下法：大多挑翻最多子的步（不管會不會送角），偶爾隨便下
        if (random() < 0.3) return pick(moves, random).index;
        const most = Math.max(...moves.map((m) => m.flips.length));
        return pick(
            moves.filter((m) => m.flips.length === most),
            random
        ).index;
    }

    const engine = createEngine(board, mark);

    if (level === 'normal') {
        const { depth, exact } = LIMITS.normal;
        const isExact = engine.empties <= exact;
        // 差不多好的步裡隨機挑（終盤算到底時只挑最好的）
        const window = isExact ? 0 : 8;
        const scored = engine.rootScores(depth, isExact, { window });
        const top = scored[0].score;
        return pick(
            scored.filter((m) => m.score >= top - window),
            random
        ).s;
    }

    // hard：終盤算到底；否則逐層加深，節點用完就用最後一層算完的結果
    const { depth, exact, nodes, exactNodes } = LIMITS.hard;
    if (engine.empties <= exact) {
        const solved = engine.run(() => engine.rootScores(0, true), exactNodes);
        if (solved) {
            const top = solved[0].score;
            return pick(
                solved.filter((m) => m.score === top),
                random
            ).s;
        }
    }
    const budget = engine.nodes + nodes;
    // 第一層一定算完（最多幾十個節點）
    let best = engine.rootScores(1, false);
    for (let d = 2; d <= depth; d++) {
        const scored = engine.run(() => engine.rootScores(d, false, { first: best[0].s }), budget);
        if (!scored) break;
        best = scored;
    }
    const top = best[0].score;
    return pick(
        best.filter((m) => m.score === top),
        random
    ).s;
}

// ---------- 一局 ----------

// state：存檔（toJSON 的結果），用來接著玩；board / turn：從指定的盤面開始（測試用）
export function createReversi({ state, board = null, turn = 'B' } = {}) {
    if (state?.board) {
        if (!Array.isArray(state.board) || state.board.length !== SIZE) throw new Error('存檔格式不符');
        ({ board, turn } = state);
    }
    const start = board ? [...board] : startBoard();
    const game = {
        board: [...start],
        // 依序下過的步：{ index, mark, flips }（pass 不算一步，由規則自動決定）
        history: [],
        turn: 'B',
        // playing | over
        status: 'playing',
        // 結束時 'B' | 'W' | null（和局）
        winner: null,
        // 目前輪到的一方的合法步
        moves: [],
    };

    // 輪到 next；不能下就換對方（pass），雙方都不能下就結束。回傳 pass 掉的一方或 null
    function advance(next) {
        game.turn = next;
        game.moves = legalMoves(game.board, next);
        if (game.moves.length) return null;
        game.turn = other(next);
        game.moves = legalMoves(game.board, game.turn);
        if (game.moves.length) return next;
        game.status = 'over';
        const { B, W } = countDiscs(game.board);
        game.winner = B > W ? 'B' : W > B ? 'W' : null;
        return null;
    }

    const isLegal = (index) => game.moves.some((m) => m.index === index);
    const flipsOf = (index) => game.moves.find((m) => m.index === index)?.flips ?? [];

    // 回傳 { index, mark, flips, passed?: 'B' | 'W', over?: { winner, B, W } }；不能下時回傳 null
    function play(index) {
        if (game.status !== 'playing' || !isLegal(index)) return null;
        const mark = game.turn;
        const flips = flipsOf(index);
        game.board[index] = mark;
        for (const i of flips) game.board[i] = mark;
        game.history.push({ index, mark, flips });
        const passed = advance(other(mark));
        const result = { index, mark, flips };
        if (passed) result.passed = passed;
        if (game.status === 'over') result.over = { winner: game.winner, ...countDiscs(game.board) };
        return result;
    }

    // 收回最後一步，回傳 { index, mark, flips }；沒有可以收回的回傳 null
    function undo() {
        const last = game.history.pop();
        if (!last) return null;
        game.board[last.index] = null;
        for (const i of last.flips) game.board[i] = other(last.mark);
        game.status = 'playing';
        game.winner = null;
        game.turn = last.mark;
        game.moves = legalMoves(game.board, last.mark);
        return last;
    }

    const lastIndex = () => game.history.at(-1)?.index ?? -1;
    const score = () => countDiscs(game.board);
    const toJSON = () => ({ ...(board && { board: start, turn }), moves: game.history.map((m) => m.index) });

    Object.assign(game, { play, undo, isLegal, flipsOf, lastIndex, score, toJSON });
    advance(turn);

    if (state) {
        if (!Array.isArray(state.moves)) throw new Error('存檔格式不符');
        for (const index of state.moves) if (!play(index)) throw new Error('存檔裡有不合法的一步');
    }
    return game;
}
