// 股票頁的純函式（無 DOM、無網路），供 script.js 與測試共用

// Google Sheets ID
export const SHEET_ID = '1fB2bHIsqryppo-_r5mXzBUxBOSgtYjcQ_WclKYELHnE';
export const SHEET_NAME = '持股狀況';
export const NOTE_SHEET_NAME = '使用前請注意';

// 指定要導出的sheet
export function sheetCsvUrl(sheetName) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
        sheetName
    )}`;
}

// 將整份 CSV 解析成二維陣列（處理帶引號的字段、引號內換行與 \r\n），每格前後空白會被去掉
export function parseCSVRows(csvText) {
    const rows = [];
    let row = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            row.push(current.trim());
            current = '';
        } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !insideQuotes) {
            if (char === '\r') i++;
            row.push(current.trim());
            rows.push(row);
            row = [];
            current = '';
        } else {
            current += char;
        }
    }

    row.push(current.trim());
    rows.push(row);
    return rows;
}

// 解析CSV數據，第一行為欄位名稱
export function parseCSV(csvText) {
    const lines = parseCSVRows(csvText.trim());
    if (lines.length < 2) {
        throw new Error('表單數據格式不正確');
    }

    const headers = lines[0];
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i];
        if (values.length === 0 || values.every((v) => v === '')) continue;

        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }

    return data;
}

// 從"使用前請注意" sheet 的第一行找出「剩餘資金」右邊那格的值
// 格式: "手續費折數","1","剩餘資金","160168"
export function extractRemainingFunds(csvText) {
    const firstLineValues = parseCSVRows(csvText.trim())[0];

    for (let i = 0; i < firstLineValues.length; i++) {
        if (firstLineValues[i] === '剩餘資金' && i + 1 < firstLineValues.length) {
            return firstLineValues[i + 1];
        }
    }

    return '--';
}

// 過濾掉空行和無效行
export function filterValidStocks(stocks) {
    return stocks.filter((stock) => {
        const shares = stock['持有股數'];
        return shares && shares !== '';
    });
}

// 表格欄位（與 index.html 的 th 順序一致，手機卡片版用來當標籤）
export const COLUMNS = ['股票', '持有股數', '買入均價', '現價', '成本', '未實現損益', '未實現損益率'];

// 去掉千分位後轉數字（空值視為 0）
const parseAmount = (value) => parseFloat((value || '0').replace(/,/g, ''));

// 去掉千分位與 % 後轉數字；無法解析時為 NaN
const parseSigned = (value) => parseFloat(value.replace(/[,%]/g, '').trim());

// 計算數據摘要（皆排除「總和」行）
// totalCost 與表格「成本」欄相同：持有股數 × 買入均價
export function calculateSummary(stocks) {
    let totalMarketValue = 0;
    let totalCost = 0;
    let totalUnrealizedProfit = 0;

    stocks.forEach((stock) => {
        if (stock['股票'] !== '總和') {
            const marketValue = parseAmount(stock['市值']);
            if (!isNaN(marketValue)) {
                totalMarketValue += marketValue;
            }

            const cost = parseAmount(stock['持有股數']) * parseAmount(stock['買入均價']);
            if (!isNaN(cost)) {
                totalCost += cost;
            }

            const profit = parseSigned(stock['未實現損益'] || '');
            if (!isNaN(profit)) {
                totalUnrealizedProfit += profit;
            }
        }
    });

    return {
        totalMarketValue,
        totalCost,
        totalUnrealizedProfit,
    };
}

// 格式化數字為貨幣
export function formatCurrency(value) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

// 格式化價格到兩位小數
export function formatPrice(value) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

// 剩餘資金顯示文字：可解析為數字就格式化，否則原樣顯示
export function formatRemainingFunds(remainingFunds) {
    const fundsValue = parseFloat(remainingFunds.replace(/[,%]/g, '').trim());
    if (!isNaN(fundsValue) && remainingFunds !== '--') {
        return formatCurrency(fundsValue);
    }
    return remainingFunds;
}

// 漲紅跌綠：>= 0 為 positive（紅）、< 0 或無法解析為 negative（綠）
const profitClassOf = (value) => (value >= 0 ? 'positive' : 'negative');

// 排序用的值：無法解析的數字為 null（排序時永遠放最後）
const sortableNumber = (value) => (Number.isFinite(value) ? value : null);

// 單一持股的表格列：每格 { text, sortValue, className? }（漲紅跌綠由 .positive / .negative 決定）
export function buildStockRow(stock) {
    const code = stock['股票'] || '--';
    const shares = parseFloat((stock['持有股數'] || '0').replace(/,/g, ''));
    const costPerShare = parseFloat((stock['買入均價'] || '0').replace(/,/g, ''));
    const currentPrice = parseFloat((stock['現價'] || '0').replace(/,/g, ''));
    const unrealizedProfit = stock['未實現損益'] || '--';
    const unrealizedProfitRate = stock['未實現損益率'] || '--';

    const cost = shares * costPerShare;
    const cleanUnrealizedProfit = unrealizedProfit.replace(/[,%]/g, '').trim();
    const profitNum = parseFloat(cleanUnrealizedProfit);

    const profitClass = profitClassOf(profitNum);
    const profitSign = profitNum >= 0 && unrealizedProfit !== '--' ? '+' : '';
    const profitText = unrealizedProfit !== '--' ? formatCurrency(profitNum) : '--';

    return [
        { text: code, sortValue: code },
        { text: shares.toFixed(0), sortValue: sortableNumber(shares) },
        { text: formatPrice(costPerShare), sortValue: sortableNumber(costPerShare) },
        { text: formatPrice(currentPrice), sortValue: sortableNumber(currentPrice) },
        { text: formatCurrency(cost), sortValue: sortableNumber(cost) },
        { text: profitSign + profitText, sortValue: sortableNumber(profitNum), className: profitClass },
        {
            text: unrealizedProfitRate,
            sortValue: sortableNumber(parseSigned(unrealizedProfitRate)),
            className: profitClass,
        },
    ];
}

// 依某一欄排序（不改動原陣列）；direction 為 'none' 時維持 Sheet 原本順序
export function sortRows(rows, columnIndex, direction) {
    if (direction !== 'ascending' && direction !== 'descending') return rows;

    const factor = direction === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const x = a[columnIndex]?.sortValue ?? null;
        const y = b[columnIndex]?.sortValue ?? null;
        if (x === null || y === null) return (x === null) - (y === null);
        if (typeof x === 'string' || typeof y === 'string') {
            return factor * String(x).localeCompare(String(y), 'zh-TW');
        }
        return factor * (x - y);
    });
}

// 摘要卡：總資產、總成本、總未實現損益（金額與 %，分母為總成本）
function buildSummaryView(summary, remainingFunds) {
    const funds = parseSigned(remainingFunds);
    const hasFunds = !isNaN(funds) && remainingFunds !== '--';
    const profit = summary.totalUnrealizedProfit;
    const sign = profit >= 0 ? '+' : '';

    return {
        totalAssetsText: hasFunds ? formatCurrency(funds + summary.totalMarketValue) : '--',
        totalCostText: formatCurrency(summary.totalCost),
        totalProfitText: sign + formatCurrency(profit),
        totalProfitRateText:
            summary.totalCost > 0 ? `${sign}${((profit / summary.totalCost) * 100).toFixed(2)}%` : '--',
        totalProfitClass: profitClassOf(profit),
    };
}

// 將解析後的持股與剩餘資金轉成畫面要顯示的內容
export function buildPortfolioView(stocks, remainingFunds) {
    const validStocks = filterValidStocks(stocks);

    if (validStocks.length === 0) {
        throw new Error('未找到有效的股票數據');
    }

    const summary = calculateSummary(validStocks);

    return {
        remainingFundsText: formatRemainingFunds(remainingFunds),
        stockMarketValueText: formatCurrency(summary.totalMarketValue),
        ...buildSummaryView(summary, remainingFunds),
        rows: validStocks.map(buildStockRow),
    };
}
