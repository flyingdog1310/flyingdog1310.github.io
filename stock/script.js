// Google Sheets ID
const SHEET_ID = '1fB2bHIsqryppo-_r5mXzBUxBOSgtYjcQ_WclKYELHnE';
const SHEET_NAME = '持股狀況';
const NOTE_SHEET_NAME = '使用前請注意';

// 從Google Sheets獲取CSV數據
async function fetchSheetData() {
    try {
        // 指定要導出的sheet
        const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
            SHEET_NAME
        )}`;

        const response = await fetch(csvUrl);
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

// 從"使用前請注意" sheet 取得D1的值
async function fetchRemainingFunds() {
    try {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
            NOTE_SHEET_NAME
        )}`;

        const response = await fetch(csvUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const csvText = await response.text();
        const lines = csvText.trim().split('\n');

        if (lines.length > 0) {
            // 直接解析第一行
            const firstLineValues = parseCSVLine(lines[0]);

            // 尋找"剩餘資金"的位置和它的值
            // 格式: "手續費折數","1","剩餘資金","160168"
            for (let i = 0; i < firstLineValues.length; i++) {
                if (firstLineValues[i] === '剩餘資金' && i + 1 < firstLineValues.length) {
                    return firstLineValues[i + 1];
                }
            }
        }

        return '--';
    } catch (error) {
        console.error('Error fetching remaining funds:', error);
        return '--';
    }
}

// CSV行解析函數
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

// 解析CSV數據（處理帶引號的字段）
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('表單數據格式不正確');
    }

    // 解析CSV行，正確處理帶引號的字段
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let insideQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (insideQuotes && nextChar === '"') {
                    current += '"';
                    i++;
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (char === ',' && !insideQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current.trim());
        return result;
    }

    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0 || values.every((v) => v === '')) continue;

        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }

    return data;
}

// 計算數據摘要
function calculateSummary(stocks) {
    let totalMarketValue = 0;

    // 尋找"總和"行並取得市值
    const totalRow = stocks.find(stock => stock['股票'] === '總和');
    if (totalRow) {
        // 移除逗號後才進行轉換
        const marketValueStr = (totalRow['市值'] || '0').replace(/,/g, '');
        totalMarketValue = parseFloat(marketValueStr);
    }

    return {
        totalMarketValue,
    };
}

// 格式化數字為貨幣
function formatCurrency(value) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

// 格式化價格到兩位小數
function formatPrice(value) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
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

        // 過濾掉空行和無效行
        const validStocks = stocks.filter((stock) => {
            const shares = stock['持有股數'];
            return shares && shares !== '';
        });

        if (validStocks.length === 0) {
            throw new Error('未找到有效的股票數據');
        }

        // 更新剩餘資金
        const fundsValue = parseFloat(remainingFunds.replace(/[,%]/g, '').trim());
        if (!isNaN(fundsValue) && remainingFunds !== '--') {
            document.getElementById('remainingFunds').textContent = formatCurrency(fundsValue);
        } else {
            document.getElementById('remainingFunds').textContent = remainingFunds;
        }

        // 計算摘要
        const summary = calculateSummary(validStocks);

        // 更新股票現值
        document.getElementById('stockMarketValue').textContent = formatCurrency(summary.totalMarketValue);

        const tbody = document.getElementById('stocksTableBody');
        tbody.innerHTML = '';

        validStocks.forEach((stock) => {
            const code = stock['股票'] || '--';
            const shares = parseFloat(stock['持有股數'] || 0);
            const costPerShare = parseFloat(stock['買入均價'] || 0);
            const currentPrice = parseFloat(stock['現價'] || 0);
            const unrealizedProfit = stock['未實現損益'] || '--';
            const unrealizedProfitRate = stock['未實現損益率'] || '--';

            const cost = shares * costPerShare;
            const cleanUnrealizedProfit = unrealizedProfit.replace(/[,%]/g, '').trim();
            const profitNum = parseFloat(cleanUnrealizedProfit);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${code}</td>
                <td>${shares.toFixed(0)}</td>
                <td>${formatPrice(costPerShare)}</td>
                <td>${formatPrice(currentPrice)}</td>
                <td>${formatCurrency(cost)}</td>
                <td class="${profitNum >= 0 ? 'positive' : 'negative'}">
                    ${profitNum >= 0 && unrealizedProfit !== '--' ? '+' : ''}${
                unrealizedProfit !== '--' ? formatCurrency(profitNum) : '--'
            }
                </td>
                <td class="${profitNum >= 0 ? 'positive' : 'negative'}">
                    ${unrealizedProfitRate}
                </td>
            `;
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
