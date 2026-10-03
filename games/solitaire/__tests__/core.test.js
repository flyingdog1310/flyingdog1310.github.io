import test from 'node:test';
import assert from 'node:assert/strict';
import {
    COLUMNS,
    FOUNDATIONS,
    PILES,
    SAVED_HISTORY,
    cardName,
    createSolitaire,
    isRed,
    rankOf,
    suitOf,
} from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// 'AS' 'TH' '7D' 'KC'：點數（T = 10）+ 花色字母（S H D C，與 SUITS 順序相同）
const c = (name) => 'SHDC'.indexOf(name.at(-1)) * 13 + 'A23456789TJQK'.indexOf(name.slice(0, -1));
const cards = (text) => (text ? text.split(' ').map(c) : []);
// 某花色從 A 到 rank 的整疊（收牌區用）
const run = (suit, rank) => Array.from({ length: rank }, (_, i) => 'SHDC'.indexOf(suit) * 13 + i);

const allCards = (game) => PILES.flatMap((id) => game.pile(id));

test('牌的編號：花色、點數、顏色與名稱', () => {
    assert.equal(cardName(c('AS')), 'ace of spades');
    assert.equal(cardName(c('TH')), '10 of hearts');
    assert.equal(cardName(c('QD')), 'queen of diamonds');
    assert.equal(cardName(c('KC')), 'king of clubs');
    assert.equal(rankOf(c('KC')), 13);
    assert.equal(suitOf(c('7D')), 2);
    assert.ok(isRed(c('2H')) && isRed(c('2D')));
    assert.ok(!isRed(c('2S')) && !isRed(c('2C')));
});

test('發牌：7 列各 1–7 張、只有最上面翻開，牌庫 24 張，52 張不重複', () => {
    const game = createSolitaire({ random: seeded(7) });
    COLUMNS.forEach((id, i) => {
        assert.equal(game.pile(id).length, i + 1);
        assert.equal(game.hidden[i], i);
        assert.ok(game.isFaceUp(id, i));
        if (i > 0) assert.ok(!game.isFaceUp(id, i - 1));
    });
    assert.equal(game.pile('stock').length, 24);
    assert.equal(game.pile('waste').length, 0);
    for (const id of FOUNDATIONS) assert.equal(game.pile(id).length, 0);
    const all = allCards(game);
    assert.equal(all.length, 52);
    assert.equal(new Set(all).size, 52);
    assert.equal(game.moves, 0);
    assert.equal(game.status, 'playing');
    assert.equal(game.drawCount, 1);
});

test('同一個種子發出同一副牌，不同種子不同', () => {
    const a = createSolitaire({ random: seeded(3) }).snapshot();
    const b = createSolitaire({ random: seeded(3) }).snapshot();
    const d = createSolitaire({ random: seeded(4) }).snapshot();
    assert.equal(a, b);
    assert.notEqual(a, d);
});

test('一次翻 1 張：牌庫翻到 waste，翻完後整疊翻回來且順序不變', () => {
    const game = createSolitaire({ layout: { stock: cards('3S 2S AS') } });
    assert.deepEqual(game.draw(), { type: 'draw', cards: [c('AS')] });
    assert.deepEqual(game.draw(), { type: 'draw', cards: [c('2S')] });
    assert.deepEqual(game.draw(), { type: 'draw', cards: [c('3S')] });
    assert.deepEqual(game.pile('waste'), cards('AS 2S 3S'));
    assert.equal(game.pile('stock').length, 0);
    const recycle = game.draw();
    assert.equal(recycle.type, 'recycle');
    assert.deepEqual(game.pile('stock'), cards('3S 2S AS'));
    assert.equal(game.pile('waste').length, 0);
    // 再翻一次，順序和第一輪相同
    assert.deepEqual(game.draw().cards, [c('AS')]);
    assert.equal(game.moves, 5);
});

