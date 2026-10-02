import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_GUESSES,
    createWordle,
    currentStreak,
    dailyAnswer,
    dayNumber,
    emptyStats,
    hardModeError,
    randomAnswer,
    recordResult,
    score,
    shareText,
} from '../core.js';
import { ALLOWED, ANSWERS } from '../words.js';

const marks = (guess, answer) =>
    score(guess, answer)
        .map((m) => ({ correct: 'G', present: 'Y', absent: '.' })[m])
        .join('');

// 依序輸入並送出一個字
function play(game, word) {
    for (const ch of word) game.type(ch);
    return game.submit();
}

test('比對：位置正確、存在、不存在', () => {
    assert.equal(marks('crane', 'crane'), 'GGGGG');
    assert.equal(marks('stare', 'prime'), '...YG');
    assert.equal(marks('pride', 'prime'), 'GGG.G');
    assert.equal(marks('fight', 'crane'), '.....');
});

test('比對：重複字母只依答案裡的數量上色，位置正確的優先', () => {
    // 答案只有一個 E：猜兩個 E 時只有第一個是黃色
    assert.equal(marks('geese', 'thorn'), '.....');
    assert.equal(marks('geese', 'other'), '.Y...');
    // 位置正確的 E 先用掉，前面的 E 不再上色
    assert.equal(marks('eerie', 'stage'), '....G');
    // 答案有兩個 L，猜三個 L
    assert.equal(marks('lolly', 'llama'), 'G.Y..');
    assert.equal(marks('speed', 'abide'), '..Y.Y');
    assert.equal(marks('abbey', 'kebab'), 'YYGY.');
});

test('困難模式：沿用猜中的位置、用上出現過的字母', () => {
    const history = [{ word: 'crane', marks: score('crane', 'cider') }];
    // c 位置正確、r 與 e 存在
    assert.equal(hardModeError('stole', history), '1st letter must be C');
    assert.equal(hardModeError('coast', history), 'Guess must contain R');
    assert.equal(hardModeError('cover', history), null);

    // 需要兩個 L
    const twice = [{ word: 'lolly', marks: score('lolly', 'allot') }];
    assert.equal(hardModeError('allot', twice), null);
    assert.equal(hardModeError('oiled', twice), 'Guess must contain 2 Ls');
});

test('輸入、刪除與送出', () => {
    const game = createWordle({ answer: 'prime', isWord: (w) => ['stare', 'pride', 'prime'].includes(w) });
    assert.equal(game.erase(), null);
    assert.deepEqual(game.type('S'), { row: 0, col: 0, letter: 's' });
    assert.equal(game.type('1'), null);
    for (const ch of 'tare') game.type(ch);
    // 滿五個字之後不能再輸入
    assert.equal(game.type('x'), null);
    assert.equal(game.current, 'stare');
    assert.deepEqual(game.erase(), { row: 0, col: 4 });
    assert.deepEqual(game.submit(), { error: 'short', message: 'Not enough letters' });
    game.type('x');
    assert.deepEqual(game.submit(), { error: 'unknown', message: 'Not in word list' });
    // 不合法的字不會用掉次數
    assert.equal(game.row, 0);
    game.erase();
    game.type('e');
    const result = game.submit();
    assert.deepEqual(result, { row: 0, word: 'stare', marks: score('stare', 'prime'), status: 'playing' });
    assert.equal(game.current, '');
    assert.equal(game.row, 1);
});

test('猜中就贏，猜完六次沒中就輸，結束後不能再輸入', () => {
    const won = createWordle({ answer: 'prime' });
    play(won, 'stare');
    assert.equal(play(won, 'prime').status, 'won');
    assert.equal(won.type('a'), null);
    assert.equal(won.submit(), null);

    const lost = createWordle({ answer: 'prime' });
    for (let k = 0; k < MAX_GUESSES - 1; k++) assert.equal(play(lost, 'stare').status, 'playing');
    assert.equal(play(lost, 'pride').status, 'lost');
    assert.equal(lost.status, 'lost');
    assert.equal(lost.type('a'), null);
});

test('困難模式：不符合時不能送出，只能在第一次猜之前切換', () => {
    const game = createWordle({ answer: 'cider', hard: true });
    play(game, 'crane');
    for (const ch of 'stole') game.type(ch);
    assert.deepEqual(game.submit(), { error: 'hard', message: '1st letter must be C' });
    assert.equal(game.row, 1);
    assert.equal(game.setHard(false), false);
    assert.equal(game.hard, true);

    const fresh = createWordle({ answer: 'cider' });
    assert.equal(fresh.setHard(true), true);
    assert.equal(fresh.hard, true);
});

test('鍵盤上色：每個字母取最好的結果', () => {
    const game = createWordle({ answer: 'prime' });
    play(game, 'stare');
    play(game, 'pride');
    const states = game.letterStates();
    assert.equal(states.r, 'correct');
    assert.equal(states.e, 'correct');
    assert.equal(states.p, 'correct');
    assert.equal(states.s, 'absent');
    assert.equal(states.d, 'absent');
    assert.equal(states.z, undefined);
});

