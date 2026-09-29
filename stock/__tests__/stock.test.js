import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScenarios, moduleLoader, runScenario, startScenario } from './harness.js';
import { SHEET_NAME, NOTE_SHEET_NAME } from '../lib.js';
import { calculateSummary, extractRemainingFunds, parseCSV, parseCSVRows, buildPortfolioView } from '../lib.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));
const scenarios = loadScenarios();
const scriptUrl = new URL('../script.js', import.meta.url).href;
const load = moduleLoader(scriptUrl);

// 逐步操作一個情境，結束時一定還原全域變數
async function withScenario(scenario, fn) {
    const { env, cleanup } = await startScenario(scenario, load);
    try {
        return await fn(env);
    } finally {
        cleanup();
    }
}

// 跑一次真實資料，取得成功載入後寫入的 localStorage 內容
async function storageAfterSuccess() {
    return withScenario(scenarios['real-data'], async (env) => {
        await env.fireDOMContentLoaded();
        return Object.fromEntries(env.localStorage.data);
    });
}

// ---- 與重構前（64a88b7）畫面輸出比對 ----

test('golden.json 涵蓋所有情境', () => {
    assert.deepEqual(Object.keys(golden).sort(), Object.keys(scenarios).sort());
});

for (const [name, scenario] of Object.entries(scenarios)) {
    test(`畫面輸出與重構前一致：${name}`, async () => {
        const snapshot = await runScenario(scenario, load);
        assert.deepEqual(snapshot, golden[name]);
    });
}

test('真實資料有載入成功（避免 golden 本身就是錯誤畫面）', () => {
    const real = golden['real-data'];
    assert.equal(real.errorDisplay, 'none');
    assert.ok(real.rows.length > 0);
    assert.ok(real.lastUpdateSet);
});

// ---- lib.js 規則 ----

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
    const [up, flat, down, empty] = buildPortfolioView(parseCSV(csv), '--').rows.map((cells) => cells[5]);
    assert.deepEqual(up, { text: '+$100', className: 'positive' });
    assert.deepEqual(flat, { text: '+$0', className: 'positive' });
    assert.deepEqual(down, { text: '-$100', className: 'negative' });
    assert.deepEqual(empty, { text: '--', className: 'negative' });
});

test('CSV 解析：\\r\\n、引號內換行、跳脫引號', () => {
    assert.deepEqual(parseCSVRows('"a","b"\r\n"c","d"'), [
        ['a', 'b'],
        ['c', 'd'],
    ]);
    assert.deepEqual(parseCSVRows('"多\n行","x"\n"say ""hi""",y'), [
        ['多\n行', 'x'],
        ['say "hi"', 'y'],
    ]);

    const stocks = parseCSV('"股票","持有股數"\r\n"備註\r\n第二行","10"\r\n"B","20"\r\n');
    assert.deepEqual(stocks, [
        { 股票: '備註\r\n第二行', 持有股數: '10' },
        { 股票: 'B', 持有股數: '20' },
    ]);
});

// ---- 1b：並行請求、刷新控制、快取、textContent ----

test('兩個 Sheet 請求同時發出，載入中刷新按鈕停用', async () => {
    await withScenario({ ...scenarios['real-data'], deferred: true }, async (env) => {
        await env.fireDOMContentLoaded();
        assert.deepEqual([...env.fetchCalls].sort(), [SHEET_NAME, NOTE_SHEET_NAME].sort());
        assert.equal(env.document.getElementById('refreshBtn').disabled, true);

        await env.releaseFetches();
        assert.equal(env.document.getElementById('refreshBtn').disabled, false);
        assert.deepEqual(env.snapshot(), golden['real-data']);
    });
});

test('載入中再次刷新：舊請求被取消，表格不會重複', async () => {
    await withScenario({ ...scenarios['real-data'], deferred: true }, async (env) => {
        await env.fireDOMContentLoaded();
        await env.clickRefresh();
        assert.equal(env.fetchCalls.length, 4);

        await env.releaseFetches();
        assert.deepEqual(env.snapshot(), golden['real-data']);
        assert.equal(env.document.getElementById('refreshBtn').disabled, false);
    });
});

test('成功載入後寫入快取', async () => {
    const storage = await storageAfterSuccess();
    const cached = JSON.parse(storage['stock:portfolio:v1']);
    assert.equal(typeof cached.time, 'string');
    assert.equal(cached.view.rows.length, golden['real-data'].rows.length);
});

test('有快取時開頁立刻顯示上次資料，更新完成後換成最新資料', async () => {
    const storage = await storageAfterSuccess();
    await withScenario({ ...scenarios['real-data'], storage, deferred: true }, async (env) => {
        await env.fireDOMContentLoaded();
        const beforeFetch = env.snapshot();
        assert.deepEqual(beforeFetch.rows, golden['real-data'].rows);
        assert.equal(beforeFetch.contentDisplay, 'block');
        assert.equal(beforeFetch.spinnerDisplay, 'none');
        assert.match(env.document.getElementById('lastUpdate').textContent, /更新中/);

        await env.releaseFetches();
        assert.deepEqual(env.snapshot(), golden['real-data']);
    });
});

test('有快取但更新失敗：保留上次資料並標示', async () => {
    const storage = await storageAfterSuccess();
    await withScenario({ ...scenarios['holdings-http-error'], storage }, async (env) => {
        await env.fireDOMContentLoaded();
        const snapshot = env.snapshot();
        assert.deepEqual(snapshot.rows, golden['real-data'].rows);
        assert.equal(snapshot.errorMessage, golden['holdings-http-error'].errorMessage);
        assert.equal(snapshot.errorDisplay, 'block');
        assert.match(env.document.getElementById('lastUpdate').textContent, /更新失敗/);
    });
});

test('快取損毀或 localStorage 不可用時，行為與沒有快取相同', async () => {
    for (const extra of [
        { storage: { 'stock:portfolio:v1': '{not json' } },
        { storage: { 'stock:portfolio:v1': '{"time":1}' } },
        { storageThrows: true },
    ]) {
        assert.deepEqual(await runScenario({ ...scenarios['real-data'], ...extra }, load), golden['real-data']);
    }
});

test('Sheet 內容以純文字顯示，不會被當成 HTML', async () => {
    const csv = '"股票","持有股數"\n"<img src=x onerror=alert(1)>","1"';
    await withScenario({ sheets: { [SHEET_NAME]: csv, [NOTE_SHEET_NAME]: '' } }, async (env) => {
        await env.fireDOMContentLoaded();
        const [row] = env.document.getElementById('stocksTableBody').children;
        assert.equal(row.innerHTML, '');
        assert.equal(row.children[0].textContent, '<img src=x onerror=alert(1)>');
    });
});
