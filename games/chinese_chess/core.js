// 象棋的遊戲規則與電腦對手（純邏輯，不碰 DOM）
// 盤面 9 行 × 10 列的交叉點，index = row * 9 + col：row 0 是黑方底線、row 9 是紅方底線（紅方在下方）
// 座標用 ICCS：直行 a–i（紅方的左到右）、橫列 0–9（紅方底線是 0），例如紅方的炮在 b2 / h2
// 對外的棋子用 UCCI 的 FEN 字母：紅 'K' 帥 'A' 仕 'B' 相 'N' 傌 'R' 俥 'C' 炮 'P' 兵，黑方小寫；空格是 null
// 雙方是 'r'（紅，先走）/ 'b'（黑）
// 規則：帥（將）與仕（士）不出九宮、相（象）不過河且塞象眼、馬絆馬腳、炮隔一子吃子、兵過河後可以橫走、
// 帥將不能在同一直行上直接照面、不能走了之後讓自己被將；沒有步可走（被將死或困斃）就輸
// 和局與長將：同一局面第三次出現時，若其中一方在這段期間每一步都在將軍、另一方不是，長將的一方輸，否則和局；
// 60 回合（120 手）沒有吃子是和局；雙方都沒有能過河攻擊的子（車馬炮兵）也是和局

export const COLS = 9;
export const ROWS = 10;
export const SIZE = 90;
export const LEVELS = ['easy', 'normal', 'hard'];
export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
// 多少手（半回合）沒有吃子算和局
export const NO_CAPTURE_LIMIT = 120;

export const other = (side) => (side === 'r' ? 'b' : 'r');
export const sideOf = (piece) => (piece ? (piece === piece.toUpperCase() ? 'r' : 'b') : null);
// 棋子種類（小寫字母）
export const typeOf = (piece) => (piece ? piece.toLowerCase() : null);
const FILES = 'abcdefghi';
export const squareName = (i) => `${FILES[i % COLS]}${ROWS - 1 - Math.floor(i / COLS)}`;
export const squareIndex = (name) => (ROWS - 1 - Number(name[1])) * COLS + FILES.indexOf(name[0]);

// ---------- 內部表示：棋子用整數（1–7 = 帥仕相馬車炮兵，黑方加 8），走法也是一個整數 ----------

const KING = 1;
const ADVISOR = 2;
const ELEPHANT = 3;
const HORSE = 4;
const ROOK = 5;
const CANNON = 6;
const PAWN = 7;
const BLACK = 8;
const CHARS = '.KABNRCP.kabnrcp';
const CODE = Object.fromEntries([...'KABNRCPkabnrcp'].map((ch) => [ch, CHARS.indexOf(ch)]));

// 走法：from | to << 7
const moveOf = (from, to) => from | (to << 7);
const fromOf = (m) => m & 127;
const toOf = (m) => m >> 7;

const ROW = Array.from({ length: SIZE }, (_, i) => Math.floor(i / COLS));
const COL = Array.from({ length: SIZE }, (_, i) => i % COLS);
const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const at = (r, c) => r * COLS + c;
// 九宮：紅方 row 7–9、黑方 row 0–2，col 3–5
const inPalace = (side, r, c) => c >= 3 && c <= 5 && (side ? r >= 0 && r <= 2 : r >= 7 && r < ROWS);
// 自己這一邊（相 / 象不能過河）：紅方 row 5–9、黑方 row 0–4
const ownHalf = (side, r) => (side ? r <= 4 : r >= 5);
// 兵過河了沒
const crossed = (side, r) => (side ? r >= 5 : r <= 4);

