// 翻牌配對的遊戲規則（純邏輯，不碰 DOM）
// 盤面是 rows × cols 的陣列（列優先），每張牌 { symbol, state: 'down' | 'up' | 'matched' }

export const LEVELS = {
    easy: { rows: 3, cols: 4 },
    normal: { rows: 4, cols: 5 },
    hard: { rows: 6, cols: 6 },
};

// 圖案種類數（畫面上的 SVG 圖示數量），最難的盤面需要 18 種
export const SYMBOL_COUNT = 18;

function shuffle(list, random) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// deck：直接指定每格的圖案（測試用），不指定則隨機挑圖案並洗牌
export function createMemoryMatch({ rows, cols, symbols = SYMBOL_COUNT, deck, random = Math.random }) {
    const size = rows * cols;
    if (size % 2 !== 0) throw new Error('格子數必須是偶數');
    const pairs = size / 2;
    if (pairs > symbols) throw new Error('圖案種類不夠');

    if (!deck) {
        const chosen = shuffle(
            Array.from({ length: symbols }, (_, i) => i),
            random
        ).slice(0, pairs);
        deck = shuffle([...chosen, ...chosen], random);
    }
    if (deck.length !== size) throw new Error('deck 長度與盤面不符');

    const game = {
        rows,
        cols,
        pairs,
        cards: deck.map((symbol) => ({ symbol, state: 'down' })),
        // ready：還沒翻第一張
        status: 'ready',
        // 翻兩張算一步
        moves: 0,
        matches: 0,
        // 目前連續配對成功的次數與本局最長紀錄
        streak: 0,
        bestStreak: 0,
    };

    // 目前翻開但還沒配對的牌（0–2 張；2 張代表配錯，等待蓋回去）
    let open = [];

    // 配錯的兩張蓋回去；回傳蓋回的牌，沒有則回傳 null
    function settle() {
        if (open.length < 2) return null;
        const hidden = open;
        for (const i of hidden) game.cards[i].state = 'down';
        open = [];
        return hidden;
    }

    // 結果：{ flipped, hidden?: [a, b], match?: [a, b], mismatch?: [a, b], won? }
    // 配錯的牌還沒蓋回時翻下一張，會先把那兩張蓋回（hidden），不必等動畫；
    // 點的是那兩張其中之一時，那張保持翻開，當作新的一步的第一張
    // 不能翻（已翻開、已配對、已結束）時回傳 null
    function flip(index) {
        if (game.status === 'won') return null;
        const card = game.cards[index];
        const reopen = open.length === 2 && open.includes(index);
        if (!card || (card.state !== 'down' && !reopen)) return null;

        const result = { flipped: index };
        const hidden = settle();
        if (hidden) result.hidden = hidden.filter((i) => i !== index);

        card.state = 'up';
        game.status = 'playing';
        open.push(index);
        if (open.length < 2) return result;

        game.moves += 1;
        const [a, b] = open;
        if (game.cards[a].symbol === game.cards[b].symbol) {
            game.cards[a].state = 'matched';
            game.cards[b].state = 'matched';
            open = [];
            game.matches += 1;
            game.streak += 1;
            game.bestStreak = Math.max(game.bestStreak, game.streak);
            result.match = [a, b];
            if (game.matches === pairs) {
                game.status = 'won';
                result.won = true;
            }
        } else {
            game.streak = 0;
            result.mismatch = [a, b];
        }
        return result;
    }

    const openCards = () => [...open];

    Object.assign(game, { flip, settle, openCards });
    return game;
}
