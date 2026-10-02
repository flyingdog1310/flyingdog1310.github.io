// 西洋棋的遊戲規則與電腦對手（純邏輯，不碰 DOM）
// 盤面 index 0 = a8、7 = h8、56 = a1、63 = h1（列優先，白方在下方）；對外的棋子用 FEN 字母：
// 白 'P' 'N' 'B' 'R' 'Q' 'K'、黑 'p' 'n' 'b' 'r' 'q' 'k'，空格是 null；雙方是 'w' / 'b'
// 規則：完整的合法步（不能讓自己的王被將、入堡（王不能在被將時、經過或停在被攻擊的格子）、吃過路兵、升變）；
// 將死、逼和，以及三種自動和局：同一局面第三次出現、50 回合（100 手）沒有吃子也沒有動兵、雙方都不可能將死對方

export const N = 8;
export const SIZE = 64;
export const LEVELS = ['easy', 'normal', 'hard'];
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// 多少手（半回合）沒有吃子也沒有動兵算和局
export const FIFTY_LIMIT = 100;

export const other = (side) => (side === 'w' ? 'b' : 'w');
export const sideOf = (piece) => (piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null);
// 棋子種類（小寫字母）
export const typeOf = (piece) => (piece ? piece.toLowerCase() : null);
export const squareName = (i) => `${'abcdefgh'[i & 7]}${N - (i >> 3)}`;
export const squareIndex = (name) => (N - Number(name[1])) * N + 'abcdefgh'.indexOf(name[0]);
export const isLight = (i) => ((i >> 3) + (i & 7)) % 2 === 0;

// ---------- 內部表示：棋子用整數（1–6 = 兵馬象車后王，黑方加 8），走法也是一個整數 ----------

const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;
const BLACK = 8;
const CHARS = '.PNBRQK..pnbrqk';
const CODE = Object.fromEntries([...'PNBRQKpnbrqk'].map((ch) => [ch, CHARS.indexOf(ch)]));
const TYPE_CHAR = '.pnbrqk';

// 走法：from | to << 6 | 升變的種類 << 12 | 種類 << 15
const DOUBLE = 1;
const EN_PASSANT = 2;
const CASTLE = 3;
const moveOf = (from, to, promo = 0, flag = 0) => from | (to << 6) | (promo << 12) | (flag << 15);
const fromOf = (m) => m & 63;
const toOf = (m) => (m >> 6) & 63;
const promoOf = (m) => (m >> 12) & 7;
const flagOf = (m) => m >> 15;

const rowOf = (i) => i >> 3;
const colOf = (i) => i & 7;
const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

// 前 4 個是直線方向、後 4 個是斜線方向
const DIRS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
];
const KNIGHT_STEPS = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
];
// 預先算好每一格的馬步、王步、八個方向的射線，以及「哪些格子的兵會攻擊這一格」
const KNIGHT_TO = [];
const KING_TO = [];
const RAYS = [];
// PAWN_FROM[color][sq]：color 方的兵站在哪些格子會攻擊 sq；PAWN_HITS[color][sq]：站在 sq 的兵攻擊哪些格子
const PAWN_FROM = [[], []];
const PAWN_HITS = [[], []];
for (let i = 0; i < SIZE; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    const jump = (steps) => steps.filter(([dr, dc]) => inside(r + dr, c + dc)).map(([dr, dc]) => (r + dr) * N + c + dc);
    KNIGHT_TO.push(jump(KNIGHT_STEPS));
    KING_TO.push(jump(DIRS));
    RAYS.push(
        DIRS.map(([dr, dc]) => {
            const ray = [];
            for (let k = 1; inside(r + dr * k, c + dc * k); k++) ray.push((r + dr * k) * N + c + dc * k);
            return ray;
        })
    );
    // 白兵往上（row - 1）攻擊、黑兵往下
    PAWN_HITS[0].push(
        jump([
            [-1, -1],
            [-1, 1],
        ])
    );
    PAWN_HITS[1].push(
        jump([
            [1, -1],
            [1, 1],
        ])
    );
    PAWN_FROM[0].push(
        jump([
            [1, -1],
            [1, 1],
        ])
    );
    PAWN_FROM[1].push(
        jump([
            [-1, -1],
            [-1, 1],
        ])
    );
}

// 入堡權：1 白短、2 白長、4 黑短、8 黑長；王或車離開原位（或車被吃）就失去
const CASTLE_MASK = new Int8Array(SIZE).fill(15);
CASTLE_MASK[60] = 15 & ~3;
CASTLE_MASK[63] = 15 & ~1;
CASTLE_MASK[56] = 15 & ~2;
CASTLE_MASK[4] = 15 & ~12;
CASTLE_MASK[7] = 15 & ~4;
CASTLE_MASK[0] = 15 & ~8;

