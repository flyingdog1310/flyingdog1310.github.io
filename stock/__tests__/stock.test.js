import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScenarios, moduleLoader, runScenario } from './harness.js';
import { calculateSummary, extractRemainingFunds, parseCSV, buildPortfolioView } from '../lib.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));
const scenarios = loadScenarios();
const scriptUrl = new URL('../script.js', import.meta.url).href;

test('golden.json 涵蓋所有情境', () => {
    assert.deepEqual(Object.keys(golden).sort(), Object.keys(scenarios).sort());
});

for (const [name, scenario] of Object.entries(scenarios)) {
    test(`畫面輸出與重構前一致：${name}`, async () => {
        const snapshot = await runScenario(scenario, moduleLoader(scriptUrl));
        assert.deepEqual(snapshot, golden[name]);
    });
}

test('真實資料有載入成功（避免 golden 本身就是錯誤畫面）', () => {
    const real = golden['real-data'];
    assert.equal(real.errorDisplay, 'none');
    assert.ok(real.rows.length > 0);
    assert.ok(real.lastUpdateSet);
});

test('股票現值排除「總和」列', () => {
    const stocks = [
        { 股票: 'A', 市值: '1,000' },
        { 股票: 'B', 市值: '250.5' },
        { 股票: '總和', 市值: '1,250.5' },
    ];
    assert.equal(calculateSummary(stocks).totalMarketValue, 1250.5);
});

test('剩餘資金取第一列「剩餘資金」右邊那格', () => {
    assert.equal(extractRemainingFunds('"手續費折數","1","剩餘資金","160168"\n"a","b"'), '160168');
    assert.equal(extractRemainingFunds('"手續費折數","1","剩餘資金"'), '--');
    assert.equal(extractRemainingFunds('"x","剩餘資金","1"\n"剩餘資金","999"'), '1');
});

test('漲紅跌綠：損益 >= 0 為 positive、< 0 為 negative、無法解析沿用 negative', () => {
    const csv = [
        '"股票","持有股數","買入均價","現價","市值","未實現損益","未實現損益率"',
        '"漲","1","1","2","2","100","10%"',
        '"平","1","1","1","1","0","0%"',
        '"跌","1","2","1","1","-100","-10%"',
        '"空","1","1","1","1","",""',
    ].join('\n');
    const [up, flat, down, empty] = buildPortfolioView(parseCSV(csv), '--').rowsHTML;
    assert.match(up, /class="positive">\s*\+/);
    assert.match(flat, /class="positive">\s*\+/);
    assert.match(down, /class="negative">\s*-/);
    assert.match(empty, /class="negative">\s*--/);
});
