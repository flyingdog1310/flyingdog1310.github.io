// 接龍（Klondike）：遊戲規則，純邏輯、不碰 DOM
//
// 牌用 0–51 的整數表示：花色 = Math.floor(id / 13)（SUITS 的順序），點數 = id % 13 + 1（A = 1、K = 13）
// 牌堆用字串表示：'stock'（牌庫）、'waste'（翻開的牌）、'f0'–'f3'（收牌區）、't0'–'t6'（牌桌的 7 列）
// 每一堆都是陣列，最後一個元素在最上面。牌桌每一列前 hidden[i] 張是蓋著的，其餘翻開
//
// 每個動作是一個方法，成功時回傳這一步的結果（給畫面做動畫與朗讀），不合法時回傳 null

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const RANK_NAMES = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
export const FOUNDATIONS = ['f0', 'f1', 'f2', 'f3'];
export const COLUMNS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
export const PILES = ['stock', 'waste', ...FOUNDATIONS, ...COLUMNS];
export const DRAW_MODES = [1, 3];

export const suitOf = (card) => Math.floor(card / 13);
export const rankOf = (card) => (card % 13) + 1;
export const isRed = (card) => suitOf(card) === 1 || suitOf(card) === 2;
export const cardName = (card) => `${RANK_NAMES[rankOf(card) - 1]} of ${SUITS[suitOf(card)]}`;
export const isColumn = (pile) => /^t[0-6]$/.test(pile);
export const isFoundation = (pile) => /^f[0-3]$/.test(pile);

// 存檔與復原用的精簡字串：每張牌一個英文字母（A–Z、a–z 剛好 52 個）
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const encodePile = (pile) => pile.map((card) => LETTERS[card]).join('');
const decodePile = (text) =>
    [...text].map((ch) => {
        const card = LETTERS.indexOf(ch);
        if (card < 0) throw new Error(`Bad card: ${ch}`);
        return card;
    });

// 存檔時最多保留幾步可以收回
export const SAVED_HISTORY = 400;

