// 五子棋的遊戲規則與電腦對手（純邏輯，不碰 DOM）
// 盤面是長度 225 的陣列（列優先，0 = 左上、224 = 右下），每格 null | 'B'（黑）| 'W'（白）
// 規則採自由式五子棋：黑先，橫、直、斜連成五子或以上就贏（長連也算），沒有禁手；下滿 225 格是和局

export const N = 15;
export const SIZE = N * N;
export const CENTER = indexOf(7, 7);

// 電腦對手的難度：easy 常漏看、normal 會攻會守但只看一步、hard 另外會算連續衝四的必勝並避開對方的必勝
export const LEVELS = ['easy', 'normal', 'hard'];

export const other = (mark) => (mark === 'B' ? 'W' : 'B');
export function indexOf(row, col) {
    return row * N + col;
}

// 座標名稱：行 A–O（左到右）、列 1–15（下到上），中央是 H8
const LETTERS = 'ABCDEFGHIJKLMNO';
export const cellName = (index) => `${LETTERS[index % N]}${N - Math.floor(index / N)}`;

// 四個方向：橫、直、右下斜、左下斜
export const DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
];

const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

// 經過 index 的連線（同色連續五子以上）；回傳 { cells, lines }，lines 是每條連線的 [起點, 終點]；沒有連線時 cells 為空
export function lineAt(board, index) {
    const mark = board[index];
    const cells = new Set();
    const lines = [];
    if (!mark) return { cells: [], lines };
    const r0 = Math.floor(index / N);
    const c0 = index % N;
    for (const [dr, dc] of DIRS) {
        const ends = [];
        const run = [index];
        for (const sign of [1, -1]) {
            let r = r0 + dr * sign;
            let c = c0 + dc * sign;
            while (inside(r, c) && board[indexOf(r, c)] === mark) {
                run.push(indexOf(r, c));
                r += dr * sign;
                c += dc * sign;
            }
            ends.push(indexOf(r - dr * sign, c - dc * sign));
        }
        if (run.length >= 5) {
            run.forEach((i) => cells.add(i));
            lines.push([Math.min(...ends), Math.max(...ends)]);
        }
    }
    return { cells: [...cells].sort((a, b) => a - b), lines };
}

// 有人連成五子時回傳 { mark, cells, lines }，否則 null
export function winnerOf(board) {
    for (let i = 0; i < SIZE; i++) {
        if (!board[i]) continue;
        const { cells, lines } = lineAt(board, i);
        if (cells.length) return { mark: board[i], cells, lines };
    }
    return null;
}

// ---------- 五格窗：所有可能連成五子的位置（橫 165、直 165、斜 2 × 121，共 572 組） ----------

export const WINDOWS = [];
for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
        for (const [dr, dc] of DIRS) {
            if (!inside(r + dr * 4, c + dc * 4)) continue;
            WINDOWS.push([0, 1, 2, 3, 4].map((k) => indexOf(r + dr * k, c + dc * k)));
        }
    }
}
const WINDOWS_OF = Array.from({ length: SIZE }, () => []);
WINDOWS.forEach((w, k) => w.forEach((i) => WINDOWS_OF[i].push(k)));

// 搜尋用的盤面：記錄每個窗裡黑 / 白各有幾子，落子與收回時只更新經過那一格的窗
function createState(board) {
    const work = [...board];
    const counts = { B: new Uint8Array(WINDOWS.length), W: new Uint8Array(WINDOWS.length) };
    WINDOWS.forEach((w, k) => w.forEach((i) => work[i] && counts[work[i]][k]++));
    // 收集格子時去除重複，並記錄每格出現在幾個窗裡
    const seen = new Uint32Array(SIZE);
    const hits = new Uint8Array(SIZE);
    let stamp = 0;

    // 窗裡 mark 有 need 子、對方沒有子時，窗裡的空格；出現在越多窗裡的排越前面（同時形成多個威脅的先試）
    function emptiesOf(mark, need, windowIds) {
        const own = counts[mark];
        const opp = counts[other(mark)];
        const out = [];
        stamp++;
        for (const k of windowIds) {
            if (own[k] !== need || opp[k] !== 0) continue;
            for (const i of WINDOWS[k]) {
                if (work[i] !== null) continue;
                if (seen[i] === stamp) hits[i]++;
                else {
                    seen[i] = stamp;
                    hits[i] = 1;
                    out.push(i);
                }
            }
        }
        return out.sort((a, b) => hits[b] - hits[a]);
    }

    const ALL = WINDOWS.map((_, k) => k);
    return {
        board: work,
        place(i, mark) {
            work[i] = mark;
            for (const k of WINDOWS_OF[i]) counts[mark][k]++;
        },
        remove(i) {
            const mark = work[i];
            work[i] = null;
            for (const k of WINDOWS_OF[i]) counts[mark][k]--;
        },
        // 下了就連成五子的空格
        fivePoints: (mark) => emptiesOf(mark, 4, ALL),
        // 剛下在 i 之後，經過 i 的窗裡新產生的連五點
        fivePointsThrough: (mark, i) => emptiesOf(mark, 4, WINDOWS_OF[i]),
        // 下了會形成「四」（再一子就連五）的空格
        fourMoves: (mark) => emptiesOf(mark, 3, ALL),
        // 剛下在 i 之後，經過 i 的窗裡下了會成四的空格（對方擋活三的位置）
        fourMovesThrough: (mark, i) => emptiesOf(mark, 3, WINDOWS_OF[i]),
        // 下了可能形成三的空格（還要再用棋型確認是不是活三）
        threeMoves: (mark) => emptiesOf(mark, 2, ALL),
    };
}

