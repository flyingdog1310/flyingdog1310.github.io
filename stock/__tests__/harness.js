// 在 Node 裡用假的 DOM / fetch 執行股票頁的 script.js，擷取畫面上的結果
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { SHEET_NAME, NOTE_SHEET_NAME } from '../lib.js';

class FakeElement {
    constructor() {
        this.textContent = '';
        this._innerHTML = '';
        this.style = { display: '' };
        this.children = [];
        this.listeners = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        this._innerHTML = value;
        this.children = [];
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
    }

    dispatch(type) {
        (this.listeners[type] || []).forEach((fn) => fn({ type, target: this }));
    }
}

// 等所有 microtask（假 fetch 都是立即 resolve）跑完
function settle() {
    return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

function createEnv({ sheets, failures = {} }) {
    const elements = new Map();
    const docListeners = {};

    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, new FakeElement());
            return elements.get(id);
        },
        createElement() {
            return new FakeElement();
        },
        addEventListener(type, fn) {
            (docListeners[type] ||= []).push(fn);
        },
    };

    async function fetch(url) {
        const sheet = new URL(url).searchParams.get('sheet');
        if (failures[sheet]) {
            return { ok: false, status: failures[sheet], text: async () => '' };
        }
        if (!(sheet in sheets)) {
            throw new TypeError(`Failed to fetch ${sheet}`);
        }
        return { ok: true, status: 200, text: async () => sheets[sheet] };
    }

    const console = { error() {}, warn() {}, log() {} };

    function snapshot() {
        const el = (id) => document.getElementById(id);
        return {
            remainingFunds: el('remainingFunds').textContent,
            stockMarketValue: el('stockMarketValue').textContent,
            rows: el('stocksTableBody').children.map((row) => row.innerHTML),
            errorMessage: el('errorMessage').textContent,
            errorDisplay: el('errorMessage').style.display,
            contentDisplay: el('content').style.display,
            spinnerDisplay: el('loadingSpinner').style.display,
            lastUpdateSet: el('lastUpdate').textContent.startsWith('最後更新：'),
        };
    }

    return {
        document,
        fetch,
        console,
        snapshot,
        async fireDOMContentLoaded() {
            (docListeners.DOMContentLoaded || []).forEach((fn) => fn());
            await settle();
        },
        async clickRefresh() {
            document.getElementById('refreshBtn').dispatch('click');
            await settle();
        },
    };
}

// 執行一個情境；load(env) 負責把 script 載入到 env，可回傳 cleanup 函式
export async function runScenario(scenario, load) {
    const env = createEnv(scenario);
    const cleanup = await load(env);
    try {
        await env.fireDOMContentLoaded();
        if (scenario.refresh) await env.clickRefresh();
        return env.snapshot();
    } finally {
        cleanup?.();
    }
}

// 重構前的 script.js 是一般 <script>，放進獨立的 vm context 執行
export function classicLoader(source) {
    return async (env) => {
        const context = vm.createContext({ document: env.document, fetch: env.fetch, console: env.console });
        vm.runInContext(source, context);
    };
}

// 重構後的 script.js 是 ES module，每次用不同 query 繞過 import 快取
let moduleRun = 0;
export function moduleLoader(scriptUrl) {
    return async (env) => {
        const saved = { document: globalThis.document, fetch: globalThis.fetch, console: globalThis.console };
        Object.assign(globalThis, { document: env.document, fetch: env.fetch, console: env.console });
        await import(`${scriptUrl}?run=${++moduleRun}`);
        return () => Object.assign(globalThis, saved);
    };
}

// 合成的持股 CSV，涵蓋格式與邊界情況，不隨真實資料變動
const EDGE_HOLDINGS = [
    '"股票","持有股數","買入均價","現價","市值","未實現損益","未實現損益率"',
    '"2330 台積電","1,000","500.5","1,050","1,050,000","549,500","109.79%"',
    '"0050 元大台灣50","200","150","140.25","28,050","-1,950","-6.50%"',
    '"1234 無損益","10","10","10","100","",""',
    '"5678 引號""測試","5","20","","","0","0.00%"',
    '"","","","","","",""',
    '"未持有","","100","100","","",""',
    '"總和","1,215","","","1,078,150","547,550","50.78%"',
].join('\n');

const EDGE_NOTES = '"手續費折數","0.6","剩餘資金","1,234,567"\n"","","",""';

export function loadScenarios() {
    const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    const holdings = fixture('holdings.csv');
    const notes = fixture('notes.csv');

    const header = holdings.trim().split('\n')[0];
    const headerCells = header.split(',');
    const codeIndex = headerCells.indexOf('"股票"');
    const noSharesRow = headerCells.map((_, i) => (i === codeIndex ? '"無股數"' : '""')).join(',');

    return {
        'real-data': { sheets: { [SHEET_NAME]: holdings, [NOTE_SHEET_NAME]: notes } },
        'real-data-refresh': { sheets: { [SHEET_NAME]: holdings, [NOTE_SHEET_NAME]: notes }, refresh: true },
        'notes-http-error': { sheets: { [SHEET_NAME]: holdings }, failures: { [NOTE_SHEET_NAME]: 500 } },
        'notes-network-error': { sheets: { [SHEET_NAME]: holdings } },
        'notes-without-funds': { sheets: { [SHEET_NAME]: holdings, [NOTE_SHEET_NAME]: '"其他","1"\n"",""' } },
        'holdings-http-error': { sheets: { [NOTE_SHEET_NAME]: notes }, failures: { [SHEET_NAME]: 500 } },
        'holdings-header-only': { sheets: { [SHEET_NAME]: header, [NOTE_SHEET_NAME]: notes } },
        'no-valid-stocks': { sheets: { [SHEET_NAME]: `${header}\n${noSharesRow}`, [NOTE_SHEET_NAME]: notes } },
        'edge-cases': { sheets: { [SHEET_NAME]: EDGE_HOLDINGS, [NOTE_SHEET_NAME]: EDGE_NOTES } },
    };
}