// 預先算好每一格的走法：射線（上下左右）、帥 / 仕 / 相 / 馬 / 兵能走到哪（含馬腳、象眼）
const ORTHO = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
];
const DIAG = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
];
const RAYS = [];
const KING_TO = [[], []];
const ADVISOR_TO = [[], []];
// [落點, 象眼, 落點, 象眼, …]
const ELEPHANT_TO = [[], []];
// [落點, 馬腳, …]
const HORSE_TO = [];
// 會攻擊 sq 的馬站在哪裡：[馬的位置, 馬腳, …]
const HORSE_FROM = Array.from({ length: SIZE }, () => []);
const PAWN_TO = [[], []];
// PAWN_FROM[side][sq]：side 方的兵站在哪些格子會攻擊 sq
const PAWN_FROM = [
    Array.from({ length: SIZE }, () => []),
    Array.from({ length: SIZE }, () => []),
];
for (let i = 0; i < SIZE; i++) {
    const r = ROW[i];
    const c = COL[i];
    RAYS.push(
        ORTHO.map(([dr, dc]) => {
            const ray = [];
            for (let k = 1; inside(r + dr * k, c + dc * k); k++) ray.push(at(r + dr * k, c + dc * k));
            return ray;
        })
    );
    const horse = [];
    for (const [dr, dc] of [
        [-2, -1],
        [-2, 1],
        [2, -1],
        [2, 1],
        [-1, -2],
        [1, -2],
        [-1, 2],
        [1, 2],
    ]) {
        if (!inside(r + dr, c + dc)) continue;
        const leg = Math.abs(dr) === 2 ? at(r + dr / 2, c) : at(r, c + dc / 2);
        horse.push(at(r + dr, c + dc), leg);
    }
    HORSE_TO.push(horse);
    for (const side of [0, 1]) {
        KING_TO[side].push(
            inPalace(side, r, c)
                ? ORTHO.filter(([dr, dc]) => inPalace(side, r + dr, c + dc)).map(([dr, dc]) => at(r + dr, c + dc))
                : []
        );
        ADVISOR_TO[side].push(
            inPalace(side, r, c)
                ? DIAG.filter(([dr, dc]) => inPalace(side, r + dr, c + dc)).map(([dr, dc]) => at(r + dr, c + dc))
                : []
        );
        const elephant = [];
        if (ownHalf(side, r)) {
            for (const [dr, dc] of DIAG) {
                const tr = r + dr * 2;
                const tc = c + dc * 2;
                if (inside(tr, tc) && ownHalf(side, tr)) elephant.push(at(tr, tc), at(r + dr, c + dc));
            }
        }
        ELEPHANT_TO[side].push(elephant);
        const pawn = [];
        const forward = side ? 1 : -1;
        if (inside(r + forward, c)) pawn.push(at(r + forward, c));
        if (crossed(side, r)) {
            if (c > 0) pawn.push(at(r, c - 1));
            if (c < COLS - 1) pawn.push(at(r, c + 1));
        }
        PAWN_TO[side].push(pawn);
    }
}
for (let from = 0; from < SIZE; from++) {
    const list = HORSE_TO[from];
    for (let k = 0; k < list.length; k += 2) HORSE_FROM[list[k]].push(from, list[k + 1]);
    for (const side of [0, 1]) for (const to of PAWN_TO[side][from]) PAWN_FROM[side][to].push(from);
}

