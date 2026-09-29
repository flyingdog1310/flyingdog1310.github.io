import {
    SHEET_NAME,
    NOTE_SHEET_NAME,
    COLUMNS,
    sheetCsvUrl,
    parseCSV,
    extractRemainingFunds,
    buildPortfolioView,
    sortRows,
} from './lib.js?v=1c';

// 目前進行中的載入，刷新時用來取消上一次請求
let currentController = null;
// 畫面上正在顯示的資料與它的時間（本次開頁後最近一次成功載入）
let currentView = null;
let currentViewTime = null;
// 表格排序狀態；direction 為 'none' 時維持 Sheet 原本順序
let sortState = { index: null, direction: 'none' };

// 從Google Sheets獲取CSV數據
async function fetchSheetData(signal) {
    try {
        const response = await fetch(sheetCsvUrl(SHEET_NAME), { signal, cache: 'no-store' });
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
        const response = await fetch(sheetCsvUrl(NOTE_SHEET_NAME), { signal, cache: 'no-store' });
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

function renderTable(rows) {
    const tbody = document.getElementById('stocksTableBody');
    tbody.innerHTML = '';

    sortRows(rows, sortState.index, sortState.direction).forEach((cells) => {
        const row = document.createElement('tr');
        cells.forEach((cell, index) => {
            const td = document.createElement('td');
            td.textContent = cell.text;
            td.dataset.label = COLUMNS[index];
            if (cell.className) td.className = cell.className;
            row.appendChild(td);
        });
        tbody.appendChild(row);
    });
}

function renderView(view) {
    const setText = (id, text) => {
        document.getElementById(id).textContent = text ?? '--';
    };

    setText('remainingFunds', view.remainingFundsText);
    setText('stockMarketValue', view.stockMarketValueText);
    setText('totalAssets', view.totalAssetsText);
    setText('totalCost', view.totalCostText);
    setText('totalProfit', view.totalProfitText);
    setText('totalProfitRate', view.totalProfitRateText);

    for (const id of ['totalProfit', 'totalProfitRate']) {
        const el = document.getElementById(id);
        el.classList.remove('positive', 'negative');
        if (view.totalProfitClass) el.classList.add(view.totalProfitClass);
    }

    renderTable(view.rows);
}

// 同步表頭的 aria-sort 與手機版的排序選單
function renderSortState() {
    document.querySelectorAll('#stocksTable th[data-sort-index]').forEach((th) => {
        const active = Number(th.dataset.sortIndex) === sortState.index;
        th.setAttribute('aria-sort', active ? sortState.direction : 'none');
    });
    document.getElementById('sortSelect').value =
        sortState.direction === 'none' ? '' : `${sortState.index}:${sortState.direction}`;
}

function setSort(index, direction) {
    sortState = direction === 'none' ? { index: null, direction: 'none' } : { index, direction };
    renderSortState();
    if (currentView) renderTable(currentView.rows);
}

// 點同一欄依序切換：高→低、低→高、原始順序
function nextDirection(index) {
    if (sortState.index !== index) return 'descending';
    return { descending: 'ascending', ascending: 'none' }[sortState.direction] ?? 'descending';
}

// 加載並顯示數據；每次都直接向 Google Sheet 取最新資料，不使用任何快取
async function loadAndDisplayData() {
    const content = document.getElementById('content');
    const spinner = document.getElementById('loadingSpinner');
    const errorMessage = document.getElementById('errorMessage');
    const refreshBtn = document.getElementById('refreshBtn');
    const retryBtn = document.getElementById('retryBtn');
    const lastUpdate = document.getElementById('lastUpdate');

    currentController?.abort();
    const controller = new AbortController();
    currentController = controller;
    refreshBtn.disabled = true;
    retryBtn.disabled = true;

    // 刷新時保留這次開頁後抓到的資料並淡化；還沒有資料才顯示 spinner
    if (currentView) {
        content.style.display = 'block';
        content.classList.add('is-refreshing');
        spinner.style.display = 'none';
        lastUpdate.textContent = `最後更新：${currentViewTime}（更新中…）`;
    } else {
        spinner.style.display = 'block';
        content.style.display = 'none';
    }
    errorMessage.style.display = 'none';
    errorMessage.textContent = '';
    retryBtn.hidden = true;

    try {
        const [stocks, remainingFunds] = await Promise.all([
            fetchSheetData(controller.signal),
            fetchRemainingFunds(controller.signal),
        ]);
        if (controller.signal.aborted) return;

        const view = buildPortfolioView(stocks, remainingFunds);

        // 更新時間戳
        const now = new Date();
        const timeString = now.toLocaleString('zh-TW');
        currentView = view;
        currentViewTime = timeString;
        renderView(view);
        lastUpdate.textContent = `最後更新：${timeString}`;
        document.getElementById('footerTime').textContent = timeString;

        content.style.display = 'block';
        spinner.style.display = 'none';
    } catch (error) {
        if (controller.signal.aborted) return;

        console.error('Error:', error);
        errorMessage.textContent =
            '⚠️ ' + error.message + ' 請確保Google Sheet是公開的，並檢查"持股狀況"sheet是否存在。';
        errorMessage.style.display = 'block';
        retryBtn.hidden = false;
        content.style.display = 'block';
        spinner.style.display = 'none';
        if (currentView) {
            lastUpdate.textContent = `最後更新：${currentViewTime}（更新失敗，顯示的是上次的資料）`;
        }
    } finally {
        if (currentController === controller) {
            currentController = null;
            refreshBtn.disabled = false;
            retryBtn.disabled = false;
            content.classList.remove('is-refreshing');
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadAndDisplayData();

    // 刷新 / 重試按鈕事件
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadAndDisplayData();
    });
    document.getElementById('retryBtn').addEventListener('click', () => {
        loadAndDisplayData();
    });

    // 點表頭排序
    document.querySelectorAll('#stocksTable th[data-sort-index]').forEach((th) => {
        th.querySelector('.sort-btn').addEventListener('click', () => {
            const index = Number(th.dataset.sortIndex);
            setSort(index, nextDirection(index));
        });
    });

    // 手機版排序選單
    document.getElementById('sortSelect').addEventListener('change', (event) => {
        const [index, direction] = event.target.value.split(':');
        setSort(Number(index), direction || 'none');
    });
});
