// 西洋跳棋（美式 / 英式 8 × 8 規則）的遊戲規則與電腦對手（純邏輯，不碰 DOM）
// 盤面是長度 64 的陣列（列優先，0 = 左上），只用深色格（(row + col) 為奇數）；
// 每格 null | 'r'（紅兵）| 'b'（黑兵）| 'R'（紅王）| 'B'（黑王）。紅在下方、往上走，黑在上方、往下走
// 規則：紅先；兵只能往前斜走一格，王可以前後斜走一格（不能飛）；能吃就一定要吃（可以選吃哪一條路，不一定要吃最多），
// 連跳要跳到不能再跳為止；兵吃子或走到對方底線就升王，升王時這一步結束；
// 輪到的一方沒有棋子或沒有步可走就輸；同一局面第三次出現，或雙方 40 步（80 手）都沒有吃子也沒有動兵，是和局

export const N = 8;
export const SIZE = N * N;
export const LEVELS = ['easy', 'normal', 'hard'];
// 多少手沒有進展（吃子或動兵）算和局
export const QUIET_LIMIT = 80;

export const other = (side) => (side === 'r' ? 'b' : 'r');
const SIDE = { r: 'r', R: 'r', b: 'b', B: 'b' };
export const sideOf = (piece) => (piece ? SIDE[piece] : null);
export const isKing = (piece) => piece === 'R' || piece === 'B';
export const indexOf = (row, col) => row * N + col;
export const isDark = (i) => (Math.floor(i / N) + (i % N)) % 2 === 1;
// 座標名稱同西洋棋：行 a–h（紅方看過去由左到右）、列 1–8（紅方底線是 1）
export const cellName = (i) => `${'abcdefgh'[i % N]}${N - Math.floor(i / N)}`;
// 這一方的兵走到哪一列升王
const kingRow = (side) => (side === 'r' ? 0 : N - 1);

export const DARK = Array.from({ length: SIZE }, (_, i) => i).filter(isDark);

// 四個斜方向：0 左上、1 右上、2 左下、3 右下；紅兵只能用 0、1，黑兵只能用 2、3
const DIRS = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
];
const DIRS_OF = { r: [0, 1], b: [2, 3], R: [0, 1, 2, 3], B: [0, 1, 2, 3] };
// 預先算好每一格往每個方向走一格 / 跳兩格的位置（出界是 -1）
const STEP = [];
const JUMP = [];
for (let i = 0; i < SIZE; i++) {
    const r = Math.floor(i / N);
    const c = i % N;
    STEP.push(DIRS.map(([dr, dc]) => (inside(r + dr, c + dc) ? indexOf(r + dr, c + dc) : -1)));
    JUMP.push(DIRS.map(([dr, dc]) => (inside(r + 2 * dr, c + 2 * dc) ? indexOf(r + 2 * dr, c + 2 * dc) : -1)));
}
function inside(r, c) {
    return r >= 0 && r < N && c >= 0 && c < N;
}

// 開局：黑在上面三列、紅在下面三列，各 12 子
export function startBoard() {
    const board = Array(SIZE).fill(null);
    for (const i of DARK) {
        const r = Math.floor(i / N);
        if (r < 3) board[i] = 'b';
        else if (r > 4) board[i] = 'r';
    }
    return board;
}

// 從 from 出發的所有連跳路線。吃掉的子要等整步走完才拿掉：同一子不能跳兩次，也不能落在被吃的子上
function jumpsFrom(board, from, out) {
    const piece = board[from];
    const opp = other(sideOf(piece));
    const king = isKing(piece);
    const dirs = DIRS_OF[piece];
    const path = [from];
    const captures = [];
    const visit = (sq) => {
        let extended = false;
        for (const d of dirs) {
            const land = JUMP[sq][d];
            if (land < 0) continue;
            const mid = STEP[sq][d];
            // 出發的格子已經空出來，王繞一圈可以再經過
            if (board[land] !== null && land !== from) continue;
            if (sideOf(board[mid]) !== opp || captures.includes(mid)) continue;
            extended = true;
            path.push(land);
            captures.push(mid);
            // 兵升王時這一步就結束
            if (!king && Math.floor(land / N) === kingRow(sideOf(piece))) out.push(record(piece, path, captures, true));
            else visit(land);
            path.pop();
            captures.pop();
        }
        if (!extended && captures.length) out.push(record(piece, path, captures, false));
    };
    visit(from);
}

function record(piece, path, captures, promote) {
    return { from: path[0], to: path.at(-1), path: [...path], captures: [...captures], piece, promote };
}