test('一次翻 3 張：不足 3 張時翻剩下的；牌庫與 waste 都空時不能翻', () => {
    const game = createSolitaire({ draw: 3, layout: { stock: cards('5H 4H 3H 2H AH') } });
    assert.equal(game.drawCount, 3);
    assert.deepEqual(game.draw().cards, cards('AH 2H 3H'));
    assert.deepEqual(game.draw().cards, cards('4H 5H'));
    assert.equal(game.top('waste'), c('5H'));
    assert.equal(game.draw().type, 'recycle');
    assert.deepEqual(game.draw().cards, cards('AH 2H 3H'));

    const empty = createSolitaire({ layout: { tableau: [cards('KS')] } });
    assert.equal(empty.draw(), null);
    assert.equal(empty.moves, 0);
    assert.throws(() => createSolitaire({ draw: 2 }));
});

test('牌桌：紅黑交錯、點數少一才能疊上去；空列只能放 K', () => {
    const game = createSolitaire({
        layout: { tableau: [cards('8S'), cards('7H'), cards('7C'), cards('6H'), [], cards('KD'), cards('9D')] },
    });
    assert.ok(game.canMove('t1', 1, 't0')); // 紅 7 放黑 8
    assert.ok(!game.canMove('t2', 1, 't0')); // 黑 7 不能放黑 8
    assert.ok(!game.canMove('t3', 1, 't0')); // 6 不能放 8
    assert.ok(!game.canMove('t1', 1, 't4')); // 空列不能放 7
    assert.ok(game.canMove('t5', 1, 't4')); // K 可以放空列
    assert.ok(game.canMove('t0', 1, 't6')); // 黑 8 放紅 9
    assert.ok(!game.canMove('t0', 1, 't0'));
    assert.ok(!game.canMove('stock', 1, 't0'));
    assert.deepEqual(game.targets('t1', 1), ['t0']);
});

test('收牌區：空的只能放 A，之後同花色依序往上；一次只能收一張', () => {
    const game = createSolitaire({
        layout: {
            foundations: [run('S', 2)],
            tableau: [cards('3S'), cards('3H'), cards('AD'), cards('4S 3D')],
            hidden: [0, 0, 0, 0],
        },
    });
    assert.ok(game.canMove('t0', 1, 'f0'));
    assert.ok(!game.canMove('t1', 1, 'f0')); // 花色不同
    assert.ok(!game.canMove('t1', 1, 'f1')); // 空的只能放 A
    assert.ok(game.canMove('t2', 1, 'f1'));
    assert.ok(!game.canMove('t3', 2, 'f0')); // 一次一張
    const result = game.move('t0', 1, 'f0');
    assert.deepEqual(result, { type: 'move', from: 't0', to: 'f0', cards: [c('3S')], flipped: null, won: false });
    assert.deepEqual(game.pile('f0'), run('S', 3));
    assert.equal(game.move('t1', 1, 'f0'), null);
});

test('整疊搬移：只能拿翻開且順序正確的一疊，搬完翻開下面的牌', () => {
    const game = createSolitaire({
        layout: {
            tableau: [cards('2C QD JS TH 9C'), cards('KH'), cards('AS 9H 8C')],
            hidden: [1, 0, 2],
        },
    });
    assert.ok(game.canPick('t0', 4));
    assert.ok(!game.canPick('t0', 5)); // 包含蓋著的牌
    assert.ok(game.canMove('t0', 4, 't1') === false); // Q 紅不能放 K 紅
    assert.deepEqual(game.targets('t0', 3), []);
    // 把整疊放到空列以外的地方：先清出條件
    const other = createSolitaire({
        layout: { tableau: [cards('2C JS TH 9C'), cards('QH'), cards('5D')], hidden: [1, 0, 0] },
    });
    const result = other.move('t0', 3, 't1');
    assert.deepEqual(result.cards, cards('JS TH 9C'));
    assert.equal(result.flipped, c('2C'));
    assert.deepEqual(other.pile('t1'), cards('QH JS TH 9C'));
    assert.equal(other.hidden[0], 0);
    assert.ok(other.isFaceUp('t0', 0));
    // 順序不對的一疊不能拿（存檔被改壞時）
    const broken = createSolitaire({ layout: { tableau: [cards('9C 9H')] } });
    assert.ok(!broken.canPick('t0', 2));
    assert.ok(broken.canPick('t0', 1));
});

