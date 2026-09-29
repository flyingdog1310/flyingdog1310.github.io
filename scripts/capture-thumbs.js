// 用本機 Chrome（headless + DevTools Protocol）替每款遊戲截一張縮圖 thumb.webp
// 用法：node scripts/capture-thumbs.js [game-id ...]（不帶參數則全部重截）
// 需要 Chrome；路徑可用 CHROME_PATH 指定，預設為 macOS 的安裝位置
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, startBrowser, startStaticServer } from './lib/cdp.js';

// 截圖時的瀏覽器視窗大小與輸出大小（3:2，與首頁卡片比例一致）
const VIEWPORT = { width: 900, height: 600 };
const OUTPUT_WIDTH = 480;
const QUALITY = 75;
// 等遊戲畫完第一個畫面
const SETTLE_MS = 1500;

const games = JSON.parse(readFileSync(join(ROOT, 'games.json'), 'utf8'));
const only = new Set(process.argv.slice(2));
const targets = games.filter((game) => only.size === 0 || only.has(game.id));
if (targets.length === 0) {
    throw new Error(`找不到遊戲：${[...only].join(', ')}`);
}

const server = await startStaticServer();
const browser = await startBrowser();
try {
    for (const game of targets) {
        const page = await browser.openPage(`${server.origin}/${game.src}`, { ...VIEWPORT, settleMs: SETTLE_MS });
        const { data } = await page.send('Page.captureScreenshot', {
            format: 'webp',
            quality: QUALITY,
            clip: { x: 0, y: 0, ...VIEWPORT, scale: OUTPUT_WIDTH / VIEWPORT.width },
        });
        await page.close();

        const image = Buffer.from(data, 'base64');
        writeFileSync(join(ROOT, game.thumbnail), image);
        console.log(`${game.id.padEnd(16)} → ${game.thumbnail} (${(image.length / 1024).toFixed(1)} KB)`);
    }
} finally {
    await browser.close();
    server.close();
}