// 快速檢查 from 的棋子能不能吃子（大部分的棋子不能，省掉找連跳路線的成本）
function canJump(board, from) {
    const piece = board[from];
    const opp = other(SIDE[piece]);
    for (const d of DIRS_OF[piece]) {
        const land = JUMP[from][d];
        if (land >= 0 && board[land] === null && sideOf(board[STEP[from][d]]) === opp) return true;
    }
    return false;
}

// side 的所有合法步：[{ from, to, path: [from, 落點…], captures: [被吃的格子…], piece, promote }]
// 有子可吃時只回傳吃子的步
export function legalMoves(board, side) {
    const jumps = [];
    for (const i of DARK) if (sideOf(board[i]) === side && canJump(board, i)) jumpsFrom(board, i, jumps);
    if (jumps.length) return jumps;
    const moves = [];
    for (const i of DARK) {
        const piece = board[i];
        if (sideOf(piece) !== side) continue;
        for (const d of DIRS_OF[piece]) {
            const to = STEP[i][d];
            if (to < 0 || board[to] !== null) continue;
            const promote = !isKing(piece) && Math.floor(to / N) === kingRow(side);
            moves.push({ from: i, to, path: [i, to], captures: [], piece, promote });
        }
    }
    return moves;
}

// 下了 move 之後的新盤面（不改原本的盤面）
export function applyMove(board, move) {
    const next = board.slice();
    next[move.from] = null;
    for (const i of move.captures) next[i] = null;
    next[move.to] = move.promote ? move.piece.toUpperCase() : move.piece;
    return next;
}

// 選子 → 選落點的過程：已經選了 from、依序點過 hops 這幾個落點時，還符合的合法步
// next：下一個可以點的落點；ends：這些步最後停在哪（連跳時可以直接點終點）
export function narrowMoves(moves, from, hops = []) {
    const matching = moves.filter((m) => m.from === from && hops.every((sq, k) => m.path[k + 1] === sq));
    const next = [
        ...new Set(matching.filter((m) => m.path.length > hops.length + 1).map((m) => m.path[hops.length + 1])),
    ];
    const ends = [...new Set(matching.map((m) => m.to))];
    // 剛好走完一整步（同一組落點只會對應一步）
    const done = matching.find((m) => m.path.length === hops.length + 1) ?? null;
    return { moves: matching, next, ends, done };
}

// 盤面上雙方的兵與王數量
export function countPieces(board) {
    const count = { r: 0, b: 0, R: 0, B: 0 };
    for (const i of DARK) if (board[i]) count[board[i]]++;
    return { r: { men: count.r, kings: count.R }, b: { men: count.b, kings: count.B } };
}

const keyOf = (board, turn) => turn + board.join(',');

// ---------- 電腦對手：negamax + alpha-beta，逐層加深，有子可吃時不停在半路（吃子一定要接著算完） ----------

const MAN = 100;
const KING = 150;
const WIN = 100000;
// 每一格的位置分數（預先算好）：兵越往前越好（越接近升王）、中央比較好、守住底線的兩格（c1、g1 / b8、f8）擋住對方升王；
// 王在中間比較靈活，貼邊或在角落容易被困住
const ROW = Array.from({ length: SIZE }, (_, i) => Math.floor(i / N));
const COL = Array.from({ length: SIZE }, (_, i) => i % N);
const CENTER = [indexOf(3, 2), indexOf(3, 4), indexOf(4, 3), indexOf(4, 5), indexOf(3, 6), indexOf(4, 1)];
const GUARDS = { r: [indexOf(7, 2), indexOf(7, 6)], b: [indexOf(0, 1), indexOf(0, 5)] };
const PST = {};
for (const piece of ['r', 'b', 'R', 'B']) {
    PST[piece] = Array.from({ length: SIZE }, (_, i) => {
        if (isKing(piece)) return Math.min(ROW[i], N - 1 - ROW[i], COL[i], N - 1 - COL[i]) * 4;
        const advance = piece === 'r' ? N - 1 - ROW[i] : ROW[i];
        return (
            advance * 3 +
            (advance >= 5 ? 6 : 0) +
            (CENTER.includes(i) ? 4 : 0) +
            (GUARDS[piece].includes(i) ? 10 : 0)
        );
    });
}
const VALUE = { r: MAN, b: MAN, R: KING, B: KING };

