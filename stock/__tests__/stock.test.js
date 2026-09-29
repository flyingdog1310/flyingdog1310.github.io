import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScenarios, moduleLoader, runScenario, startScenario } from './harness.js';
import { SHEET_NAME, NOTE_SHEET_NAME } from '../lib.js';
import {
    calculateSummary,
    extractRemainingFunds,
    parseCSV,
    parseCSVRows,
    buildPortfolioView,
    sortRows,
} from '../lib.js';

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
    const [up, flat, down, empty] = buildPortfolioView(parseCSV(csv), '--').rows.map(({ 5: { text, className } }) => ({
        text,
        className,
    }));
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

// ---- 1b：並行請求、刷新控制、不使用快取、textContent ----

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

test('每次都直接向 Google 取資料：fetch 帶 cache: no-store', async () => {
    await withScenario(scenarios['real-data'], async (env) => {
        await env.fireDOMContentLoaded();
        await env.clickRefresh();
        assert.equal(env.fetchOptions.length, 4);
        assert.ok(env.fetchOptions.every((options) => options?.cache === 'no-store'));
    });
});

test('不讀寫 localStorage：即使裡面有舊版快取，開頁也只顯示剛抓到的資料', async () => {
    const staleView = {
        remainingFundsText: '$1',
        stockMarketValueText: '$1',
        rows: [[{ text: '舊資料' }]],
    };
    const storage = {
        'stock:portfolio:v1': JSON.stringify({ time: '2000/1/1', view: staleView }),
        'stock:portfolio:v2': JSON.stringify({ time: '2000/1/1', view: staleView }),
    };
    await withScenario({ ...scenarios['real-data'], storage, deferred: true }, async (env) => {
        await env.fireDOMContentLoaded();
        const beforeFetch = env.snapshot();
        assert.equal(beforeFetch.contentDisplay, 'none');
        assert.equal(beforeFetch.spinnerDisplay, 'block');
        assert.deepEqual(beforeFetch.rows, []);

        await env.releaseFetches();
        assert.deepEqual(env.snapshot(), golden['real-data']);
        assert.deepEqual(Object.keys(Object.fromEntries(env.localStorage.data)).sort(), Object.keys(storage).sort());
        assert.equal(env.localStorage.data.get('stock:portfolio:v2'), storage['stock:portfolio:v2']);
    });

    assert.deepEqual(await runScenario({ ...scenarios['real-data'], storageThrows: true }, load), golden['real-data']);
});

