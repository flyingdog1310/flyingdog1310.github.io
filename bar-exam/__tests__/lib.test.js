import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    answerLabel,
    clearWrong,
    filterIndexes,
    isCorrect,
    parseProgress,
    splitStem,
    step,
    summarize,
} from '../lib.js';

const data = JSON.parse(readFileSync(new URL('../data/115.json', import.meta.url), 'utf8'));
const qs = [
    { n: 1, answer: 'A' },
    { n: 2, answer: 'C' },
    { n: 3, answer: 'B或D' },
    { n: 4, answer: '#' },
];

test('isCorrect：單一、多個答案與一律給分', () => {
    assert.equal(isCorrect('A', 'A'), true);
    assert.equal(isCorrect('A', 'B'), false);
    assert.equal(isCorrect('B或D', 'D'), true);
    assert.equal(isCorrect('B或D', 'A'), false);
    assert.equal(isCorrect('#', 'C'), true);
    assert.equal(isCorrect('A', undefined), false);
});

test('answerLabel', () => {
    assert.equal(answerLabel('C'), '(C)');
    assert.equal(answerLabel('B或D'), '(B)(D)');
    assert.equal(answerLabel('#'), null);
});

test('summarize 只算已作答的題目', () => {
    assert.deepEqual(summarize(qs, {}), { total: 4, answered: 0, correct: 0, wrong: 0, rate: null });
    assert.deepEqual(summarize(qs, { 1: 'A', 2: 'A', 4: 'D' }), {
        total: 4,
        answered: 3,
        correct: 2,
        wrong: 1,
        rate: 2 / 3,
    });
});

test('splitStem：有兩個以上 ①② 才分段', () => {
    assert.deepEqual(splitStem('下列何者正確？'), ['下列何者正確？']);
    assert.deepEqual(splitStem('方案：①甲 ②乙 ③丙。何者正確？'), ['方案：', '①甲', '②乙', '③丙。何者正確？']);
    assert.deepEqual(splitStem('僅①正確'), ['僅①正確']);
});

test('filterIndexes 與 step', () => {
    const answers = { 1: 'A', 2: 'A' };
    assert.deepEqual(filterIndexes(qs, answers, 'all'), [0, 1, 2, 3]);
    assert.deepEqual(filterIndexes(qs, answers, 'wrong'), [1]);
    assert.deepEqual(filterIndexes(qs, answers, 'todo'), [2, 3]);
    assert.equal(step([1, 3], 0, 1), 1);
    assert.equal(step([1, 3], 1, 1), 3);
    assert.equal(step([1, 3], 3, 1), null);
    assert.equal(step([1, 3], 2, -1), 1);
    assert.equal(step([1, 3], 1, -1), null);
});

test('parseProgress 丟掉壞掉或不存在的紀錄', () => {
    assert.deepEqual(parseProgress(null, qs), { answers: {}, index: 0 });
    assert.deepEqual(parseProgress('not json', qs), { answers: {}, index: 0 });
    assert.deepEqual(parseProgress(JSON.stringify({ answers: { 1: 'B', 9: 'A', 2: 'E' }, index: 2 }), qs), {
        answers: { 1: 'B' },
        index: 2,
    });
    assert.equal(parseProgress(JSON.stringify({ answers: {}, index: 99 }), qs).index, 0);
});

test('clearWrong 只留下答對的題目', () => {
    assert.deepEqual(clearWrong(qs, { 1: 'A', 2: 'B', 3: 'D' }), { 1: 'A', 3: 'D' });
});

test('115 年資料：四科共 300 題，每題四個選項與答案', () => {
    assert.equal(data.year, 115);
    assert.deepEqual(
        data.papers.map((p) => [p.id, p.questions.length]),
        [
            ['public', 75],
            ['criminal', 75],
            ['civil', 80],
            ['commercial', 70],
        ]
    );
    for (const paper of data.papers) {
        paper.questions.forEach((q, i) => {
            assert.equal(q.n, i + 1);
            assert.ok(q.stem.length > 5, `${paper.id} #${q.n} 題幹`);
            assert.deepEqual(Object.keys(q.options), ['A', 'B', 'C', 'D']);
            for (const text of Object.values(q.options)) assert.ok(text.length > 0, `${paper.id} #${q.n} 選項`);
            assert.match(q.answer, /^[A-D]$/);
            assert.ok(Number.isInteger(q.yamol));
        });
    }
    // 與考選部標準答案逐題對照（各科前 10 題）
    const firsts = Object.fromEntries(
        data.papers.map((p) => [
            p.id,
            p.questions
                .slice(0, 10)
                .map((q) => q.answer)
                .join(''),
        ])
    );
    assert.deepEqual(firsts, {
        public: 'DACCAACDCB',
        criminal: 'DBBDDAACAC',
        civil: 'CCACBCDABC',
        commercial: 'BBDCDDCCAA',
    });
});