// 以 side 的角度評估盤面
export function evaluate(board, side) {
    let mine = 0;
    let theirs = 0;
    let pos = 0;
    let menLeft = 0;
    for (let k = 0; k < DARK.length; k++) {
        const i = DARK[k];
        const piece = board[i];
        if (piece === null) continue;
        if (piece === 'r' || piece === 'b') menLeft++;
        if (sideOf(piece) === side) {
            mine += VALUE[piece];
            pos += PST[piece][i];
        } else {
            theirs += VALUE[piece];
            pos -= PST[piece][i];
        }
    }
    let score = mine - theirs + pos;
    // 領先時鼓勵換子（子越少，領先越明顯）
    score += Math.round(((mine - theirs) * 600) / (mine + theirs + 300));
    // 殘局（兵差不多走完了）領先時，王要往對方的子靠近，不然會一直繞圈變和局
    if (mine > theirs && menLeft <= 2) {
        for (const k of DARK) {
            if (board[k] === null || !isKing(board[k]) || sideOf(board[k]) !== side) continue;
            let near = N;
            for (const t of DARK) {
                if (board[t] === null || sideOf(board[t]) === side) continue;
                near = Math.min(near, Math.max(Math.abs(ROW[k] - ROW[t]), Math.abs(COL[k] - COL[t])));
            }
            score -= near * 3;
        }
    }
    return score;
}

// 搜尋的設定：depth 是往前看幾手，nodes 是節點上限（超過就用前一層算完的結果）
export const LIMITS = {
    easy: { depth: 2, nodes: 2000 },
    normal: { depth: 4, nodes: 6000 },
    hard: { depth: 14, nodes: 12000 },
};
// 吃子時最多再往下延伸幾手
const EXTEND = 8;
// 搜尋最多幾手（避免雙方都只有一步可走時一直走下去）
const MAX_PLY = 64;

class Abort extends Error {}

// 吃子多的先試、升王次之（剪枝比較有效）
const order = (moves) => moves.sort((a, b) => b.captures.length - a.captures.length || b.promote - a.promote);

