// 用本機 Chrome（headless + DevTools Protocol）替每款遊戲截一張縮圖 thumb.webp
// 用法：node scripts/capture-thumbs.js [game-id ...]（不帶參數則全部重截）
// 需要 Chrome；路徑可用 CHROME_PATH 指定，預設為 macOS 的安裝位置
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 截圖時的瀏覽器視窗大小與輸出大小（3:2，與首頁卡片比例一致）
const VIEWPORT = { width: 900, height: 600 };
const OUTPUT_WIDTH = 480;
const QUALITY = 75;
// 等遊戲畫完第一個畫面
const SETTLE_MS = 1500;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

function startStaticServer() {
    const server = createServer((req, res) => {
        const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
        const file = join(ROOT, path.endsWith('/') || path === '' ? join(path, 'index.html') : path);
        try {
            const body = readFileSync(file);
            res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404).end();
        }
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function launchChrome() {
    const userDataDir = mkdtempSync(join(tmpdir(), 'capture-thumbs-'));
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        'about:blank',
    ]);
    const wsUrl = new Promise((resolve, reject) => {
        let output = '';
        chrome.stderr.on('data', (chunk) => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) resolve(match[1]);
        });
        chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code})\n${output}`)));
    });
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    const close = async () => {
        chrome.kill();
        await exited;
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    };
    return { wsUrl, close };
}

// 最小的 CDP client：send(method, params, sessionId) → result；waitFor(event, sessionId)
function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const waiters = [];

    ws.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        if (message.id !== undefined) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
            return;
        }
        for (const waiter of waiters) {
            if (waiter.method === message.method && waiter.sessionId === message.sessionId) {
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.resolve(message.params);
                break;
            }
        }
    });

    const client = {
        send(method, params = {}, sessionId) {
            const id = ++nextId;
            ws.send(JSON.stringify({ id, method, params, sessionId }));
            return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        },
        waitFor(method, sessionId) {
            return new Promise((resolve) => waiters.push({ method, sessionId, resolve }));
        },
        close: () => ws.close(),
    };
    return new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve(client));
        ws.addEventListener('error', reject);
    });
}

async function capture(client, url) {
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    try {
        await client.send('Page.enable', {}, sessionId);
        await client.send(
            'Emulation.setDeviceMetricsOverride',
            { ...VIEWPORT, deviceScaleFactor: 1, mobile: false },
            sessionId
        );
        const loaded = client.waitFor('Page.loadEventFired', sessionId);
        await client.send('Page.navigate', { url }, sessionId);
        await loaded;
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

        const { data } = await client.send(
            'Page.captureScreenshot',
            {
                format: 'webp',
                quality: QUALITY,
                clip: { x: 0, y: 0, ...VIEWPORT, scale: OUTPUT_WIDTH / VIEWPORT.width },
            },
            sessionId
        );
        return Buffer.from(data, 'base64');
    } finally {
        await client.send('Target.closeTarget', { targetId });
    }
}

const games = JSON.parse(readFileSync(join(ROOT, 'games.json'), 'utf8'));
const only = new Set(process.argv.slice(2));
const targets = games.filter((game) => only.size === 0 || only.has(game.id));
if (targets.length === 0) {
    throw new Error(`找不到遊戲：${[...only].join(', ')}`);
}

const server = await startStaticServer();
const chrome = launchChrome();
try {
    const client = await connect(await chrome.wsUrl);
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const game of targets) {
        const image = await capture(client, `${origin}/${game.src}`);
        writeFileSync(join(ROOT, game.thumbnail), image);
        console.log(`${game.id.padEnd(16)} → ${game.thumbnail} (${(image.length / 1024).toFixed(1)} KB)`);
    }
    client.close();
} finally {
    await chrome.close();
    server.close();
}
