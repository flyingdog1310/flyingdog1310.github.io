import { SHEET_NAME, NOTE_SHEET_NAME, sheetCsvUrl, parseCSV, extractRemainingFunds, buildPortfolioView } from './lib.js';

// 從Google Sheets獲取CSV數據
async function fetchSheetData() {
    try {
        const response = await fetch(sheetCsvUrl(SHEET_NAME));
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
async function fetchRemainingFunds() {
    try {
        const response = await fetch(sheetCsvUrl(NOTE_SHEET_NAME));
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

// 加載並顯示數據
async function loadAndDisplayData() {
    const content = document.getElementById('content');
    const spinner = document.getElementById('loadingSpinner');
    const errorMessage = document.getElementById('errorMessage');

    spinner.style.display = 'block';
    content.style.display = 'none';
    errorMessage.style.display = 'none';

    try {
        const stocks = await fetchSheetData();
        const remainingFunds = await fetchRemainingFunds();

        const view = buildPortfolioView(stocks, remainingFunds);

        document.getElementById('remainingFunds').textContent = view.remainingFundsText;
        document.getElementById('stockMarketValue').textContent = view.stockMarketValueText;

        const tbody = document.getElementById('stocksTableBody');
        tbody.innerHTML = '';

        view.rowsHTML.forEach((rowHTML) => {
            const row = document.createElement('tr');
            row.innerHTML = rowHTML;
            tbody.appendChild(row);
        });

        // 更新時間戳
        const now = new Date();
        const timeString = now.toLocaleString('zh-TW');
        document.getElementById('lastUpdate').textContent = `最後更新：${timeString}`;
        document.getElementById('footerTime').textContent = timeString;

        content.style.display = 'block';
        spinner.style.display = 'none';
    } catch (error) {
        console.error('Error:', error);
        errorMessage.textContent =
            '⚠️ ' + error.message + ' 請確保Google Sheet是公開的，並檢查"持股狀況"sheet是否存在。';
        errorMessage.style.display = 'block';
        content.style.display = 'block';
        spinner.style.display = 'none';
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadAndDisplayData();

    // 刷新按鈕事件
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadAndDisplayData();
    });
});