// Zobrist 雜湊：兩個 32 位元的值合起來當局面的指紋（固定種子，每次都一樣）
let zseed = 0x2545f491;
function zrand() {
    zseed = (zseed + 0x6d2b79f5) | 0;
    let t = Math.imul(zseed ^ (zseed >>> 15), 1 | zseed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
}
const Z_LO = Int32Array.from({ length: 16 * SIZE }, zrand);
const Z_HI = Int32Array.from({ length: 16 * SIZE }, zrand);
const Z_SIDE_LO = zrand();
const Z_SIDE_HI = zrand();

class Position {
    constructor() {
        this.board = new Int8Array(SIZE);
        // 0 紅、1 黑
        this.side = 0;
        // 連續幾手沒有吃子
        this.half = 0;
        this.full = 1;
        this.kings = [-1, -1];
        this.lo = 0;
        this.hi = 0;
        // make / unmake 用的堆疊：每一步存 m、被吃的子、half
        this.stack = [];
        // 每一步之前的雜湊（lo, hi 交錯），用來判斷重複局面
        this.hist = [];
        // 每一步有沒有將軍（判斷長將用）
        this.checks = [];
    }

    static fromFEN(fen) {
        const pos = new Position();
        const [placement, side = 'w', , , half = '0', full = '1'] = fen.trim().split(/\s+/);
        const rows = placement.split('/');
        if (rows.length !== ROWS) throw new Error(`FEN 格式不符：${fen}`);
        rows.forEach((row, r) => {
            let c = 0;
            for (const ch of row) {
                if (/[1-9]/.test(ch)) c += Number(ch);
                else if (CODE[ch] && c < COLS) pos.put(at(r, c++), CODE[ch]);
                else throw new Error(`FEN 格式不符：${fen}`);
            }
            if (c !== COLS) throw new Error(`FEN 格式不符：${fen}`);
        });
        if (pos.kings[0] < 0 || pos.kings[1] < 0) throw new Error('雙方都要有帥 / 將');
        if (side === 'b') {
            pos.side = 1;
            pos.lo ^= Z_SIDE_LO;
            pos.hi ^= Z_SIDE_HI;
        }
        pos.half = Number(half) || 0;
        pos.full = Number(full) || 1;
        return pos;
    }

    clone() {
        const pos = new Position();
        pos.board.set(this.board);
        Object.assign(pos, {
            side: this.side,
            half: this.half,
            full: this.full,
            kings: [...this.kings],
            lo: this.lo,
            hi: this.hi,
            hist: [...this.hist],
            checks: [...this.checks],
        });
        return pos;
    }

    fen() {
        const rows = [];
        for (let r = 0; r < ROWS; r++) {
            let text = '';
            let empty = 0;
            for (let c = 0; c < COLS; c++) {
                const code = this.board[at(r, c)];
                if (!code) empty++;
                else {
                    if (empty) text += empty;
                    empty = 0;
                    text += CHARS[code];
                }
            }
            rows.push(empty ? text + empty : text);
        }
        return `${rows.join('/')} ${this.side ? 'b' : 'w'} - - ${this.half} ${this.full}`;
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

    // sq（帥 / 將所在的格子）有沒有被 by 方（0 紅、1 黑）攻擊；帥將在同一直行上照面也算
    attacked(sq, by) {
        const b = this.board;
        const add = by ? BLACK : 0;
        const rays = RAYS[sq];
        for (let d = 0; d < 4; d++) {
            const ray = rays[d];
            let k = 0;
            // 第一個碰到的子：車（或直行上的帥 / 將）
            for (; k < ray.length; k++) {
                const code = b[ray[k]];
                if (!code) continue;
                if (code === ROOK + add || (d < 2 && code === KING + add)) return true;
                break;
            }
            // 第二個碰到的子：炮（隔著第一個子）
            for (k++; k < ray.length; k++) {
                const code = b[ray[k]];
                if (!code) continue;
                if (code === CANNON + add) return true;
                break;
            }
        }
        const horses = HORSE_FROM[sq];
        for (let k = 0; k < horses.length; k += 2) {
            if (b[horses[k]] === HORSE + add && !b[horses[k + 1]]) return true;
        }
        for (const p of PAWN_FROM[by][sq]) if (b[p] === PAWN + add) return true;
        return false;
    }

    inCheck(side = this.side) {
        return this.attacked(this.kings[side], side ^ 1);
    }

    // 擬合法步（還沒檢查會不會讓自己被將）；capturesOnly 時只產生吃子（給靜態搜尋用）
    generate(list, capturesOnly = false) {
        const b = this.board;
        const us = this.side;
        const them = us ^ 1;
        // 落點是空格（且不是只要吃子）或對方的子
        const ok = (to) => {
            const t = b[to];
            return t ? t >> 3 === them : !capturesOnly;
        };
        for (let from = 0; from < SIZE; from++) {
            const code = b[from];
            if (!code || code >> 3 !== us) continue;
            switch (code & 7) {
                case KING:
                    for (const to of KING_TO[us][from]) if (ok(to)) list.push(moveOf(from, to));
                    break;
                case ADVISOR:
                    for (const to of ADVISOR_TO[us][from]) if (ok(to)) list.push(moveOf(from, to));
                    break;
                case ELEPHANT: {
                    const steps = ELEPHANT_TO[us][from];
                    for (let k = 0; k < steps.length; k += 2) {
                        if (!b[steps[k + 1]] && ok(steps[k])) list.push(moveOf(from, steps[k]));
                    }
                    break;
                }
                case HORSE: {
                    const steps = HORSE_TO[from];
                    for (let k = 0; k < steps.length; k += 2) {
                        if (!b[steps[k + 1]] && ok(steps[k])) list.push(moveOf(from, steps[k]));
                    }
                    break;
                }
                case PAWN:
                    for (const to of PAWN_TO[us][from]) if (ok(to)) list.push(moveOf(from, to));
                    break;
                case ROOK:
                    for (let d = 0; d < 4; d++) {
                        const ray = RAYS[from][d];
                        for (let k = 0; k < ray.length; k++) {
                            const t = b[ray[k]];
                            if (!t) {
                                if (!capturesOnly) list.push(moveOf(from, ray[k]));
                                continue;
                            }
                            if (t >> 3 === them) list.push(moveOf(from, ray[k]));
                            break;
                        }
                    }
                    break;
                case CANNON:
                    for (let d = 0; d < 4; d++) {
                        const ray = RAYS[from][d];
                        let k = 0;
                        // 不吃子時像車一樣走，碰到第一個子（炮架）之後，再碰到的第一個子若是對方的就能吃
                        for (; k < ray.length; k++) {
                            if (b[ray[k]]) break;
                            if (!capturesOnly) list.push(moveOf(from, ray[k]));
                        }
                        for (k++; k < ray.length; k++) {
                            const t = b[ray[k]];
                            if (!t) continue;
                            if (t >> 3 === them) list.push(moveOf(from, ray[k]));
                            break;
                        }
                    }
                    break;
            }
        }
        return list;
    }

    // 走一步；回傳這一步合不合法（自己有沒有被將、帥將有沒有照面）。不論合不合法都要用 unmake 收回
    make(m) {
        const from = fromOf(m);
        const to = toOf(m);
        const b = this.board;
        const us = this.side;
        const code = b[from];
        const captured = b[to];
        this.hist.push(this.lo, this.hi);
        this.stack.push(m, captured, this.half);
        if (captured) this.remove(to);
        this.remove(from);
        this.put(to, code);
        this.half = captured ? 0 : this.half + 1;
        if (us) this.full++;
        this.side = us ^ 1;
        this.lo ^= Z_SIDE_LO;
        this.hi ^= Z_SIDE_HI;
        const legal = !this.attacked(this.kings[us], us ^ 1);
        // 這一步有沒有將軍對方（不合法的步不用算）
        this.checks.push(legal && this.attacked(this.kings[us ^ 1], us) ? 1 : 0);
        return legal;
    }

    unmake() {
        const s = this.stack;
        const half = s.pop();
        const captured = s.pop();
        const m = s.pop();
        const from = fromOf(m);
        const to = toOf(m);
        const b = this.board;
        this.side ^= 1;
        const us = this.side;
        if (us) this.full--;
        const moved = b[to];
        b[from] = moved;
        b[to] = captured;
        if ((moved & 7) === KING) this.kings[us] = from;
        this.half = half;
        this.hi = this.hist.pop();
        this.lo = this.hist.pop();
        this.checks.pop();
    }

    legalMoves() {
        const out = [];
        for (const m of this.generate([])) {
            if (this.make(m)) out.push(m);
            this.unmake();
        }
        return out;
    }

    // 目前的局面在上一次吃子之後出現過的位置（hist 裡「那一步之前」的步數 index），由近到遠
    repeatsAt(stopAtFirst = false) {
        const h = this.hist;
        const found = [];
        const n = h.length / 2;
        for (let k = n - 2, left = this.half - 2; k >= 0 && left >= 0; k -= 2, left -= 2) {
            if (h[k * 2] === this.lo && h[k * 2 + 1] === this.hi) {
                found.push(k);
                if (stopAtFirst) break;
            }
        }
        return found;
    }

    // 從第 start 步到現在形成循環：回傳長將的一方（0 紅、1 黑），雙方都長將或都沒有時回傳 -1
    perpetual(start) {
        const n = this.checks.length;
        const all = [true, true];
        // 最後一步是對方（side ^ 1）走的
        for (let k = n - 1, mover = this.side ^ 1; k >= start; k--, mover ^= 1) {
            if (!this.checks[k]) all[mover] = false;
        }
        if (all[0] && !all[1]) return 0;
        if (all[1] && !all[0]) return 1;
        return -1;
    }

    // 雙方都沒有能過河攻擊的子（車馬炮兵）
    insufficient() {
        for (let i = 0; i < SIZE; i++) {
            const type = this.board[i] & 7;
            if (type === ROOK || type === HORSE || type === CANNON || type === PAWN) return false;
        }
        return true;
    }
}

// ---------- 對外的走法物件與記譜 ----------

// 記譜用的英文字母（WXF）：K 帥、A 仕、E 相、H 馬、R 車、C 炮、P 兵
const LETTER = { k: 'K', a: 'A', b: 'E', n: 'H', r: 'R', c: 'C', p: 'P' };

function publicMove(pos, m) {
    const from = fromOf(m);
    const to = toOf(m);
    const captured = pos.board[to];
    return {
        from,
        to,
        piece: CHARS[pos.board[from]],
        captured: captured ? CHARS[captured] : null,
        iccs: `${squareName(from)}${squareName(to)}`,
        code: m,
    };
}

// 記譜：棋子字母 + 出發點 + 「-」或吃子「x」+ 落點，將軍加「+」、將死加「#」，例如 Ch2-e2、Rb0xb7+
function notationOf(pos, m) {
    const from = fromOf(m);
    const to = toOf(m);
    const letter = LETTER[typeOf(CHARS[pos.board[from]])];
    let text = `${letter}${squareName(from)}${pos.board[to] ? 'x' : '-'}${squareName(to)}`;
    pos.make(m);
    if (pos.inCheck()) text += pos.legalMoves().length ? '+' : '#';
    pos.unmake();
    return text;
}

// 從 FEN 算出所有合法步（測試與工具用）
export function legalMoves(fen) {
    const pos = Position.fromFEN(fen);
    return pos.legalMoves().map((m) => ({ ...publicMove(pos, m), notation: notationOf(pos, m) }));
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

function boardOf(pos) {
    return Array.from(pos.board, (code) => (code ? CHARS[code] : null));
}

// ---------- 電腦對手：negamax + alpha-beta、逐層加深、置換表、靜態搜尋（吃子算到底） ----------

const VALUE = [0, 0, 120, 120, 270, 600, 285, 30];
// 位置分數（紅方角度，index 0 = 黑方底線的 a9）；黑方用上下翻轉的格子查表
// prettier-ignore
const PST = [
    [],
    // 帥：待在底線中間，被趕出來扣分
    [
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, -18, -16, -18, 0, 0, 0,
        0, 0, 0, -8, -6, -8, 0, 0, 0,
        0, 0, 0, -2, 4, -2, 0, 0, 0,
    ],
    // 仕
    [
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, -2, 0, -2, 0, 0, 0,
        0, 0, 0, 0, 4, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    // 相
    [
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, -2, 0, 0, 0, -2, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        -2, 0, 0, 0, 4, 0, 0, 0, -2,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    // 馬：往中央、過河後卡在對方九宮附近最好，待在底線兩邊最差
    [
        4, 8, 16, 12, 4, 12, 16, 8, 4,
        4, 10, 28, 16, 8, 16, 28, 10, 4,
        12, 14, 16, 20, 18, 20, 16, 14, 12,
        8, 24, 18, 24, 20, 24, 18, 24, 8,
        6, 16, 14, 18, 16, 18, 14, 16, 6,
        4, 12, 16, 14, 12, 14, 16, 12, 4,
        2, 6, 8, 6, 10, 6, 8, 6, 2,
        4, 2, 8, 8, 4, 8, 8, 2, 4,
        0, 2, 4, 4, -2, 4, 4, 2, 0,
        0, -4, 0, 0, 0, 0, 0, -4, 0,
    ],
    // 車：佔據通路與對方的兵林線
    [
        14, 14, 12, 18, 16, 18, 12, 14, 14,
        16, 20, 18, 24, 26, 24, 18, 20, 16,
        12, 12, 12, 18, 18, 18, 12, 12, 12,
        12, 18, 16, 22, 22, 22, 16, 18, 12,
        12, 14, 12, 18, 18, 18, 12, 14, 12,
        12, 16, 14, 20, 20, 20, 14, 16, 12,
        6, 10, 8, 14, 14, 14, 8, 10, 6,
        4, 8, 6, 14, 12, 14, 6, 8, 4,
        8, 4, 8, 16, 8, 16, 8, 4, 8,
        -2, 10, 6, 14, 12, 14, 6, 10, -2,
    ],
    // 炮：中路最好
    [
        6, 4, 0, -10, -12, -10, 0, 4, 6,
        2, 2, 0, -4, -14, -4, 0, 2, 2,
        2, 2, 0, -10, -8, -10, 0, 2, 2,
        0, 0, -2, 4, 10, 4, -2, 0, 0,
        0, 0, 0, 2, 8, 2, 0, 0, 0,
        -2, 0, 4, 2, 6, 2, 4, 0, -2,
        0, 0, 0, 2, 4, 2, 0, 0, 0,
        4, 0, 8, 6, 10, 6, 8, 0, 4,
        0, 2, 4, 6, 6, 6, 4, 2, 0,
        0, 0, 2, 6, 6, 6, 2, 0, 0,
    ],
    // 兵：過河之後價值大增，越靠近對方九宮越好（到底線反而沒用）
    [
        0, 3, 6, 9, 12, 9, 6, 3, 0,
        18, 36, 56, 80, 120, 80, 56, 36, 18,
        14, 26, 42, 60, 80, 60, 42, 26, 14,
        10, 20, 30, 34, 40, 34, 30, 20, 10,
        6, 12, 18, 18, 20, 18, 18, 12, 6,
        2, 0, 8, 0, 8, 0, 8, 0, 2,
        0, 0, -2, 0, 4, 0, -2, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
];
// 黑方查表時上下翻轉
const FLIP = Array.from({ length: SIZE }, (_, i) => at(ROWS - 1 - ROW[i], COL[i]));

// 以輪到的一方的角度評估局面
function evaluateCodes(pos) {
    const b = pos.board;
    let score = 0;
    const attackers = [0, 0];
    for (let i = 0; i < SIZE; i++) {
        const code = b[i];
        if (!code) continue;
        const type = code & 7;
        const color = code >> 3;
        const sq = color ? FLIP[i] : i;
        const value = VALUE[type] + PST[type][sq];
        if (type >= HORSE) attackers[color] += type === PAWN ? (crossed(color, ROW[i]) ? 1 : 0) : 2;
        score += color ? -value : value;
    }
    // 對方沒有攻擊的子時，仕相的防守價值降低、己方的帥可以出來幫忙
    if (!attackers[1]) score += 20;
    if (!attackers[0]) score -= 20;
    return pos.side ? -score : score;
}

// 以輪到的一方的角度評估 FEN 的局面（測試用）
export function evaluate(fen) {
    return evaluateCodes(Position.fromFEN(fen));
}

const MATE = 100000;
// 搜尋中碰到對方長將形成的循環：當成大幅領先（比將死小）
const PERPETUAL = 20000;
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
    hard: { depth: 12, nodes: 40000 },
};
// 各難度在差不多好的步裡隨機挑的範圍（分數，30 = 一個沒過河的兵）
const WINDOW = { easy: 120, normal: 15, hard: 0 };

function search(pos) {
    let nodes = 0;
    let limit = Infinity;
    const killers = new Int32Array(MAX_PLY * 2 + 4);
    const history = new Int32Array(SIZE * 128);
    TT_FLAG.fill(0);

    // 走法排序：置換表的步最先，再來吃子（被吃的越值錢、吃的越便宜越先）、殺手步、歷史分數
    function scoreMoves(list, ttMove, ply) {
        const b = pos.board;
        const scores = new Int32Array(list.length);
        for (let k = 0; k < list.length; k++) {
            const m = list[k];
            if (m === ttMove) scores[k] = 1 << 30;
            else {
                const victim = b[toOf(m)] & 7;
                if (victim) scores[k] = (1 << 24) + (victim === KING ? 2000 : VALUE[victim]) * 16 - (b[fromOf(m)] & 7);
                else if (m === killers[ply * 2]) scores[k] = 1 << 22;
                else if (m === killers[ply * 2 + 1]) scores[k] = (1 << 22) - 1;
                else scores[k] = history[m];
            }
        }
        return scores;
    }

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
        if (pos.half >= NO_CAPTURE_LIMIT) return 0;
        const repeat = pos.repeatsAt(true);
        if (repeat.length) {
            // 循環：長將的一方輸，否則和局
            const loser = pos.perpetual(repeat[0]);
            return loser < 0 ? 0 : loser === pos.side ? -PERPETUAL : PERPETUAL;
        }
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
                if (!pos.board[toOf(m)]) {
                    if (killers[ply * 2] !== m) {
                        killers[ply * 2 + 1] = killers[ply * 2];
                        killers[ply * 2] = m;
                    }
                    history[m] += depth * depth;
                }
                break;
            }
        }
        // 沒有步可走：不論有沒有被將都是輸
        if (legal === 0) return -MATE + ply;

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

// 電腦選一步：source 是 createXiangqi 的遊戲物件（會一起考慮重複局面與長將）或 FEN；
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
    const window = level === 'hard' && pos.full <= 3 ? 12 : WINDOW[level];
    const engine = search(pos);
    let best = engine.root(legal, 1, window);
    for (let d = 2; d <= depth; d++) {
        const ordered = best.map((s) => s.m);
        const scored = engine.run(() => engine.root(ordered, d, window), nodes);
        if (!scored) break;
        best = scored;
        if (Math.abs(best[0].score) > MATE - 1000) break;
    }
    const top = best[0].score;
    // 找到將死時走最快的那一步；大幅領先時 normal 不再隨機挑（不然殘局一直繞圈）
    const spread = top > MATE - 1000 || (level === 'normal' && top >= 300) ? 0 : window;
    return result(
        pick(
            best.filter((s) => s.score >= top - spread),
            random
        ).m
    );
}

// ---------- 一局 ----------

// state：存檔（toJSON 的結果），用來接著玩；fen：從指定的局面開始（測試與示意盤面用）
export function createXiangqi({ state, fen = null } = {}) {
    if (state && typeof state === 'object' && state.fen) fen = state.fen;
    const startFen = fen ?? START_FEN;
    const pos = Position.fromFEN(startFen);
    const game = {
        board: [],
        turn: 'r',
        // 依序走過的步：{ ...move, side, notation, check, mate }
        history: [],
        // playing | over
        status: 'playing',
        // 結束時 'r' | 'b' | null（和局）
        winner: null,
        // 結束的原因：checkmate | stalemate | perpetual | repetition | nocapture | material
        reason: null,
        // 目前輪到的一方的合法步
        moves: [],
        // 被將軍的帥 / 將在哪一格（沒有是 -1）
        check: -1,
        // 連續幾手沒有吃子
        halfmove: 0,
    };

    function refresh() {
        const legal = pos.legalMoves();
        game.board = boardOf(pos);
        game.turn = pos.side ? 'b' : 'r';
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
        const repeats = pos.repeatsAt();
        if (legal.length === 0) {
            // 象棋沒有逼和：沒有步可走就輸
            end(game.check >= 0 ? 'checkmate' : 'stalemate', other(game.turn));
        } else if (repeats.length >= 2) {
            // 第三次出現：看從第一次出現到現在，有沒有一方一直在將軍
            const loser = pos.perpetual(repeats.at(-1));
            if (loser < 0) end('repetition');
            else end('perpetual', loser ? 'r' : 'b');
        } else if (pos.half >= NO_CAPTURE_LIMIT) end('nocapture');
        else if (pos.insufficient()) end('material');
    }

    // 找出合法步：可以傳走法物件、ICCS 字串（'h2e2'），或 { from, to }
    function find(input) {
        if (typeof input === 'string') return game.moves.find((m) => m.iccs === input) ?? null;
        if (!input || typeof input !== 'object') return null;
        return game.moves.find((m) => m.from === input.from && m.to === input.to) ?? null;
    }

    // 走一步：回傳 { ...move, side, notation, check, mate, over?: { winner, reason } }；不合法時回傳 null
    function play(input) {
        if (game.status !== 'playing') return null;
        const move = find(input);
        if (!move) return null;
        const side = game.turn;
        const notation = notationOf(pos, move.code);
        pos.make(move.code);
        refresh();
        const entry = { ...move, side, notation, check: game.check >= 0, mate: game.reason === 'checkmate' };
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

    const movesFrom = (from) => game.moves.filter((m) => m.from === from);
    const movable = () => [...new Set(game.moves.map((m) => m.from))];
    const last = () => game.history.at(-1) ?? null;
    // 雙方吃掉了對方哪些子（依價值由大到小）與子力差（以紅方的角度，車 9、馬炮 4、仕相 2、兵 1）
    function material() {
        const order = 'rcnabp';
        const taken = { r: [], b: [] };
        for (const m of game.history) if (m.captured) taken[m.side].push(typeOf(m.captured));
        for (const side of ['r', 'b']) taken[side].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        const worth = { r: 9, n: 4, c: 4, a: 2, b: 2, p: 1, k: 0 };
        let diff = 0;
        for (const piece of game.board) if (piece) diff += (sideOf(piece) === 'r' ? 1 : -1) * worth[typeOf(piece)];
        return { taken, diff };
    }
    // 目前的局面（含輪到誰）一共出現了幾次：3 就結束
    const repeats = () => pos.repeatsAt().length + 1;
    // 目前局面的副本（含重複局面與將軍的紀錄），給電腦對手搜尋用
    const position = () => pos.clone();
    const toJSON = () => ({ ...(fen && { fen: startFen }), moves: game.history.map((m) => m.iccs) });

    Object.assign(game, {
        play,
        undo,
        movesFrom,
        movable,
        last,
        material,
        fen: () => pos.fen(),
        repeats,
        position,
        toJSON,
    });
    refresh();

    if (state && typeof state === 'object') {
        if (!Array.isArray(state.moves)) throw new Error('存檔格式不符');
        for (const iccs of state.moves)
            if (typeof iccs !== 'string' || !play(iccs)) throw new Error('存檔裡有不合法的一步');
    }
    return game;
}