test('蓋著的牌不能拿；拿走最上面那張後下一張自動翻開', () => {
    const game = createSolitaire({ layout: { tableau: [cards('5C 4H'), cards('5S')], hidden: [1, 0] } });
    assert.ok(!game.canPick('t0', 2));
    const result = game.move('t0', 1, 't1');
    assert.equal(result.flipped, c('5C'));
    assert.equal(game.hidden[0], 0);
    assert.equal(game.move('t0', 1, 't1'), null);
});

test('waste 與收牌區的牌可以放回牌桌；收牌區之間不能互搬', () => {
    const game = createSolitaire({
        layout: { waste: cards('6D 7D'), foundations: [run('H', 6), [c('AC')]], tableau: [cards('8S'), cards('8C')] },
    });
    assert.ok(game.canPick('waste', 1));
    assert.ok(!game.canPick('waste', 2));
    assert.ok(game.move('waste', 1, 't0'));
    assert.equal(game.top('waste'), c('6D'));
    assert.ok(game.canMove('f0', 1, 't0') === false); // 6H 不能放 7D（同為紅）
    assert.ok(game.move('f0', 1, 't1') === null); // 6H 不能放 8C
    assert.ok(!game.canMove('f1', 1, 'f2'));
    const back = createSolitaire({ layout: { foundations: [run('H', 6)], tableau: [cards('7S')] } });
    assert.ok(back.move('f0', 1, 't0'));
    assert.deepEqual(back.pile('f0'), run('H', 5));
});

test('點一下的自動去處：先收牌，再放有牌的列，最後才是空列；整列 K 不搬到另一個空列', () => {
    const game = createSolitaire({
        layout: {
            waste: cards('AH'),
            foundations: [run('S', 4)],
            tableau: [cards('5S'), cards('6H'), cards('5D'), [], cards('KC'), cards('2C KS'), cards('QH')],
            hidden: [0, 0, 0, 0, 0, 1, 0],
        },
    });
    assert.equal(game.bestTarget('t0', 1), 'f0'); // 5S 能收就收
    assert.equal(game.bestTarget('waste', 1), 'f1'); // A 到第一個空的收牌區
    assert.equal(game.bestTarget('t6', 1), 't4'); // QH 放 KC
    assert.equal(game.bestTarget('t4', 1), null); // KC 整列，搬到空列沒意義
    assert.equal(game.bestTarget('t5', 1), 't3'); // KS 底下還有蓋著的牌，可以搬到空列
    assert.equal(game.bestTarget('f0', 1), 't2'); // 收牌區的 4S 拿回來放 5D
    assert.equal(game.bestTarget('t2', 1), null);
});

test('收回：可以連續收回多步，包含翻牌、翻回牌庫與自動翻開的牌', () => {
    const game = createSolitaire({ random: seeded(11) });
    const start = game.snapshot();
    const states = [start];
    let done = 0;
    // 隨便走：能放就放，不能就翻牌
    for (let step = 0; step < 60; step++) {
        let acted = false;
        for (const from of ['waste', ...COLUMNS]) {
            for (let n = 1; n <= game.faceUpCount(from) && !acted; n++) {
                const to = game.bestTarget(from, n);
                if (to && game.move(from, n, to)) acted = true;
            }
            if (acted) break;
        }
        if (!acted && !game.draw()) break;
        states.push(game.snapshot());
        done++;
    }
    assert.ok(done > 30);
    assert.equal(game.moves, done);
    for (let k = states.length - 2; k >= 0; k--) {
        assert.ok(game.undo());
        assert.equal(game.snapshot(), states[k]);
    }
    assert.equal(game.undo(), null);
    assert.ok(!game.canUndo());
    assert.equal(game.moves, 0);
});

test('收完 52 張就贏；贏了之後不能再動，但可以收回', () => {
    const game = createSolitaire({
        layout: { foundations: [run('S', 13), run('H', 13), run('D', 13), run('C', 12)], tableau: [cards('KC')] },
    });
    assert.equal(game.status, 'playing');
    const result = game.move('t0', 1, 'f3');
    assert.equal(result.won, true);
    assert.equal(game.status, 'won');
    assert.equal(game.foundationCount(), 52);
    assert.equal(game.draw(), null);
    assert.ok(game.undo());
    assert.equal(game.status, 'playing');
});

