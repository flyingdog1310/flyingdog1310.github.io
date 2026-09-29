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

// 計算數據摘要
export function calculateSummary(stocks) {
    let totalMarketValue = 0;

    // 遍歷所有股票（排除「總和」行），加總市值
    stocks.forEach((stock) => {
        if (stock['股票'] !== '總和') {
            const marketValueStr = (stock['市值'] || '0').replace(/,/g, '');
            const marketValue = parseFloat(marketValueStr);
            if (!isNaN(marketValue)) {
                totalMarketValue += marketValue;
            }
        }
    });

    return {
        totalMarketValue,
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

// 單一持股的表格列：每格 { text, className? }（漲紅跌綠由 .positive / .negative 決定）
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

    const profitClass = profitNum >= 0 ? 'positive' : 'negative';
    const profitSign = profitNum >= 0 && unrealizedProfit !== '--' ? '+' : '';
    const profitText = unrealizedProfit !== '--' ? formatCurrency(profitNum) : '--';

    return [
        { text: code },
        { text: shares.toFixed(0) },
        { text: formatPrice(costPerShare) },
        { text: formatPrice(currentPrice) },
        { text: formatCurrency(cost) },
        { text: profitSign + profitText, className: profitClass },
        { text: unrealizedProfitRate, className: profitClass },
    ];
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
        rows: validStocks.map(buildStockRow),
    };
}