test('存檔後可以接著玩', () => {
    const game = createWordle({ answer: 'prime', hard: true });
    play(game, 'stare');
    game.type('p');
    game.type('r');
    const restored = createWordle({ state: JSON.parse(JSON.stringify(game.toJSON())) });
    assert.equal(restored.answer, 'prime');
    assert.equal(restored.hard, true);
    assert.equal(restored.row, 1);
    assert.equal(restored.current, 'pr');
    assert.deepEqual(restored.guesses, game.guesses);

    // 已經結束的局面還原後仍是結束
    play(restored, 'ime');
    assert.equal(createWordle({ state: restored.toJSON() }).status, 'won');
    assert.throws(() => createWordle({ answer: 'toolong' }));
});

test('每日題目：依當地日期編號，同一天同一個字', () => {
    assert.equal(dayNumber(new Date(2026, 9, 1, 0, 5)), 1);
    assert.equal(dayNumber(new Date(2026, 9, 1, 23, 55)), 1);
    assert.equal(dayNumber(new Date(2026, 9, 2, 8)), 2);
    assert.equal(dayNumber(new Date(2027, 9, 1, 12)), 366);
    // 跨過日光節約時間的月份也是整數天
    assert.equal(dayNumber(new Date(2027, 3, 1, 12)) - dayNumber(new Date(2027, 2, 1, 12)), 31);

    const first = dailyAnswer(1, ANSWERS);
    assert.equal(dailyAnswer(1, ANSWERS), first);
    assert.ok(ANSWERS.includes(first));
    // 連續幾天不重複，也不是照字母順序
    const week = Array.from({ length: 7 }, (_, k) => dailyAnswer(k + 1, ANSWERS));
    assert.equal(new Set(week).size, 7);
    assert.notDeepEqual(week, ANSWERS.slice(0, 7));
    // 題目用完後從頭循環
    assert.equal(dailyAnswer(1 + ANSWERS.length, ANSWERS), first);

    assert.equal(
        randomAnswer(['aaaaa', 'bbbbb'], () => 0.99),
        'bbbbb'
    );
});

test('字庫：答案都在可猜的字裡、都是五個小寫字母', () => {
    assert.ok(ANSWERS.length > 2000);
    assert.equal(new Set(ANSWERS).size, ANSWERS.length);
    for (const word of ALLOWED) assert.match(word, /^[a-z]{5}$/);
    assert.ok(ANSWERS.every((word) => ALLOWED.has(word)));
    // 複數與動詞變化也可以猜
    assert.ok(ALLOWED.has('books') && ALLOWED.has('tried'));
});

test('統計：每日題目漏掉一天連勝就斷', () => {
    let stats = emptyStats();
    stats = recordResult(stats, { won: true, guesses: 3, day: 10 });
    stats = recordResult(stats, { won: true, guesses: 4, day: 11 });
    assert.equal(stats.streak, 2);
    assert.equal(currentStreak(stats, 12), 2);
    // 第 12 天沒玩，第 13 天看到的連勝是 0
    assert.equal(currentStreak(stats, 13), 0);
    stats = recordResult(stats, { won: true, guesses: 2, day: 13 });
    assert.equal(stats.streak, 1);
    stats = recordResult(stats, { won: false, guesses: 6, day: 14 });
    assert.equal(stats.streak, 0);
    stats = recordResult(stats, { won: true, guesses: 6, day: 15 });
    assert.equal(stats.streak, 1);
    assert.equal(stats.played, 5);
    assert.equal(stats.wins, 4);
    assert.deepEqual(stats.dist, [0, 1, 1, 1, 0, 1]);
});

test('統計：練習模式連贏就累加，輸了歸零；不修改原本的物件', () => {
    const start = emptyStats();
    let stats = recordResult(start, { won: true, guesses: 1 });
    stats = recordResult(stats, { won: true, guesses: 5 });
    assert.equal(stats.streak, 2);
    assert.equal(currentStreak(stats), 2);
    stats = recordResult(stats, { won: false, guesses: 6 });
    assert.equal(stats.streak, 0);
    assert.deepEqual(start, emptyStats());
    // 存檔壞掉時從空的統計開始
    assert.equal(recordResult(null, { won: true, guesses: 2 }).played, 1);
});

test('分享文字', () => {
    const game = createWordle({ answer: 'prime', hard: true });
    play(game, 'stare');
    play(game, 'prime');
    assert.equal(shareText(game, 'Wordle #3'), 'Wordle #3 2/6*\n\n⬛⬛⬛🟨🟩\n🟩🟩🟩🟩🟩');

    const lost = createWordle({ answer: 'prime' });
    for (let k = 0; k < MAX_GUESSES; k++) play(lost, 'stare');
    assert.match(shareText(lost, 'Wordle'), /^Wordle X\/6\n\n/);
});