// Zobrist 雜湊：兩個 32 位元的值合起來當局面的指紋（固定種子，每次都一樣）
let zseed = 0x9e3779b9;
function zrand() {
    zseed = (zseed + 0x6d2b79f5) | 0;
    let t = Math.imul(zseed ^ (zseed >>> 15), 1 | zseed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
}
const Z_LO = Int32Array.from({ length: 16 * SIZE }, zrand);
const Z_HI = Int32Array.from({ length: 16 * SIZE }, zrand);
const Z_CASTLE_LO = Int32Array.from({ length: 16 }, zrand);
const Z_CASTLE_HI = Int32Array.from({ length: 16 }, zrand);
const Z_EP_LO = Int32Array.from({ length: 8 }, zrand);
const Z_EP_HI = Int32Array.from({ length: 8 }, zrand);
const Z_SIDE_LO = zrand();
const Z_SIDE_HI = zrand();

class Position {
    constructor() {
        this.board = new Int8Array(SIZE);
        // 0 白、1 黑
        this.side = 0;
        this.castle = 0;
        // 吃過路兵的目標格（只在真的有兵可以吃的時候設定），沒有是 -1
        this.ep = -1;
        this.half = 0;
        this.full = 1;
        this.kings = [-1, -1];
        this.lo = 0;
        this.hi = 0;
        // make / unmake 用的堆疊：每一步存 7 個值
        this.stack = [];
        // 每一步之前的雜湊（lo, hi 交錯），用來判斷重複局面
        this.hist = [];
    }

    static fromFEN(fen) {
        const pos = new Position();
        const [placement, side = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
        const rows = placement.split('/');
        if (rows.length !== N) throw new Error(`FEN 格式不符：${fen}`);
        rows.forEach((row, r) => {
            let c = 0;
            for (const ch of row) {
                if (/[1-8]/.test(ch)) c += Number(ch);
                else if (CODE[ch]) pos.put(r * N + c++, CODE[ch]);
                else throw new Error(`FEN 格式不符：${fen}`);
            }
            if (c !== N) throw new Error(`FEN 格式不符：${fen}`);
        });
        if (pos.kings[0] < 0 || pos.kings[1] < 0) throw new Error('雙方都要有王');
        if (side === 'b') {
            pos.side = 1;
            pos.lo ^= Z_SIDE_LO;
            pos.hi ^= Z_SIDE_HI;
        }
        let rights = 0;
        if (castling.includes('K') && pos.board[60] === KING && pos.board[63] === ROOK) rights |= 1;
        if (castling.includes('Q') && pos.board[60] === KING && pos.board[56] === ROOK) rights |= 2;
        if (castling.includes('k') && pos.board[4] === KING + BLACK && pos.board[7] === ROOK + BLACK) rights |= 4;
        if (castling.includes('q') && pos.board[4] === KING + BLACK && pos.board[0] === ROOK + BLACK) rights |= 8;
        pos.setCastle(rights);
        if (ep !== '-') pos.setEp(squareIndex(ep));
        pos.half = Number(half) || 0;
        pos.full = Number(full) || 1;
        return pos;
    }

    clone() {
        const pos = new Position();
        pos.board.set(this.board);
        Object.assign(pos, {
            side: this.side,
            castle: this.castle,
            ep: this.ep,
            half: this.half,
            full: this.full,
            kings: [...this.kings],
            lo: this.lo,
            hi: this.hi,
            hist: [...this.hist],
        });
        return pos;
    }

    fen() {
        const rows = [];
        for (let r = 0; r < N; r++) {
            let text = '';
            let empty = 0;
            for (let c = 0; c < N; c++) {
                const code = this.board[r * N + c];
                if (!code) empty++;
                else {
                    if (empty) text += empty;
                    empty = 0;
                    text += CHARS[code];
                }
            }
            rows.push(empty ? text + empty : text);
        }
        const rights = ['K', 'Q', 'k', 'q'].filter((_, k) => this.castle & (1 << k)).join('') || '-';
        const ep = this.ep >= 0 ? squareName(this.ep) : '-';
        return `${rows.join('/')} ${this.side ? 'b' : 'w'} ${rights} ${ep} ${this.half} ${this.full}`;
    }

    put(sq, code) {
        this.board[sq] = code;
        this.lo ^= Z_LO[code * SIZE + sq];
        this.hi ^= Z_HI[code * SIZE + sq];
        if ((code & 7) === KING) this.kings[code >> 3] = sq;
    }

    remove(sq) {
        const code = this.board[sq];
        this.board[sq] = 0;
        this.lo ^= Z_LO[code * SIZE + sq];
        this.hi ^= Z_HI[code * SIZE + sq];
    }

    setCastle(rights) {
        this.lo ^= Z_CASTLE_LO[this.castle] ^ Z_CASTLE_LO[rights];
        this.hi ^= Z_CASTLE_HI[this.castle] ^ Z_CASTLE_HI[rights];
        this.castle = rights;
    }

    // 只有對方真的有兵站在旁邊時才記錄吃過路兵的目標格（重複局面才比得準）
    setEp(sq) {
        if (this.ep >= 0) {
            this.lo ^= Z_EP_LO[this.ep & 7];
            this.hi ^= Z_EP_HI[this.ep & 7];
        }
        this.ep = -1;
        if (sq < 0) return;
        // 輪到的一方（side）的兵能不能吃到 sq
        const pawn = PAWN + (this.side ? BLACK : 0);
        if (!PAWN_FROM[this.side][sq].some((p) => this.board[p] === pawn)) return;
        this.ep = sq;
        this.lo ^= Z_EP_LO[sq & 7];
        this.hi ^= Z_EP_HI[sq & 7];
    }

    // sq 有沒有被 by 方（0 白、1 黑）攻擊
    attacked(sq, by) {
        const b = this.board;
        const add = by ? BLACK : 0;
        for (const p of PAWN_FROM[by][sq]) if (b[p] === PAWN + add) return true;
        for (const p of KNIGHT_TO[sq]) if (b[p] === KNIGHT + add) return true;
        for (const p of KING_TO[sq]) if (b[p] === KING + add) return true;
        const rays = RAYS[sq];
        for (let d = 0; d < 8; d++) {
            const ray = rays[d];
            const slider = d < 4 ? ROOK + add : BISHOP + add;
            for (let k = 0; k < ray.length; k++) {
                const code = b[ray[k]];
                if (!code) continue;
                if (code === slider || code === QUEEN + add) return true;
                break;
            }
        }
        return false;
    }

    inCheck(side = this.side) {
        return this.attacked(this.kings[side], side ^ 1);
    }

    // 擬合法步（還沒檢查會不會讓自己的王被將）；capturesOnly 時只產生吃子與升變（給靜態搜尋用）
    generate(list, capturesOnly = false) {
        const b = this.board;
        const us = this.side;
        const them = us ^ 1;
        const add = us ? BLACK : 0;
        for (let from = 0; from < SIZE; from++) {
            const code = b[from];
            if (!code || code >> 3 !== us) continue;
            const type = code & 7;
            if (type === PAWN) {
                const dir = us ? N : -N;
                const to = from + dir;
                const lastRow = us ? 7 : 0;
                const promote = rowOf(to) === lastRow;
                if (!b[to] && (!capturesOnly || promote)) {
                    if (promote) for (let p = QUEEN; p >= KNIGHT; p--) list.push(moveOf(from, to, p));
                    else {
                        list.push(moveOf(from, to));
                        const startRow = us ? 1 : 6;
                        if (!capturesOnly && rowOf(from) === startRow && !b[to + dir]) {
                            list.push(moveOf(from, to + dir, 0, DOUBLE));
                        }
                    }
                }
                for (const hit of PAWN_HITS[us][from]) {
                    if (hit === this.ep) list.push(moveOf(from, hit, 0, EN_PASSANT));
                    else if (b[hit] && b[hit] >> 3 === them) {
                        if (promote) for (let p = QUEEN; p >= KNIGHT; p--) list.push(moveOf(from, hit, p));
                        else list.push(moveOf(from, hit));
                    }
                }
            } else if (type === KNIGHT || type === KING) {
                const targets = type === KNIGHT ? KNIGHT_TO[from] : KING_TO[from];
                for (const to of targets) {
                    const t = b[to];
                    if (t ? t >> 3 === them : !capturesOnly) list.push(moveOf(from, to));
                }
            } else {
                const first = type === BISHOP ? 4 : 0;
                const last = type === ROOK ? 4 : 8;
                for (let d = first; d < last; d++) {
                    const ray = RAYS[from][d];
                    for (let k = 0; k < ray.length; k++) {
                        const to = ray[k];
                        const t = b[to];
                        if (!t) {
                            if (!capturesOnly) list.push(moveOf(from, to));
                            continue;
                        }
                        if (t >> 3 === them) list.push(moveOf(from, to));
                        break;
                    }
                }
            }
        }
        // 入堡：中間要空、王不能在被將時入堡、也不能經過被攻擊的格子（停的格子由 make 的合法檢查負責）
        if (!capturesOnly && this.castle) {
            const home = us ? 4 : 60;
            if (b[home] === KING + add && !this.attacked(home, them)) {
                const kingSide = us ? 4 : 1;
                const queenSide = us ? 8 : 2;
                if (this.castle & kingSide && !b[home + 1] && !b[home + 2] && !this.attacked(home + 1, them)) {
                    list.push(moveOf(home, home + 2, 0, CASTLE));
                }
                if (
                    this.castle & queenSide &&
                    !b[home - 1] &&
                    !b[home - 2] &&
                    !b[home - 3] &&
                    !this.attacked(home - 1, them)
                ) {
                    list.push(moveOf(home, home - 2, 0, CASTLE));
                }
            }
        }
        return list;
    }

    // 走一步；回傳這一步合不合法（自己的王有沒有被將）。不論合不合法都要用 unmake 收回
    make(m) {
        const from = fromOf(m);
        const to = toOf(m);
        const flag = flagOf(m);
        const promo = promoOf(m);
        const b = this.board;
        const us = this.side;
        const code = b[from];
        const capSq = flag === EN_PASSANT ? to + (us ? -N : N) : to;
        const captured = b[capSq];
        this.hist.push(this.lo, this.hi);
        this.stack.push(m, captured, this.castle, this.ep, this.half, this.lo, this.hi);

        if (captured) this.remove(capSq);
        this.remove(from);
        this.put(to, promo ? promo + (us ? BLACK : 0) : code);
        if (flag === CASTLE) {
            const rookFrom = to > from ? to + 1 : to - 2;
            const rookTo = to > from ? to - 1 : to + 1;
            const rook = b[rookFrom];
            this.remove(rookFrom);
            this.put(rookTo, rook);
        }
        this.setCastle(this.castle & CASTLE_MASK[from] & CASTLE_MASK[to]);
        this.half = captured || (code & 7) === PAWN ? 0 : this.half + 1;
        if (us) this.full++;
        this.side = us ^ 1;
        this.lo ^= Z_SIDE_LO;
        this.hi ^= Z_SIDE_HI;
        this.setEp(flag === DOUBLE ? (from + to) >> 1 : -1);
        return !this.attacked(this.kings[us], us ^ 1);
    }

    unmake() {
        const s = this.stack;
        const hi = s.pop();
        const lo = s.pop();
        const half = s.pop();
        const ep = s.pop();
        const castle = s.pop();
        const captured = s.pop();
        const m = s.pop();
        this.hist.length -= 2;
        const from = fromOf(m);
        const to = toOf(m);
        const flag = flagOf(m);
        const b = this.board;
        this.side ^= 1;
        const us = this.side;
        if (us) this.full--;
        const moved = promoOf(m) ? PAWN + (us ? BLACK : 0) : b[to];
        b[to] = 0;
        b[from] = moved;
        if ((moved & 7) === KING) this.kings[us] = from;
        if (flag === CASTLE) {
            const rookFrom = to > from ? to + 1 : to - 2;
            const rookTo = to > from ? to - 1 : to + 1;
            b[rookFrom] = b[rookTo];
            b[rookTo] = 0;
        }
        if (captured) b[flag === EN_PASSANT ? to + (us ? -N : N) : to] = captured;
        this.castle = castle;
        this.ep = ep;
        this.half = half;
        this.lo = lo;
        this.hi = hi;
    }

    legalMoves() {
        const out = [];
        for (const m of this.generate([])) {
            if (this.make(m)) out.push(m);
            this.unmake();
        }
        return out;
    }

    // 目前的局面在「上一次吃子或動兵之後」出現過幾次（不含這一次）
    repetitions(stopAtFirst = false) {
        const h = this.hist;
        let count = 0;
        for (let k = h.length - 4, n = this.half - 2; k >= 0 && n >= 0; k -= 4, n -= 2) {
            if (h[k] === this.lo && h[k + 1] === this.hi) {
                count++;
                if (stopAtFirst) break;
            }
        }
        return count;
    }

    // 雙方都不可能將死對方：只剩王、王 + 一個輕子、或只剩同色格的象
    insufficient() {
        let minors = 0;
        let knights = 0;
        let bishopColors = 0;
        for (let i = 0; i < SIZE; i++) {
            const type = this.board[i] & 7;
            if (!type || type === KING) continue;
            if (type === PAWN || type === ROOK || type === QUEEN) return false;
            minors++;
            if (type === KNIGHT) knights++;
            else bishopColors |= isLight(i) ? 1 : 2;
        }
        if (minors <= 1) return true;
        return knights === 0 && bishopColors !== 3;
    }
}

// ---------- 對外的走法物件 ----------

const CASTLE_SIDE = (m) => (toOf(m) > fromOf(m) ? 'king' : 'queen');

function publicMove(pos, m) {
    const from = fromOf(m);
    const to = toOf(m);
    const flag = flagOf(m);
    const code = pos.board[from];
    const capSq = flag === EN_PASSANT ? to + (pos.side ? -N : N) : to;
    const captured = pos.board[capSq];
    const promo = promoOf(m);
    return {
        from,
        to,
        piece: CHARS[code],
        captured: captured ? CHARS[captured] : null,
        // 被吃的子在哪一格（吃過路兵時不是落點）
        capturedAt: captured ? capSq : -1,
        promotion: promo ? TYPE_CHAR[promo] : null,
        castle: flag === CASTLE ? CASTLE_SIDE(m) : null,
        enPassant: flag === EN_PASSANT,
        uci: `${squareName(from)}${squareName(to)}${promo ? TYPE_CHAR[promo] : ''}`,
        code: m,
    };
}

// 標準代數記譜（SAN）：Nf3、exd5、O-O、e8=Q+、Qxf7#；legal 是這個局面的所有合法步
function sanOf(pos, m, legal) {
    const from = fromOf(m);
    const to = toOf(m);
    const flag = flagOf(m);
    const type = pos.board[from] & 7;
    const capture = flag === EN_PASSANT || pos.board[to] !== 0;
    let san;
    if (flag === CASTLE) san = CASTLE_SIDE(m) === 'king' ? 'O-O' : 'O-O-O';
    else if (type === PAWN) {
        san = (capture ? `${'abcdefgh'[colOf(from)]}x` : '') + squareName(to);
        if (promoOf(m)) san += `=${TYPE_CHAR[promoOf(m)].toUpperCase()}`;
    } else {
        // 同種的其他棋子也能走到同一格時，加上出發的直行 / 橫列
        const rivals = legal.filter((o) => toOf(o) === to && fromOf(o) !== from && (pos.board[fromOf(o)] & 7) === type);
        let hint = '';
        if (rivals.length) {
            if (rivals.every((o) => colOf(fromOf(o)) !== colOf(from))) hint = 'abcdefgh'[colOf(from)];
            else if (rivals.every((o) => rowOf(fromOf(o)) !== rowOf(from))) hint = String(N - rowOf(from));
            else hint = squareName(from);
        }
        san = TYPE_CHAR[type].toUpperCase() + hint + (capture ? 'x' : '') + squareName(to);
    }
    pos.make(m);
    if (pos.inCheck()) san += pos.legalMoves().length ? '+' : '#';
    pos.unmake();
    return san;
}

// 從 FEN 算出所有合法步（測試與工具用）
export function legalMoves(fen) {
    const pos = Position.fromFEN(fen);
    const legal = pos.legalMoves();
    return legal.map((m) => ({ ...publicMove(pos, m), san: sanOf(pos, m, legal) }));
}

// perft：往下 depth 手的所有合法走法數（驗證走法產生器用）
export function perft(fen, depth) {
    const pos = Position.fromFEN(fen);
    const walk = (d) => {
        if (d === 0) return 1;
        let count = 0;
        for (const m of pos.generate([])) {
            if (pos.make(m)) count += d === 1 ? 1 : walk(d - 1);
            pos.unmake();
        }
        return count;
    };
    return walk(depth);
}

// FEN 的盤面部分轉成長度 64 的陣列
function boardOf(pos) {
    return Array.from(pos.board, (code) => (code ? CHARS[code] : null));
}

// ---------- 電腦對手：negamax + alpha-beta、逐層加深、置換表、靜態搜尋（吃子算到底） ----------

const VALUE = [0, 100, 320, 330, 500, 900, 0];
// 位置分數（白方角度，index 0 = a8）；黑方用上下翻轉的格子查表
// prettier-ignore
const PST = [
    [],
    [
        0, 0, 0, 0, 0, 0, 0, 0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5, 5, 10, 25, 25, 10, 5, 5,
        0, 0, 0, 20, 20, 0, 0, 0,
        5, -5, -10, 0, 0, -10, -5, 5,
        5, 10, 10, -20, -20, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0,
    ],
    [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, 10, 10, 10, 10, 5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        0, 0, 0, 5, 5, 0, 0, 0,
    ],
    [
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
        -10, 5, 5, 5, 5, 5, 0, -10,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    // 王：中盤躲在入堡後的角落
    [
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -10, -20, -20, -20, -20, -20, -20, -10,
        20, 20, -5, -10, -10, -5, 20, 20,
        20, 30, 10, 0, 0, 10, 30, 20,
    ],
];
// 王：殘局往中央走
// prettier-ignore
const KING_END = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
];
// 中盤的程度：馬象 1、車 2、后 4，開局是 24
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const CENTER_DIST = Array.from(
    { length: SIZE },
    (_, i) => Math.max(3 - rowOf(i), rowOf(i) - 4, 0) + Math.max(3 - colOf(i), colOf(i) - 4, 0)
);

// 以輪到的一方的角度評估局面
function evaluateCodes(pos) {
    const b = pos.board;
    let score = 0;
    let phase = 0;
    let material = [0, 0];
    const bishops = [0, 0];
    let kingMid = 0;
    let kingEnd = 0;
    for (let i = 0; i < SIZE; i++) {
        const code = b[i];
        if (!code) continue;
        const type = code & 7;
        const color = code >> 3;
        const sq = color ? i ^ 56 : i;
        const sign = color ? -1 : 1;
        if (type === KING) {
            kingMid += sign * PST[KING][sq];
            kingEnd += sign * KING_END[sq];
            continue;
        }
        phase += PHASE[type];
        material[color] += VALUE[type];
        if (type === BISHOP) bishops[color]++;
        score += sign * (VALUE[type] + PST[type][sq]);
    }
    phase = Math.min(phase, 24);
    score += Math.round((kingMid * phase + kingEnd * (24 - phase)) / 24);
    // 還保有入堡權比較好（中盤才算）：不然電腦會隨便動王或車
    const rights = (pos.castle & 1) + ((pos.castle >> 1) & 1) - ((pos.castle >> 2) & 1) - ((pos.castle >> 3) & 1);
    score += Math.round((rights * 12 * phase) / 24);
    if (bishops[0] >= 2) score += 30;
    if (bishops[1] >= 2) score -= 30;
    // 殘局領先時：把對方的王趕到角落、自己的王靠過去（不然王 + 后對單王也將不死）
    const lead = material[0] - material[1];
    if (phase <= 8 && Math.abs(lead) >= 300) {
        const strong = lead > 0 ? 0 : 1;
        const weakKing = pos.kings[strong ^ 1];
        const strongKing = pos.kings[strong];
        const between = Math.abs(rowOf(weakKing) - rowOf(strongKing)) + Math.abs(colOf(weakKing) - colOf(strongKing));
        const mop = CENTER_DIST[weakKing] * 10 + (14 - between) * 4;
        score += strong ? -mop : mop;
    }
    return pos.side ? -score : score;
}

// 以 side 的角度評估 FEN 的局面（測試用）
export function evaluate(fen) {
    return evaluateCodes(Position.fromFEN(fen));
}

const MATE = 100000;
const INF = 1e9;
const MAX_PLY = 64;
// 置換表：2^16 格
const TT_BITS = 16;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_LO = new Int32Array(TT_SIZE);
const TT_HI = new Int32Array(TT_SIZE);
const TT_MOVE = new Int32Array(TT_SIZE);
const TT_SCORE = new Int32Array(TT_SIZE);
const TT_DEPTH = new Int8Array(TT_SIZE);
// 0 空、1 準確、2 下限（beta 剪枝）、3 上限
const TT_FLAG = new Int8Array(TT_SIZE);
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;

class Abort extends Error {}

// 搜尋的設定：depth 是往前看幾手，nodes 是節點上限（超過就用前一層算完的結果）
export const LIMITS = {
    easy: { depth: 2, nodes: 3000 },
    normal: { depth: 3, nodes: 12000 },
    hard: { depth: 12, nodes: 50000 },
};
// 各難度在差不多好的步裡隨機挑的範圍（分數，100 = 一個兵）
const WINDOW = { easy: 150, normal: 18, hard: 0 };

function search(pos) {
    let nodes = 0;
    let limit = Infinity;
    const killers = new Int32Array(MAX_PLY * 2 + 4);
    const history = new Int32Array(SIZE * SIZE);
    TT_FLAG.fill(0);

    // 走法排序的分數：置換表的步最先，再來吃子（被吃的越值錢、吃的越便宜越先）、升變、殺手步、歷史分數
    function scoreMoves(list, ttMove, ply) {
        const b = pos.board;
        const scores = new Int32Array(list.length);
        for (let k = 0; k < list.length; k++) {
            const m = list[k];
            if (m === ttMove) scores[k] = 1 << 30;
            else {
                const victim = flagOf(m) === EN_PASSANT ? PAWN : b[toOf(m)] & 7;
                if (victim) scores[k] = (1 << 24) + VALUE[victim] * 16 - (b[fromOf(m)] & 7);
                else if (promoOf(m)) scores[k] = (1 << 23) + promoOf(m);
                else if (m === killers[ply * 2]) scores[k] = 1 << 22;
                else if (m === killers[ply * 2 + 1]) scores[k] = (1 << 22) - 1;
                else scores[k] = history[fromOf(m) * SIZE + toOf(m)];
            }
        }
        return scores;
    }

    // 選擇排序：每次挑剩下分數最高的步（剪枝時後面的就不用排了）
    function pickNext(list, scores, k) {
        let best = k;
        for (let j = k + 1; j < list.length; j++) if (scores[j] > scores[best]) best = j;
        if (best !== k) {
            const m = list[k];
            list[k] = list[best];
            list[best] = m;
            const s = scores[k];
            scores[k] = scores[best];
            scores[best] = s;
        }
        return list[k];
    }

    function quiesce(alpha, beta, ply) {
        if (++nodes > limit) throw new Abort();
        const stand = evaluateCodes(pos);
        if (stand >= beta || ply >= MAX_PLY) return stand;
        if (stand > alpha) alpha = stand;
        const list = pos.generate([], true);
        const scores = scoreMoves(list, 0, ply);
        for (let k = 0; k < list.length; k++) {
            const m = pickNext(list, scores, k);
            if (!pos.make(m)) {
                pos.unmake();
                continue;
            }
            const score = -quiesce(-beta, -alpha, ply + 1);
            pos.unmake();
            if (score >= beta) return score;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    function negamax(depth, alpha, beta, ply) {
        if (++nodes > limit) throw new Abort();
        if (pos.half >= FIFTY_LIMIT || pos.repetitions(true) > 0) return 0;
        const check = pos.inCheck();
        // 被將時多算一層（不然看不到被將死）
        if (check && ply < MAX_PLY) depth++;
        if (depth <= 0 || ply >= MAX_PLY) return quiesce(alpha, beta, ply);

        const slot = pos.lo & TT_MASK;
        let ttMove = 0;
        if (TT_FLAG[slot] && TT_LO[slot] === pos.lo && TT_HI[slot] === pos.hi) {
            ttMove = TT_MOVE[slot];
            if (TT_DEPTH[slot] >= depth) {
                let s = TT_SCORE[slot];
                if (s > MATE - 1000) s -= ply;
                else if (s < -MATE + 1000) s += ply;
                const flag = TT_FLAG[slot];
                if (flag === EXACT || (flag === LOWER && s >= beta) || (flag === UPPER && s <= alpha)) return s;
            }
        }

        const list = pos.generate([]);
        const scores = scoreMoves(list, ttMove, ply);
        const startAlpha = alpha;
        let best = -INF;
        let bestMove = 0;
        let legal = 0;
        for (let k = 0; k < list.length; k++) {
            const m = pickNext(list, scores, k);
            if (!pos.make(m)) {
                pos.unmake();
                continue;
            }
            legal++;
            const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
            pos.unmake();
            if (score > best) {
                best = score;
                bestMove = m;
            }
            if (score > alpha) alpha = score;
            if (alpha >= beta) {
                // 不吃子的步造成剪枝：記成殺手步與歷史分數，之後先試
                const quiet = !pos.board[toOf(m)] && flagOf(m) !== EN_PASSANT && !promoOf(m);
                if (quiet) {
                    if (killers[ply * 2] !== m) {
                        killers[ply * 2 + 1] = killers[ply * 2];
                        killers[ply * 2] = m;
                    }
                    history[fromOf(m) * SIZE + toOf(m)] += depth * depth;
                }
                break;
            }
        }
        if (legal === 0) return check ? -MATE + ply : 0;

        let stored = best;
        if (stored > MATE - 1000) stored += ply;
        else if (stored < -MATE + 1000) stored -= ply;
        TT_LO[slot] = pos.lo;
        TT_HI[slot] = pos.hi;
        TT_MOVE[slot] = bestMove;
        TT_SCORE[slot] = stored;
        TT_DEPTH[slot] = depth;
        TT_FLAG[slot] = best >= beta ? LOWER : best > startAlpha ? EXACT : UPPER;
        return best;
    }

    return {
        get nodes() {
            return nodes;
        },
        // 根節點每一步的分數（由高到低）；和最好的步差在 window 以內的步分數算準，其他步只知道比較差
        root(moves, depth, window = 0) {
            const out = [];
            let alpha = -INF;
            for (const m of moves) {
                pos.make(m);
                const score = -negamax(depth - 1, -INF, -(alpha - window - 1), 1);
                pos.unmake();
                out.push({ m, score });
                if (score > alpha) alpha = score;
            }
            return out.sort((a, b) => b.score - a.score);
        },
        // 有節點上限（所有呼叫合計）的搜尋：超過時中止並回傳 null（局面要復原，因為中止時還停在半路）
        run(fn, maxNodes) {
            limit = maxNodes;
            const depthBefore = pos.stack.length;
            try {
                return fn();
            } catch (error) {
                if (error instanceof Abort) {
                    while (pos.stack.length > depthBefore) pos.unmake();
                    return null;
                }
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

// 電腦選一步：source 是 createChess 的遊戲物件（會一起考慮重複局面）或 FEN；
// 回傳合法步物件（同 game.moves 的格式，可以直接傳給 game.play）；沒有步可走時回傳 null
export function chooseMove(source, level = 'normal', { random = Math.random } = {}) {
    const pos = typeof source === 'string' ? Position.fromFEN(source) : source.position();
    const legal = pos.legalMoves();
    if (legal.length === 0) return null;
    const result = (m) => publicMove(pos, m);
    if (legal.length === 1) return result(legal[0]);
    if (!LIMITS[level]) level = 'normal';
    // 初學者：偶爾隨便走
    if (level === 'easy' && random() < 0.2) return result(pick(legal, random));

    const { depth, nodes } = LIMITS[level];
    // 開局前幾步 hard 也在差不多好的步裡隨機挑，每局才不會都一樣
    const window = level === 'hard' && pos.full <= 4 ? 15 : WINDOW[level];
    const engine = search(pos);
    // 第一層一定算完，之後逐層加深；上一層最好的步先試
    let best = engine.root(legal, 1, window);
    for (let d = 2; d <= depth; d++) {
        const first = best[0].m;
        const ordered = [first, ...best.slice(1).map((s) => s.m)];
        const scored = engine.run(() => engine.root(ordered, d, window), nodes);
        if (!scored) break;
        best = scored;
        // 已經找到將死（或被將死）就不用再算更深
        if (Math.abs(best[0].score) > MATE - 1000) break;
    }
    const top = best[0].score;
    // 大幅領先時 normal 不再隨機挑（不然殘局一直繞圈，將不死）
    const spread = level === 'normal' && top >= 400 ? 0 : window;
    return result(
        pick(
            best.filter((s) => s.score >= top - spread),
            random
        ).m
    );
}

// ---------- 一局 ----------

// state：存檔（toJSON 的結果），用來接著玩；fen：從指定的局面開始（測試與示意盤面用）
export function createChess({ state, fen = null } = {}) {
    if (state && typeof state === 'object' && state.fen) fen = state.fen;
    const startFen = fen ?? START_FEN;
    const pos = Position.fromFEN(startFen);
    // 每一步之前的合法步（整數），算 SAN 用
    let legal = [];
    const game = {
        board: [],
        turn: 'w',
        // 依序走過的步：{ ...move, side, san, check, mate, fen（走之後的局面） }
        history: [],
        // playing | over
        status: 'playing',
        // 結束時 'w' | 'b' | null（和局）
        winner: null,
        // 結束的原因：checkmate | stalemate | repetition | fifty | material
        reason: null,
        // 目前輪到的一方的合法步
        moves: [],
        // 被將軍的王在哪一格（沒有是 -1）
        check: -1,
        // 連續幾手沒有吃子也沒有動兵
        halfmove: 0,
    };

    function refresh() {
        legal = pos.legalMoves();
        game.board = boardOf(pos);
        game.turn = pos.side ? 'b' : 'w';
        game.moves = legal.map((m) => publicMove(pos, m));
        game.check = pos.inCheck() ? pos.kings[pos.side] : -1;
        game.halfmove = pos.half;
        game.status = 'playing';
        game.winner = null;
        game.reason = null;
        const end = (reason, winner = null) => {
            game.status = 'over';
            game.reason = reason;
            game.winner = winner;
        };
        if (legal.length === 0) {
            if (game.check >= 0) end('checkmate', other(game.turn));
            else end('stalemate');
        } else if (pos.insufficient()) end('material');
        else if (pos.half >= FIFTY_LIMIT) end('fifty');
        else if (pos.repetitions() >= 2) end('repetition');
    }

    // 找出合法步：可以傳走法物件、UCI 字串（'e2e4'、'e7e8q'），或 { from, to, promotion }
    function find(input) {
        if (typeof input === 'string') return game.moves.find((m) => m.uci === input) ?? null;
        if (!input || typeof input !== 'object') return null;
        const promotion = input.promotion ? input.promotion.toLowerCase() : null;
        return game.moves.find((m) => m.from === input.from && m.to === input.to && m.promotion === promotion) ?? null;
    }

    // 走一步：回傳 { ...move, side, san, check, mate, over?: { winner, reason } }；不合法時回傳 null
    // 兵走到底線時要指定升變（promotion: 'q' | 'r' | 'b' | 'n'），沒指定也回傳 null
    function play(input) {
        if (game.status !== 'playing') return null;
        const move = find(input);
        if (!move) return null;
        const side = game.turn;
        const san = sanOf(pos, move.code, legal);
        pos.make(move.code);
        refresh();
        const entry = { ...move, side, san, check: game.check >= 0, mate: game.reason === 'checkmate', fen: pos.fen() };
        game.history.push(entry);
        const result = { ...entry };
        if (game.status === 'over') result.over = { winner: game.winner, reason: game.reason };
        return result;
    }

    // 收回最後一步，回傳那一步；沒有可以收回的回傳 null
    function undo() {
        const last = game.history.pop();
        if (!last) return null;
        pos.unmake();
        refresh();
        return last;
    }

    // 從 from 出發的合法步、可以動的棋子、某一步是不是升變（要先選升變的棋子）
    const movesFrom = (from) => game.moves.filter((m) => m.from === from);
    const movable = () => [...new Set(game.moves.map((m) => m.from))];
    const needsPromotion = (from, to) => game.moves.some((m) => m.from === from && m.to === to && m.promotion);
    const last = () => game.history.at(-1) ?? null;
    // 雙方吃掉了對方哪些子（依價值由大到小）與子力差（以白方的角度，兵 1、馬象 3、車 5、后 9）
    function material() {
        const order = 'qrbnp';
        const taken = { w: [], b: [] };
        for (const m of game.history) if (m.captured) taken[m.side].push(typeOf(m.captured));
        for (const side of ['w', 'b']) taken[side].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        const worth = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
        let diff = 0;
        for (const piece of game.board) if (piece) diff += (sideOf(piece) === 'w' ? 1 : -1) * worth[typeOf(piece)];
        return { taken, diff };
    }
    const fenNow = () => pos.fen();
    // 目前的局面（含輪到誰）一共出現了幾次：2 代表再出現一次就和局
    const repeats = () => pos.repetitions() + 1;
    // 目前局面的副本（含重複局面的紀錄），給電腦對手搜尋用
    const position = () => pos.clone();
    const toJSON = () => ({ ...(fen && { fen: startFen }), moves: game.history.map((m) => m.uci) });

    Object.assign(game, {
        play,
        undo,
        movesFrom,
        movable,
        needsPromotion,
        last,
        material,
        fen: fenNow,
        repeats,
        position,
        toJSON,
    });
    refresh();

    if (state && typeof state === 'object') {
        if (!Array.isArray(state.moves)) throw new Error('存檔格式不符');
        for (const uci of state.moves)
            if (typeof uci !== 'string' || !play(uci)) throw new Error('存檔裡有不合法的一步');
    }
    return game;
}
