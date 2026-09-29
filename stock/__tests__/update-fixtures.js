// 從 Google Sheet 抓最新 CSV 快照存成 fixtures（真實資料）
// 用法：node stock/__tests__/update-fixtures.js，之後需重新產生 golden.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { SHEET_NAME, NOTE_SHEET_NAME, sheetCsvUrl } from '../lib.js';

const fixturesDir = new URL('./fixtures/', import.meta.url);
mkdirSync(fixturesDir, { recursive: true });

for (const [sheetName, fileName] of [
    [SHEET_NAME, 'holdings.csv'],
    [NOTE_SHEET_NAME, 'notes.csv'],
]) {
    const response = await fetch(sheetCsvUrl(sheetName));
    if (!response.ok) {
        throw new Error(`${sheetName}: HTTP ${response.status}`);
    }
    writeFileSync(new URL(fileName, fixturesDir), await response.text());
    console.log(`${sheetName} → fixtures/${fileName}`);
}