function search(board, side) {
    let nodes = 0;
    let limit = Infinity;

    function negamax(board, side, depth, alpha, beta, ply, ext) {
        if (++nodes > limit) throw new Abort();
        const moves = legalMoves(board, side);
        if (moves.length === 0) return -WIN + ply;
        const forced = moves[0].captures.length > 0;
        // 有子可吃時不能停在這裡評估（下一手一定是吃子，評分會失準）
        if ((depth <= 0 && !(forced && ext < EXTEND)) || ply >= MAX_PLY) return evaluate(board, side);
        const nextExt = depth <= 0 ? ext + 1 : ext;
        // 只有一步可走時不算一層（被迫的步不佔深度）
        const nextDepth = moves.length === 1 ? depth : depth - 1;
        let best = -Infinity;
        for (const move of order(moves)) {
            const score = -negamax(applyMove(board, move), other(side), nextDepth, -beta, -alpha, ply + 1, nextExt);
            if (score > best) best = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break;
        }
        return best;
    }

    return {
        get nodes() {
            return nodes;
        },
        // 根節點每一步的分數（由高到低）；和最好的步差在 window 以內的步分數算準，其他步只知道比較差
        root(moves, depth, window = 0) {
            const out = [];
            let alpha = -Infinity;
            for (const move of moves) {
                const score = -negamax(
                    applyMove(board, move),
                    other(side),
                    depth - 1,
                    -Infinity,
                    -(alpha - window - 1e-6),
                    1,
                    0
                );
                out.push({ move, score });
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

// 各難度在差不多好的步裡隨機挑的範圍（hard 只挑最好的）
const WINDOW = { easy: 60, normal: 12, hard: 0 };

// 電腦選一步：回傳 legalMoves 裡的一個物件；沒有步可走時回傳 null
export function chooseMove(board, side, level = 'normal', { random = Math.random } = {}) {
    const moves = legalMoves(board, side);
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];
    if (!LIMITS[level]) level = 'normal';
    // 初學者：常常隨便走（會送子）
    if (level === 'easy' && random() < 0.35) return pick(moves, random);

    const { depth, nodes } = LIMITS[level];
    const window = WINDOW[level];
    const engine = search(board, side);
    // 第一層一定算完，之後逐層加深，節點用完就用最後一層算完的結果；上一層最好的步先試
    let best = engine.root(order(moves.slice()), 1, window);
    for (let d = 2; d <= depth; d++) {
        const first = best[0].move;
        const ordered = [first, ...order(moves.filter((m) => m !== first))];
        const scored = engine.run(() => engine.root(ordered, d, window), nodes);
        if (!scored) break;
        best = scored;
        // 已經找到必勝 / 必敗就不用再算更深
        if (Math.abs(best[0].score) > WIN / 2) break;
    }
    const top = best[0].score;
    return pick(
        best.filter((m) => m.score >= top - window),
        random
    ).move;
}

// ---------- 一局 ----------

// state：存檔（toJSON 的結果），用來接著玩；board / turn：從指定的盤面開始、quietLimit：和局的手數（測試用）
export function createCheckers({ state, board = null, turn = 'r', quietLimit = QUIET_LIMIT } = {}) {
    if (state?.board) {
        if (!Array.isArray(state.board) || state.board.length !== SIZE) throw new Error('存檔格式不符');
        ({ board, turn } = state);
    }
    const start = board ? [...board] : startBoard();
    const game = {
        board: [...start],
        turn,
        // 依序走過的步：{ ...move, side, before（走之前的盤面）, quietBefore, key（走之後的局面） }
        history: [],
        // playing | over
        status: 'playing',
        // 結束時 'r' | 'b' | null（和局）
        winner: null,
        // 結束的原因：no-moves（沒有步可走，含沒有棋子）| repetition | quiet
        reason: null,
        // 目前輪到的一方的合法步
        moves: [],
        // 連續幾手沒有吃子也沒有動兵
        quiet: 0,
    };

    // 同一局面（含輪到誰）出現了幾次：只需要看最後一次吃子或動兵之後
    function repeats() {
        const key = keyOf(game.board, game.turn);
        let count = 1;
        for (let k = game.history.length - 1, n = game.quiet; k >= 0 && n > 0; k--, n--) {
            if (game.history[k].before && keyOf(game.history[k].before, game.history[k].side) === key) count++;
        }
        return count;
    }

    function refresh() {
        game.moves = legalMoves(game.board, game.turn);
        game.status = 'playing';
        game.winner = null;
        game.reason = null;
        if (game.moves.length === 0) {
            game.status = 'over';
            game.winner = other(game.turn);
            game.reason = 'no-moves';
        } else if (repeats() >= 3) {
            game.status = 'over';
            game.reason = 'repetition';
        } else if (game.quiet >= quietLimit) {
            game.status = 'over';
            game.reason = 'quiet';
        }
    }

    // 依落點路線（[from, 落點…]）找出合法步
    const findMove = (path) =>
        game.moves.find((m) => m.path.length === path.length && m.path.every((sq, k) => sq === path[k])) ?? null;

    // 走一步：傳入合法步物件或落點路線。回傳 { ...move, side, over?: { winner, reason } }；不合法時回傳 null
    function play(moveOrPath) {
        if (game.status !== 'playing') return null;
        const move = findMove(Array.isArray(moveOrPath) ? moveOrPath : (moveOrPath?.path ?? []));
        if (!move) return null;
        const side = game.turn;
        const before = game.board;
        const quietBefore = game.quiet;
        game.board = applyMove(before, move);
        game.quiet = move.captures.length || !isKing(move.piece) ? 0 : game.quiet + 1;
        const captured = move.captures.map((i) => before[i]);
        const entry = { ...move, side, captured, before, quietBefore };
        game.history.push(entry);
        game.turn = other(side);
        refresh();
        const result = { ...move, side, captured };
        if (game.status === 'over') result.over = { winner: game.winner, reason: game.reason };
        return result;
    }

    // 收回最後一步，回傳那一步；沒有可以收回的回傳 null
    function undo() {
        const last = game.history.pop();
        if (!last) return null;
        game.board = last.before;
        game.quiet = last.quietBefore;
        game.turn = last.side;
        refresh();
        return last;
    }

    const movesFrom = (from) => game.moves.filter((m) => m.from === from);
    const movable = () => [...new Set(game.moves.map((m) => m.from))];
    const mustCapture = () => game.moves.length > 0 && game.moves[0].captures.length > 0;
    const last = () => game.history.at(-1) ?? null;
    const count = () => countPieces(game.board);
    const toJSON = () => ({ ...(board && { board: start, turn }), moves: game.history.map((m) => m.path) });

    Object.assign(game, { play, undo, movesFrom, movable, mustCapture, last, count, toJSON });
    refresh();

    if (state) {
        if (!Array.isArray(state.moves)) throw new Error('存檔格式不符');
        for (const path of state.moves) if (!Array.isArray(path) || !play(path)) throw new Error('存檔裡有不合法的一步');
    }
    return game;
}
