import { SHEET_NAME, NOTE_SHEET_NAME, sheetCsvUrl, parseCSV, extractRemainingFunds, buildPortfolioView } from './lib.js';

const CACHE_KEY = 'stock:portfolio:v1';

// 目前進行中的載入，刷新時用來取消上一次請求
let currentController = null;

// 從Google Sheets獲取CSV數據
async function fetchSheetData(signal) {
    try {
        const response = await fetch(sheetCsvUrl(SHEET_NAME), { signal });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const csvText = await response.text();
        return parseCSV(csvText);
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

// 從"使用前請注意" sheet 取得剩餘資金，失敗時回傳 '--'
async function fetchRemainingFunds(signal) {
    try {
        const response = await fetch(sheetCsvUrl(NOTE_SHEET_NAME), { signal });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const csvText = await response.text();
        return extractRemainingFunds(csvText);
    } catch (error) {
        console.error('Error fetching remaining funds:', error);
        return '--';
    }
}

// 上次成功載入的結果；無痕模式或資料損毀時回傳 null
function readCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (cached && typeof cached.time === 'string' && Array.isArray(cached.view?.rows)) {
            return cached;
        }
    } catch {
        // 讀不到快取就當作沒有
    }
    return null;
}

function writeCache(view, time) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ view, time }));
    } catch {
        // 寫不進去不影響顯示
    }
}

function renderView(view) {
    document.getElementById('remainingFunds').textContent = view.remainingFundsText;
    document.getElementById('stockMarketValue').textContent = view.stockMarketValueText;

    const tbody = document.getElementById('stocksTableBody');
    tbody.innerHTML = '';

    view.rows.forEach((cells) => {
        const row = document.createElement('tr');
        cells.forEach((cell) => {
            const td = document.createElement('td');
            td.textContent = cell.text;
            if (cell.className) td.className = cell.className;
            row.appendChild(td);
        });
        tbody.appendChild(row);
    });
}

// 加載並顯示數據；useCache 時先顯示上次的結果，再背景更新
async function loadAndDisplayData({ useCache = false } = {}) {
    const content = document.getElementById('content');
    const spinner = document.getElementById('loadingSpinner');
    const errorMessage = document.getElementById('errorMessage');
    const refreshBtn = document.getElementById('refreshBtn');
    const lastUpdate = document.getElementById('lastUpdate');

    currentController?.abort();
    const controller = new AbortController();
    currentController = controller;
    refreshBtn.disabled = true;

    const cached = useCache ? readCache() : null;
    if (cached) {
        renderView(cached.view);
        lastUpdate.textContent = `最後更新：${cached.time}（更新中…）`;
        document.getElementById('footerTime').textContent = cached.time;
        content.style.display = 'block';
        spinner.style.display = 'none';
    } else {
        spinner.style.display = 'block';
        content.style.display = 'none';
    }
    errorMessage.style.display = 'none';

    try {
        const [stocks, remainingFunds] = await Promise.all([
            fetchSheetData(controller.signal),
            fetchRemainingFunds(controller.signal),
        ]);
        if (controller.signal.aborted) return;

        const view = buildPortfolioView(stocks, remainingFunds);
        renderView(view);

        // 更新時間戳
        const now = new Date();
        const timeString = now.toLocaleString('zh-TW');
        lastUpdate.textContent = `最後更新：${timeString}`;
        document.getElementById('footerTime').textContent = timeString;
        writeCache(view, timeString);

        content.style.display = 'block';
        spinner.style.display = 'none';
    } catch (error) {
        if (controller.signal.aborted) return;

        console.error('Error:', error);
        errorMessage.textContent =
            '⚠️ ' + error.message + ' 請確保Google Sheet是公開的，並檢查"持股狀況"sheet是否存在。';
        errorMessage.style.display = 'block';
        content.style.display = 'block';
        spinner.style.display = 'none';
        if (cached) {
            lastUpdate.textContent = `最後更新：${cached.time}（更新失敗，顯示的是上次的資料）`;
        }
    } finally {
        if (currentController === controller) {
            currentController = null;
            refreshBtn.disabled = false;
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadAndDisplayData({ useCache: true });

    // 刷新按鈕事件
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadAndDisplayData();
    });
});