// ---------- 棋型判斷（給電腦評估每個空格） ----------

// 以 index 為中心、沿一個方向取前後各 4 格：1 = 自己（中心假設已下）、0 = 空、-1 = 對方或盤外
const line = new Int8Array(9);
function readLine(board, index, mark, dr, dc) {
    const r0 = Math.floor(index / N);
    const c0 = index % N;
    for (let k = -4; k <= 4; k++) {
        const r = r0 + dr * k;
        const c = c0 + dc * k;
        if (!inside(r, c)) line[k + 4] = -1;
        else if (k === 0) line[4] = 1;
        else {
            const cell = board[indexOf(r, c)];
            line[k + 4] = cell === null ? 0 : cell === mark ? 1 : -1;
        }
    }
}

// 包含中心的 5 格窗裡，補一子就連成五的空格（位元遮罩）
function completions() {
    let mask = 0;
    for (let s = 0; s <= 4; s++) {
        let own = 0;
        let empty = -1;
        let blocked = false;
        for (let k = s; k < s + 5; k++) {
            const v = line[k];
            if (v < 0) {
                blocked = true;
                break;
            }
            if (v === 1) own++;
            else empty = k;
        }
        if (!blocked && own === 4) mask |= 1 << empty;
    }
    return mask;
}

const bits = (mask) => {
    let n = 0;
    for (; mask; mask &= mask - 1) n++;
    return n;
};

const FIVE = 5;
const OPEN_FOUR = 4; // 活四：兩個連五點，擋不住
const FOUR = 3; // 衝四：一個連五點
const OPEN_THREE = 2; // 活三：再一子成活四
const THREE = 1; // 眠三：再一子成衝四

// 中心那一子在這個方向形成的棋型
function shapeOf() {
    let run = 1;
    for (let k = 5; k < 9 && line[k] === 1; k++) run++;
    for (let k = 3; k >= 0 && line[k] === 1; k--) run++;
    if (run >= 5) return FIVE;
    const done = completions();
    if (done) return bits(done) >= 2 ? OPEN_FOUR : FOUR;
    let shape = 0;
    for (let q = 0; q < 9; q++) {
        if (line[q] !== 0) continue;
        line[q] = 1;
        const next = completions();
        line[q] = 0;
        if (bits(next) >= 2) return OPEN_THREE;
        if (next) shape = THREE;
    }
    return shape;
}

// 兩子以下的棋型：包含中心、沒有對方棋子的 5 格窗越多、窗裡自己的子越多越好
const WINDOW_WEIGHT = [0, 1, 6, 30, 30, 30];
function looseScore() {
    let score = 0;
    for (let s = 0; s <= 4; s++) {
        let own = 0;
        let blocked = false;
        for (let k = s; k < s + 5; k++) {
            if (line[k] < 0) {
                blocked = true;
                break;
            }
            if (line[k] === 1) own++;
        }
        if (!blocked) score += WINDOW_WEIGHT[own];
    }
    return score;
}

export const SCORE = {
    FIVE: 1e9,
    OPEN_FOUR: 1e7, // 活四或雙四
    FOUR_THREE: 1e6, // 四三
    DOUBLE_THREE: 2e5, // 雙活三
    FOUR: 2500,
    OPEN_THREE: 3000,
    THREE: 400,
};

