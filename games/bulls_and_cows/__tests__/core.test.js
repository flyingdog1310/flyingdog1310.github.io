import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, allCodes, createBullsAndCows, createSecret, score } from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

function play(game, code) {
    for (const d of code) game.type(d);
    return game.submit();
}

test('計分：A 是位置也對，B 是數字對位置不對', () => {
    assert.deepEqual(score('1234', '1234'), { bulls: 4, cows: 0 });
    assert.deepEqual(score('1234', '4321'), { bulls: 0, cows: 4 });
    assert.deepEqual(score('1234', '1256'), { bulls: 2, cows: 0 });
    assert.deepEqual(score('1234', '2189'), { bulls: 0, cows: 2 });
    assert.deepEqual(score('1234', '1342'), { bulls: 1, cows: 3 });
    assert.deepEqual(score('5678', '1234'), { bulls: 0, cows: 0 });
    assert.deepEqual(score('012', '210'), { bulls: 1, cows: 2 });
});

test('答案每位數字都不同、可以 0 開頭，由亂數決定', () => {
    let leadingZero = false;
    for (let seed = 1; seed <= 200; seed++) {
        for (const { length } of Object.values(LEVELS)) {
            const secret = createSecret(length, seeded(seed));
            assert.match(secret, new RegExp(`^\\d{${length}}$`));
            assert.equal(new Set(secret).size, length);
            if (secret[0] === '0') leadingZero = true;
        }
    }
    assert.ok(leadingZero);
    assert.equal(createSecret(4, seeded(3)), createSecret(4, seeded(3)));
    assert.notEqual(createSecret(4, seeded(3)), createSecret(4, seeded(4)));
    assert.throws(() => createBullsAndCows({ length: 4, secret: '1123' }));
    assert.throws(() => createBullsAndCows({ length: 4, secret: '123' }));
});

test('所有可能的答案數量', () => {
    assert.equal(allCodes(3).length, 720);
    assert.equal(allCodes(4).length, 5040);
    assert.equal(allCodes(5).length, 30240);
});

test('輸入：不能重複數字、不能超過位數，可以刪除', () => {
    const game = createBullsAndCows({ length: 4, secret: '1234' });
    assert.deepEqual(game.type('5'), { col: 0 });
    assert.deepEqual(game.type('0'), { col: 1 });
    assert.deepEqual(game.type('5'), { error: 'repeat', col: 0 });
    assert.equal(game.type('x'), null);
    game.type('6');
    game.type('7');
    assert.equal(game.current, '5067');
    assert.equal(game.type('8'), null);
    assert.deepEqual(game.erase(), { col: 3 });
    assert.equal(game.current, '506');
    game.erase();
    game.erase();
    game.erase();
    assert.equal(game.erase(), null);
});

test('送出：位數不夠或猜過的數字不算一次', () => {
    const game = createBullsAndCows({ length: 4, secret: '1234' });
    game.type('5');
    assert.equal(game.submit().error, 'short');
    assert.equal(game.guesses.length, 0);
    for (const d of '678') game.type(d);
    assert.deepEqual(game.submit(), { row: 0, bulls: 0, cows: 0, won: false });
    assert.equal(game.current, '');
    assert.equal(play(game, '5678').error, 'repeat');
    assert.equal(game.guesses.length, 1);
    assert.equal(game.current, '5678');
});

test('猜中就贏，之後不能再輸入', () => {
    const game = createBullsAndCows({ length: 3, secret: '021' });
    assert.deepEqual(play(game, '012'), { row: 0, bulls: 1, cows: 2, won: false });
    assert.deepEqual(play(game, '021'), { row: 1, bulls: 3, cows: 0, won: true });
    assert.equal(game.status, 'won');
    assert.equal(game.type('1'), null);
    assert.equal(game.submit(), null);
    assert.equal(game.giveUp(), null);
});

test('放棄：公布答案，之後不能再輸入', () => {
    const game = createBullsAndCows({ length: 4, secret: '9876' });
    game.type('1');
    assert.deepEqual(game.giveUp(), { secret: '9876' });
    assert.equal(game.status, 'gaveup');
    assert.equal(game.current, '');
    assert.equal(game.type('2'), null);
});

test('可能的答案：只留下與每次結果相符的', () => {
    const game = createBullsAndCows({ length: 4, secret: '4567' });
    assert.equal(game.candidates().length, 5040);
    play(game, '0123');
    // 0A0B：答案只能從其餘 6 個數字排出
    assert.equal(game.candidates().length, 360);
    play(game, '4589');
    for (const code of game.candidates()) {
        assert.deepEqual(score('0123', code), { bulls: 0, cows: 0 });
        assert.deepEqual(score('4589', code), { bulls: 2, cows: 0 });
    }
    assert.ok(game.candidates().includes('4567'));
});

test('數字提示：一定不在 / 一定在答案裡', () => {
    const game = createBullsAndCows({ length: 4, secret: '4567' });
    assert.deepEqual(game.digitStates(), {});
    play(game, '0123');
    const states = game.digitStates();
    for (const d of '0123') assert.equal(states[d], 'out');
    for (const d of '456789') assert.equal(states[d], undefined);
    // 4 個數字都在答案裡
    play(game, '7654');
    const after = game.digitStates();
    for (const d of '4567') assert.equal(after[d], 'in');
    for (const d of '012389') assert.equal(after[d], 'out');
});

test('存檔後可以接著玩', () => {
    const game = createBullsAndCows({ length: 5, random: seeded(9) });
    play(game, '01234');
    play(game, '56789');
    game.type('9');
    game.type('8');
    const saved = JSON.parse(JSON.stringify(game.toJSON()));
    const restored = createBullsAndCows({ state: saved });
    assert.equal(restored.length, 5);
    assert.equal(restored.secret, game.secret);
    assert.deepEqual(restored.guesses, game.guesses);
    assert.equal(restored.current, '98');
    assert.equal(restored.status, 'playing');

    const done = createBullsAndCows({ length: 3, secret: '123' });
    play(done, '123');
    assert.equal(createBullsAndCows({ state: done.toJSON() }).status, 'won');
    const quit = createBullsAndCows({ length: 3, secret: '123' });
    quit.giveUp();
    assert.equal(createBullsAndCows({ state: quit.toJSON() }).status, 'gaveup');

    assert.throws(() => createBullsAndCows({ state: { ...saved, guesses: ['11234'] } }));
    // 輸入到一半的內容不合法時丟掉
    assert.equal(createBullsAndCows({ state: { ...saved, current: '99' } }).current, '');
});