test('開頁就載入失敗：不顯示任何數字，只顯示錯誤與重試', async () => {
    await withScenario(scenarios['holdings-http-error'], async (env) => {
        await env.fireDOMContentLoaded();
        const snapshot = env.snapshot();
        assert.deepEqual(snapshot, golden['holdings-http-error']);
        assert.equal(env.document.getElementById('retryBtn').hidden, false);
    });
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

// ---- 1c：摘要卡、刷新不閃爍、錯誤重試、排序 ----

const SUMMARY_CSV = [
    '"股票","持有股數","買入均價","現價","市值","未實現損益","未實現損益率"',
    '"A","1,000","500.5","1,050","1,050,000","549,500","109.79%"',
    '"B","200","150","140.25","28,050","-1,950","-6.50%"',
    '"C","10","10","10","100","",""',
    '"總和","1,210","","","1,078,150","547,550","50.78%"',
].join('\n');

test('摘要：總成本 = Σ持有股數×買入均價、總損益率以總成本為分母、總資產 = 可用資金 + 股票現值（皆排除總和列）', () => {
    const view = buildPortfolioView(parseCSV(SUMMARY_CSV), '1,234,567');
    assert.equal(view.stockMarketValueText, '$1,078,150');
    assert.equal(view.totalCostText, '$530,600'); // 500,500 + 30,000 + 100
    assert.equal(view.totalProfitText, '+$547,550');
    assert.equal(view.totalProfitRateText, '+103.19%'); // 547,550 / 530,600
    assert.equal(view.totalProfitClass, 'positive');
    assert.equal(view.totalAssetsText, '$2,312,717');
});

test('摘要：虧損為 negative；可用資金未知時總資產顯示 --', () => {
    const csv = '"股票","持有股數","買入均價","市值","未實現損益"\n"A","10","100","900","-100"';
    const view = buildPortfolioView(parseCSV(csv), '--');
    assert.equal(view.totalProfitText, '-$100');
    assert.equal(view.totalProfitRateText, '-10.00%');
    assert.equal(view.totalProfitClass, 'negative');
    assert.equal(view.totalAssetsText, '--');
});

test('摘要卡顯示在畫面上', async () => {
    await withScenario(scenarios['edge-cases'], async (env) => {
        await env.fireDOMContentLoaded();
        const text = (id) => env.document.getElementById(id).textContent;
        assert.equal(text('totalAssets'), '$2,312,717');
        assert.equal(text('totalProfit').startsWith('+$'), true);
        assert.ok(env.document.getElementById('totalProfit').classList.contains('positive'));
    });
});

test('排序：高→低、低→高、原始順序；無法解析的值永遠在最後', () => {
    const rows = buildPortfolioView(parseCSV(SUMMARY_CSV), '--').rows;
    const names = (sorted) => sorted.map((cells) => cells[0].text);
    assert.deepEqual(names(sortRows(rows, 5, 'descending')), ['A', '總和', 'B', 'C']);
    assert.deepEqual(names(sortRows(rows, 5, 'ascending')), ['B', '總和', 'A', 'C']);
    assert.deepEqual(names(sortRows(rows, 5, 'none')), ['A', 'B', 'C', '總和']);
    assert.deepEqual(names(rows), ['A', 'B', 'C', '總和']);
});

test('手機排序選單會重排表格，刷新後保留排序', async () => {
    await withScenario(scenarios['edge-cases'], async (env) => {
        await env.fireDOMContentLoaded();
        const firstCells = () =>
            env.document.getElementById('stocksTableBody').children.map((row) => row.children[0].textContent);
        const original = firstCells();

        await env.selectSort('5:ascending');
        const sorted = firstCells();
        assert.equal(sorted[0], '0050 元大台灣50');
        assert.notDeepEqual(sorted, original);

        await env.clickRefresh();
        assert.deepEqual(firstCells(), sorted);

        await env.selectSort('');
        assert.deepEqual(firstCells(), original);
    });
});

test('已有資料時刷新：畫面保留並淡化，不顯示 spinner', async () => {
    const scenario = { ...scenarios['real-data'], deferred: true };
    await withScenario(scenario, async (env) => {
        await env.fireDOMContentLoaded();
        await env.releaseFetches();

        await env.clickRefresh();
        const during = env.snapshot();
        assert.equal(during.contentDisplay, 'block');
        assert.equal(during.spinnerDisplay, 'none');
        assert.deepEqual(during.rows, golden['real-data'].rows);
        assert.ok(env.document.getElementById('content').classList.contains('is-refreshing'));

        await env.releaseFetches();
        assert.ok(!env.document.getElementById('content').classList.contains('is-refreshing'));
        assert.deepEqual(env.snapshot(), golden['real-data']);
    });
});

test('刷新失敗：保留原本資料、顯示錯誤與重試按鈕；重試成功後恢復', async () => {
    const failures = {};
    await withScenario({ ...scenarios['real-data'], failures }, async (env) => {
        await env.fireDOMContentLoaded();
        const retryBtn = env.document.getElementById('retryBtn');
        assert.equal(retryBtn.hidden, true);

        failures[SHEET_NAME] = 500;
        await env.clickRefresh();
        const failed = env.snapshot();
        assert.deepEqual(failed.rows, golden['real-data'].rows);
        assert.equal(failed.remainingFunds, golden['real-data'].remainingFunds);
        assert.equal(failed.errorDisplay, 'block');
        assert.equal(retryBtn.hidden, false);
        assert.match(env.document.getElementById('lastUpdate').textContent, /更新失敗/);

        delete failures[SHEET_NAME];
        await env.click('retryBtn');
        assert.equal(retryBtn.hidden, true);
        assert.deepEqual(env.snapshot(), golden['real-data']);
    });
});

test('表格每格帶有手機卡片版用的欄位標籤', async () => {
    await withScenario(scenarios['edge-cases'], async (env) => {
        await env.fireDOMContentLoaded();
        const [row] = env.document.getElementById('stocksTableBody').children;
        assert.deepEqual(
            row.children.map((td) => td.dataset.label),
            ['股票', '持有股數', '買入均價', '現價', '成本', '未實現損益', '未實現損益率']
        );
    });
});