// mark 下在空格 index 的價值（只看這一子形成的棋型）
export function rateCell(board, index, mark) {
    let fours = 0;
    let openThrees = 0;
    let threes = 0;
    let loose = 0;
    for (const [dr, dc] of DIRS) {
        readLine(board, index, mark, dr, dc);
        const shape = shapeOf();
        if (shape === FIVE) return SCORE.FIVE;
        if (shape === OPEN_FOUR) fours += 2;
        else if (shape === FOUR) fours++;
        else if (shape === OPEN_THREE) openThrees++;
        else if (shape === THREE) threes++;
        loose += looseScore();
    }
    if (fours >= 2) return SCORE.OPEN_FOUR;
    if (fours && openThrees) return SCORE.FOUR_THREE;
    if (openThrees >= 2) return SCORE.DOUBLE_THREE;
    return fours * SCORE.FOUR + openThrees * SCORE.OPEN_THREE + threes * SCORE.THREE + loose;
}

// 值得考慮的空格：離已下的棋子兩格以內；空盤面只有天元
export function candidates(board) {
    const out = [];
    let any = false;
    for (let i = 0; i < SIZE; i++) {
        if (board[i] !== null) {
            any = true;
            continue;
        }
        const r0 = Math.floor(i / N);
        const c0 = i % N;
        let near = false;
        for (let r = Math.max(0, r0 - 2); r <= Math.min(N - 1, r0 + 2) && !near; r++) {
            for (let c = Math.max(0, c0 - 2); c <= Math.min(N - 1, c0 + 2); c++) {
                if (board[indexOf(r, c)] !== null) {
                    near = true;
                    break;
                }
            }
        }
        if (near) out.push(i);
    }
    return any ? out : [CENTER];
}

// 每個候選空格對 mark 的分數：進攻（自己下這裡）+ 防守（對方下這裡的價值，略打折讓同分時偏向進攻）
export function rateMoves(board, mark, defense = 0.9) {
    const opp = other(mark);
    return candidates(board)
        .map((index) => {
            const attack = rateCell(board, index, mark);
            const block = rateCell(board, index, opp);
            // 離中央近一點點加分，開局時不會往邊上跑
            const r = Math.floor(index / N);
            const c = index % N;
            const centrality = 14 - Math.abs(r - 7) - Math.abs(c - 7);
            return { index, attack, block, score: attack + block * defense + centrality * 0.1 };
        })
        .sort((a, b) => b.score - a.score);
}

// 這一子在某個方向形成活三
function makesOpenThree(board, index, mark) {
    for (const [dr, dc] of DIRS) {
        readLine(board, index, mark, dr, dc);
        if (shapeOf() === OPEN_THREE) return true;
    }
    return false;
}

// 連續威脅的必勝：mark 先下，每一步都是四（對方只能擋連五點）或活三（threes 為 true 時；對方只能擋在會成四的位置），
// 最後一定連五時回傳第一步，否則回傳 -1。budget：最多展開幾個節點，超過就當作找不到（只會漏掉，不會誤判）
function threatWin(board, mark, { depth, budget, threes }) {
    const state = createState(board);
    const opp = other(mark);
    let nodes = 0;
    function search(level) {
        if (++nodes > budget) return -1;
        const fives = state.fivePoints(mark);
        if (fives.length) return fives[0];
        // 對方已經有四：我的威脅擋不住對方連五
        if (level === 0 || state.fivePoints(opp).length) return -1;
        for (const p of state.fourMoves(mark)) {
            state.place(p, mark);
            const threats = state.fivePointsThrough(mark, p);
            let win = threats.length >= 2;
            if (threats.length === 1) {
                state.place(threats[0], opp);
                win = search(level - 1) !== -1;
                state.remove(threats[0]);
            }
            state.remove(p);
            if (win) return p;
            if (nodes > budget) return -1;
        }
        // 活三不是絕對先手：對方有四可以衝時就不算
        if (!threes || state.fourMoves(opp).length) return -1;
        for (const p of state.threeMoves(mark)) {
            if (!makesOpenThree(state.board, p, mark)) continue;
            state.place(p, mark);
            let win = true;
            for (const reply of state.fourMovesThrough(mark, p)) {
                state.place(reply, opp);
                win = search(level - 1) !== -1;
                state.remove(reply);
                if (!win) break;
            }
            state.remove(p);
            if (win) return p;
            if (nodes > budget) return -1;
        }
        return -1;
    }
    return search(depth);
}

// 只靠連續衝四（VCF）的必勝
export const findVcf = (board, mark, { depth = 10, budget = 1500 } = {}) =>
    threatWin(board, mark, { depth, budget, threes: false });

// 衝四與活三交替的必勝（VCT）
export const findVct = (board, mark, { depth = 6, budget = 1500 } = {}) =>
    threatWin(board, mark, { depth, budget, threes: true });

// hard 的搜尋範圍（節點上限決定最慢一步要多久）
const HARD = {
    vct: { depth: 6, budget: 1000 },
    tries: 10,
    guardVcf: { depth: 8, budget: 300 },
    guardVct: { depth: 4, budget: 120 },
};