export function createSolitaire({ random = Math.random, draw = 1, layout = null, state = null } = {}) {
    let piles;
    let hidden;
    let moves = 0;
    let history = [];

    if (state) {
        draw = state.draw;
        restore(state.state, true);
        history = Array.isArray(state.history) ? state.history.slice(-SAVED_HISTORY) : [];
        // 每一筆歷史都要能還原，壞掉的存檔整個不要
        for (const entry of history) parseSnapshot(entry, true);
    } else if (layout) {
        // 測試與示意盤面用：直接指定各堆的牌（可以不是完整的 52 張）
        piles = Object.fromEntries(PILES.map((id) => [id, []]));
        piles.stock = [...(layout.stock ?? [])];
        piles.waste = [...(layout.waste ?? [])];
        FOUNDATIONS.forEach((id, i) => (piles[id] = [...(layout.foundations?.[i] ?? [])]));
        COLUMNS.forEach((id, i) => (piles[id] = [...(layout.tableau?.[i] ?? [])]));
        hidden = COLUMNS.map((id, i) => Math.min(layout.hidden?.[i] ?? 0, Math.max(0, piles[id].length - 1)));
        const all = PILES.flatMap((id) => piles[id]);
        if (new Set(all).size !== all.length || all.some((card) => !(card >= 0 && card < 52))) {
            throw new Error('Duplicate or invalid card in layout');
        }
    } else {
        deal();
    }
    if (!DRAW_MODES.includes(draw)) throw new Error(`Draw must be 1 or 3, got ${draw}`);

    function deal() {
        const deck = Array.from({ length: 52 }, (_, i) => i);
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        piles = Object.fromEntries(PILES.map((id) => [id, []]));
        // 和真的發牌一樣一排一排發：第 r 排發給第 r 列以後的每一列
        for (let row = 0; row < COLUMNS.length; row++) {
            for (let col = row; col < COLUMNS.length; col++) piles[COLUMNS[col]].push(deck.pop());
        }
        piles.stock = deck;
        hidden = COLUMNS.map((_, i) => i);
    }

    // ---------- 快照：收回與存檔 ----------

    function snapshot() {
        return `${PILES.map((id) => encodePile(piles[id])).join('|')}|${hidden.join(',')}|${moves}`;
    }

    function parseSnapshot(text, strict) {
        const parts = String(text).split('|');
        if (parts.length !== PILES.length + 2) throw new Error('Bad snapshot');
        const parsed = Object.fromEntries(PILES.map((id, i) => [id, decodePile(parts[i])]));
        const counts = parts[PILES.length].split(',').map(Number);
        const moveCount = Number(parts[PILES.length + 1]);
        if (counts.length !== COLUMNS.length || !Number.isInteger(moveCount) || moveCount < 0) {
            throw new Error('Bad snapshot');
        }
        COLUMNS.forEach((id, i) => {
            const n = counts[i];
            const len = parsed[id].length;
            if (!Number.isInteger(n) || n < 0 || (len === 0 ? n !== 0 : n > len - 1)) throw new Error('Bad snapshot');
        });
        if (strict) {
            const all = PILES.flatMap((id) => parsed[id]);
            if (all.length !== 52 || new Set(all).size !== 52) throw new Error('Snapshot must hold 52 cards');
        }
        return { piles: parsed, hidden: counts, moves: moveCount };
    }

    function restore(text, strict = false) {
        const parsed = parseSnapshot(text, strict);
        piles = parsed.piles;
        hidden = parsed.hidden;
        moves = parsed.moves;
    }

    // ---------- 查詢 ----------

    const top = (id) => piles[id].at(-1);
    const columnIndex = (id) => COLUMNS.indexOf(id);
    const faceUpCount = (id) => (isColumn(id) ? piles[id].length - hidden[columnIndex(id)] : piles[id].length);

    // 這張牌（第 index 張）是否翻開
    function isFaceUp(id, index) {
        if (id === 'stock') return false;
        if (isColumn(id)) return index >= hidden[columnIndex(id)];
        return true;
    }

    // 能不能從 from 拿起最上面的 count 張：
    // 收牌區與 waste 只能拿最上面一張，牌桌可以拿一疊翻開且「紅黑交錯、點數遞減」的牌
    function canPick(from, count) {
        if (!PILES.includes(from) || from === 'stock' || !Number.isInteger(count) || count < 1) return false;
        const pile = piles[from];
        if (count > pile.length) return false;
        if (!isColumn(from)) return count === 1;
        if (count > faceUpCount(from)) return false;
        for (let k = pile.length - count; k < pile.length - 1; k++) {
            const a = pile[k];
            const b = pile[k + 1];
            if (isRed(a) === isRed(b) || rankOf(a) !== rankOf(b) + 1) return false;
        }
        return true;
    }

    // 一張牌能不能放到 to 上面（只看規則，不看從哪裡來）
    function accepts(to, card, count) {
        const target = top(to);
        if (isFoundation(to)) {
            if (count !== 1) return false;
            if (target === undefined) return rankOf(card) === 1;
            return suitOf(target) === suitOf(card) && rankOf(card) === rankOf(target) + 1;
        }
        if (isColumn(to)) {
            if (target === undefined) return rankOf(card) === 13;
            return isRed(target) !== isRed(card) && rankOf(target) === rankOf(card) + 1;
        }
        return false;
    }

    function canMove(from, count, to) {
        if (game.status !== 'playing' || from === to || !PILES.includes(to)) return false;
        // 收牌區之間互搬沒有意義
        if (isFoundation(from) && isFoundation(to)) return false;
        if (!canPick(from, count)) return false;
        const card = piles[from][piles[from].length - count];
        return accepts(to, card, count);
    }

    const targets = (from, count) => [...FOUNDATIONS, ...COLUMNS].filter((to) => canMove(from, count, to));

    // 點一下牌時自動選的去處：能收就收（單張），否則放到牌桌上有牌的列（從左邊開始），最後才是空列
    // 整列從 K 開始、底下沒有蓋著的牌時，搬到另一個空列沒有意義，不算
    function bestTarget(from, count) {
        const legal = targets(from, count);
        const foundation = legal.find(isFoundation);
        if (foundation && !isFoundation(from)) return foundation;
        const onCards = legal.find((to) => isColumn(to) && piles[to].length > 0);
        if (onCards) return onCards;
        const wholeColumn = isColumn(from) && count === piles[from].length;
        if (wholeColumn) return null;
        return legal.find((to) => isColumn(to)) ?? null;
    }

    // ---------- 動作 ----------

    function record() {
        history.push(snapshot());
    }

    function checkWin() {
        if (FOUNDATIONS.every((id) => piles[id].length === 13)) game.status = 'won';
    }

    function move(from, count, to) {
        if (!canMove(from, count, to)) return null;
        record();
        const cards = piles[from].splice(piles[from].length - count, count);
        piles[to].push(...cards);
        // 牌桌那一列拿走之後，最上面那張蓋著的牌自動翻開
        let flipped = null;
        if (isColumn(from)) {
            const i = columnIndex(from);
            if (hidden[i] > 0 && hidden[i] === piles[from].length) {
                hidden[i] -= 1;
                flipped = top(from);
            }
        }
        moves += 1;
        checkWin();
        return { type: 'move', from, to, cards, flipped, won: game.status === 'won' };
    }

    // 翻牌：牌庫還有牌就翻 draw 張到 waste；牌庫空了就把 waste 整疊翻回牌庫（不限次數）
    function drawCards() {
        if (game.status !== 'playing') return null;
        if (piles.stock.length > 0) {
            record();
            const cards = [];
            for (let k = 0; k < draw && piles.stock.length > 0; k++) {
                const card = piles.stock.pop();
                piles.waste.push(card);
                cards.push(card);
            }
            moves += 1;
            return { type: 'draw', cards };
        }
        if (piles.waste.length > 0) {
            record();
            const cards = piles.waste.reverse();
            piles.stock = cards;
            piles.waste = [];
            moves += 1;
            return { type: 'recycle', cards: [...cards] };
        }
        return null;
    }

    function undo() {
        if (history.length === 0) return null;
        const before = snapshot();
        restore(history.pop());
        game.status = 'playing';
        return { type: 'undo', before };
    }

    // 牌庫與 waste 都空了、牌桌上沒有蓋著的牌：剩下的牌一定能全部收完
    const canAutoComplete = () =>
        game.status === 'playing' &&
        piles.stock.length === 0 &&
        piles.waste.length === 0 &&
        hidden.every((n) => n === 0) &&
        COLUMNS.some((id) => piles[id].length > 0);

    // 收一張牌到收牌區：選點數最小的那張（自動完成時一步一步呼叫）
    function autoStep() {
        let best = null;
        for (const from of ['waste', ...COLUMNS]) {
            const card = top(from);
            if (card === undefined) continue;
            const to = FOUNDATIONS.find((f) => canMove(from, 1, f));
            if (to && (best === null || rankOf(card) < rankOf(best.card))) best = { from, to, card };
        }
        return best ? move(best.from, 1, best.to) : null;
    }

    const game = {
        status: 'playing',
        // 一次翻幾張（1 或 3）；draw() 是翻牌的動作
        get drawCount() {
            return draw;
        },
        get moves() {
            return moves;
        },
        get history() {
            return history;
        },
        get hidden() {
            return [...hidden];
        },
        pile: (id) => piles[id],
        top,
        isFaceUp,
        faceUpCount,
        canPick,
        canMove,
        targets,
        bestTarget,
        move,
        draw: drawCards,
        undo,
        canUndo: () => history.length > 0,
        canAutoComplete,
        autoStep,
        foundationCount: () => FOUNDATIONS.reduce((sum, id) => sum + piles[id].length, 0),
        snapshot,
        toJSON: () => ({ draw, state: snapshot(), history: history.slice(-SAVED_HISTORY) }),
    };
    checkWin();
    return game;
}
