// 開發工具共用：本機靜態 server + headless Chrome（DevTools Protocol），無相依套件
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

// 靜態 server（預設以 repo 根目錄為根）；回傳 { origin, close }
export async function startStaticServer(root = ROOT) {
    const server = createServer((req, res) => {
        const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
        const file = join(root, path.endsWith('/') || path === '' ? join(path, 'index.html') : path);
        try {
            const body = readFileSync(file);
            res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404).end();
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function launchChrome() {
    const userDataDir = mkdtempSync(join(tmpdir(), 'cdp-chrome-'));
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        'about:blank',
    ]);
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    const wsUrl = new Promise((resolve, reject) => {
        let output = '';
        chrome.stderr.on('data', (chunk) => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) resolve(match[1]);
        });
        exited.then((code) => reject(new Error(`Chrome exited (${code})\n${output}`)));
    });
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

// 啟動 Chrome 並回傳 { openPage, close }
// openPage(url, { width, height, settleMs }) → { send(method, params), evaluate(expression), close() }
export async function startBrowser() {
    const chrome = launchChrome();
    const client = await connect(await chrome.wsUrl);

    async function openPage(url, { width = 1280, height = 800, settleMs = 1000 } = {}) {
        const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params) => client.send(method, params, sessionId);

        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        const loaded = client.waitFor('Page.loadEventFired', sessionId);
        await send('Page.navigate', { url });
        await loaded;
        await new Promise((resolve) => setTimeout(resolve, settleMs));

        return {
            send,
            async evaluate(expression) {
                const { result, exceptionDetails } = await send('Runtime.evaluate', {
                    expression,
                    awaitPromise: true,
                    returnByValue: true,
                });
                if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
                return result.value;
            },
            close: () => client.send('Target.closeTarget', { targetId }),
        };
    }

    return {
        openPage,
        async close() {
            client.close();
            await chrome.close();
        },
    };
}