const pick = (list, random) => list[Math.floor(random() * list.length)];

// 電腦這一步下在哪一格（index）；同樣好的步隨機挑一個，讓每局不一樣
export function chooseMove(board, mark, level = 'hard', random = Math.random) {
    if (winnerOf(board) || board.every((cell) => cell !== null)) return null;
    const opp = other(mark);

    if (level === 'easy') {
        // 能連五只有六成機會看到、對方要連五只有一半機會擋；其餘在前幾名裡隨便挑，防守看得很淡
        const rated = rateMoves(board, mark, 0.3);
        const win = rated.find((m) => m.attack >= SCORE.FIVE);
        if (win && random() < 0.6) return win.index;
        const block = rated.find((m) => m.block >= SCORE.FIVE);
        if (block && random() < 0.5) return block.index;
        const pool = rated.filter((m) => m.attack < SCORE.FIVE && m.block < SCORE.FIVE).slice(0, 6);
        return pick(pool.length ? pool : rated, random).index;
    }

    const rated = rateMoves(board, mark);
    const top = rated[0];
    // 能連五、或必須擋對方連五：不用想
    if (top.attack >= SCORE.FIVE || top.block >= SCORE.FIVE) return top.index;

    if (level === 'normal') {
        // 有明顯的威脅（四、活三以上）就照分數下；平穩的局面在差不多好的步裡隨機挑
        if (top.score >= SCORE.OPEN_THREE) return top.index;
        return pick(
            rated.filter((m) => m.score >= top.score * 0.85),
            random
        ).index;
    }

    // hard：自己有連續威脅的必勝就下
    const vcf = findVcf(board, mark);
    if (vcf !== -1) return vcf;
    if (top.attack >= SCORE.OPEN_FOUR) return top.index;
    const vct = findVct(board, mark, HARD.vct);
    if (vct !== -1) return vct;
    // 依分數試前幾名，跳過下了之後對方有連續威脅必勝的步
    const work = [...board];
    const safe = [];
    for (const move of rated.slice(0, HARD.tries)) {
        // 已經找到安全的步：之後只收集同分的步
        if (safe.length && move.score < safe[0].score) break;
        work[move.index] = mark;
        const danger =
            findVcf(work, opp, HARD.guardVcf) !== -1 || findVct(work, opp, HARD.guardVct) !== -1;
        work[move.index] = null;
        if (!danger) safe.push(move);
    }
    return safe.length ? pick(safe, random).index : top.index;
}

// mark 現在下一子就能連五的空格（給畫面朗讀「衝四」用）
export const fivePoints = (board, mark) => createState(board).fivePoints(mark);

// ---------- 一局 ----------

// state：存檔（toJSON 的結果），用來接著玩
export function createGomoku({ state } = {}) {
    const game = {
        board: Array(SIZE).fill(null),
        // 依序下過的格子
        moves: [],
        turn: 'B',
        // playing | won | draw
        status: 'playing',
        // 結束時 { mark, cells, lines }
        winner: null,
    };

    function refresh() {
        game.turn = game.moves.length % 2 === 0 ? 'B' : 'W';
        const last = game.moves.at(-1);
        const { cells, lines } = last === undefined ? { cells: [] } : lineAt(game.board, last);
        game.winner = cells.length ? { mark: game.board[last], cells, lines } : null;
        game.status = game.winner ? 'won' : game.moves.length === SIZE ? 'draw' : 'playing';
    }

    // 回傳 { index, mark, won?: { mark, cells, lines }, draw? }；不能下（已有棋子、已結束）時回傳 null
    function play(index) {
        if (game.status !== 'playing' || !Number.isInteger(index) || index < 0 || index >= SIZE) return null;
        if (game.board[index] !== null) return null;
        const mark = game.turn;
        game.board[index] = mark;
        game.moves.push(index);
        refresh();
        const result = { index, mark };
        if (game.status === 'won') result.won = game.winner;
        if (game.status === 'draw') result.draw = true;
        return result;
    }

    // 收回最後一步，回傳 { index, mark }；沒有可以收回的回傳 null
    function undo() {
        if (game.moves.length === 0) return null;
        const index = game.moves.pop();
        const mark = game.board[index];
        game.board[index] = null;
        refresh();
        return { index, mark };
    }

    const lastIndex = () => game.moves.at(-1) ?? -1;
    const toJSON = () => ({ moves: [...game.moves] });

    Object.assign(game, { play, undo, lastIndex, toJSON });

    if (state) {
        if (!Array.isArray(state.moves)) throw new Error('存檔格式不符');
        for (const index of state.moves) if (!play(index)) throw new Error('存檔裡有不合法的一步');
    }
    return game;
}