test('自動完成：牌庫與 waste 空、沒有蓋著的牌時才可以，每一步收點數最小的牌，最後一定能贏', () => {
    const notYet = createSolitaire({
        layout: { tableau: [cards('2S AS')], hidden: [1] },
    });
    assert.ok(!notYet.canAutoComplete());
    const withStock = createSolitaire({ layout: { stock: cards('AH'), tableau: [cards('AS')] } });
    assert.ok(!withStock.canAutoComplete());

    const game = createSolitaire({
        layout: {
            foundations: [run('S', 7), run('H', 6), run('D', 9), run('C', 5)],
            tableau: [
                cards('KS QH JS TH 9S 8H'),
                cards('KH QS JH TS 9H 8S 7H'),
                cards('KD QC JD TC'),
                cards('KC QD JC TD 9C'),
                cards('8C'),
                cards('7C'),
                cards('6C'),
            ],
        },
    });
    assert.equal(game.foundationCount(), 27);
    assert.ok(game.canAutoComplete());
    const first = game.autoStep();
    assert.deepEqual(first.cards, [c('6C')]);
    let steps = 1;
    while (game.autoStep()) steps++;
    assert.equal(steps, 25);
    assert.equal(game.status, 'won');
    assert.ok(!game.canAutoComplete());
});

test('存檔與讀檔：局面、步數、翻牌模式與收回紀錄都還原', () => {
    const game = createSolitaire({ random: seeded(5), draw: 3 });
    game.draw();
    game.draw();
    const json = JSON.parse(JSON.stringify(game.toJSON()));
    const restored = createSolitaire({ state: json });
    assert.equal(restored.snapshot(), game.snapshot());
    assert.equal(restored.drawCount, 3);
    assert.equal(restored.moves, 2);
    assert.ok(restored.undo());
    assert.ok(restored.undo());
    assert.equal(restored.snapshot(), createSolitaire({ random: seeded(5), draw: 3 }).snapshot());
});

test('存檔只保留最近的收回紀錄；壞掉的存檔會丟錯', () => {
    const game = createSolitaire({ random: seeded(2) });
    for (let k = 0; k < SAVED_HISTORY + 20; k++) game.draw();
    assert.equal(game.toJSON().history.length, SAVED_HISTORY);

    const good = game.toJSON();
    assert.throws(() => createSolitaire({ state: { ...good, draw: 2 } }));
    assert.throws(() => createSolitaire({ state: { ...good, state: good.state.replace(/^./, '#') } }));
    // 少一張牌
    assert.throws(() => createSolitaire({ state: { ...good, state: good.state.slice(1) } }));
    assert.throws(() => createSolitaire({ state: { ...good, history: ['nope'] } }));
    // 蓋著的張數超過該列
    const parts = good.state.split('|');
    parts[PILES.length] = '0,1,2,3,4,5,9';
    assert.throws(() => createSolitaire({ state: { ...good, state: parts.join('|') } }));
    assert.throws(() => createSolitaire({ layout: { stock: cards('AS AS') } }));
});

test('隨機局面裡每一步合法的移動都保持 52 張不重複', () => {
    for (let seed = 1; seed <= 10; seed++) {
        const random = seeded(seed);
        const game = createSolitaire({ random, draw: seed % 2 ? 1 : 3 });
        for (let step = 0; step < 200; step++) {
            const options = [];
            for (const from of ['waste', ...FOUNDATIONS, ...COLUMNS]) {
                for (let n = 1; n <= game.faceUpCount(from); n++) {
                    for (const to of game.targets(from, n)) options.push([from, n, to]);
                }
            }
            if (options.length && random() < 0.7) {
                const [from, n, to] = options[Math.floor(random() * options.length)];
                assert.ok(game.move(from, n, to));
            } else if (!game.draw()) {
                break;
            }
            const all = allCards(game);
            assert.equal(all.length, 52);
            assert.equal(new Set(all).size, 52);
            COLUMNS.forEach((id, i) => {
                const len = game.pile(id).length;
                assert.ok(len === 0 ? game.hidden[i] === 0 : game.hidden[i] < len);
            });
        }
    }
});
