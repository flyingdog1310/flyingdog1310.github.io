// 遊戲共用工具（ES module）：高解析 canvas、固定步長 loop、自動暫停、最高分、輸入
// 用法：import { setupCanvas, createLoop, autoPause, highScore, onSwipe, bindKeys } from '../../shared/game-utils.js';

// 依 devicePixelRatio 設定 canvas 實際像素，繪圖時仍使用 CSS 座標
// 預設同時把 CSS 尺寸設為 cssWidth × cssHeight；若版面由 CSS 控制尺寸，傳 { setStyle: false }
export function setupCanvas(
    canvas,
    cssWidth,
    cssHeight,
    { dpr = globalThis.devicePixelRatio || 1, setStyle = true } = {}
) {
    if (setStyle) {
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
    }
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

// 固定步長的遊戲 loop：update(dt) 以固定的 step（秒）呼叫，不受螢幕更新率影響（60Hz / 120Hz 速度相同）
// render(alpha) 每個畫面呼叫一次，alpha 為目前進度落在兩次 update 之間的比例（0–1），可用來插值
export function createLoop({
    update,
    render = () => {},
    step = 1 / 60,
    // 分頁切回來等長時間中斷後，最多補算這麼多秒，避免一次跑幾千步
    maxFrameTime = 0.25,
    raf = globalThis.requestAnimationFrame?.bind(globalThis),
    caf = globalThis.cancelAnimationFrame?.bind(globalThis),
    now = () => performance.now(),
}) {
    let frameId = null;
    let last = 0;
    let accumulator = 0;

    function frame() {
        const current = now();
        accumulator += Math.min((current - last) / 1000, maxFrameTime);
        last = current;

        while (accumulator >= step) {
            update(step);
            accumulator -= step;
        }
        render(accumulator / step);
        frameId = raf(frame);
    }

    return {
        start() {
            if (frameId !== null) return;
            last = now();
            accumulator = 0;
            frameId = raf(frame);
        },
        stop() {
            if (frameId === null) return;
            caf(frameId);
            frameId = null;
        },
        get running() {
            return frameId !== null;
        },
    };
}

// 分頁切到背景（或首頁 modal 關閉、iframe 被隱藏）時呼叫 pause，回到前景時呼叫 resume
// 回傳移除監聽的函式
export function autoPause({ pause, resume }, { doc = globalThis.document } = {}) {
    const onChange = () => (doc.hidden ? pause() : resume());
    doc.addEventListener('visibilitychange', onChange);
    return () => doc.removeEventListener('visibilitychange', onChange);
}

// 每款遊戲的最佳紀錄，存在 localStorage（key：jsgames:<gameId>:best）
// order 為 'desc' 時分數越高越好，'asc' 時越低越好（例如完成時間）
// localStorage 不可用（無痕模式等）時 get() 回傳 null、submit() 不會丟錯
export function highScore(gameId, { order = 'desc', storage = globalThis.localStorage } = {}) {
    const key = `jsgames:${gameId}:best`;
    const isBetter = (score, best) => best === null || (order === 'desc' ? score > best : score < best);

    function get() {
        try {
            const value = Number.parseFloat(storage.getItem(key));
            return Number.isFinite(value) ? value : null;
        } catch {
            return null;
        }
    }

    return {
        get,
        // 回傳是否刷新紀錄
        submit(score) {
            if (!Number.isFinite(score) || !isBetter(score, get())) return false;
            try {
                storage.setItem(key, String(score));
            } catch {
                return false;
            }
            return true;
        },
    };
}

// 觸控 / 滑鼠滑動：callback 收到 'up' | 'down' | 'left' | 'right'
// 回傳移除監聽的函式
export function onSwipe(element, callback, { threshold = 30 } = {}) {
    let start = null;

    const onDown = (event) => {
        start = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event) => {
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        start = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
        if (Math.abs(dx) > Math.abs(dy)) callback(dx > 0 ? 'right' : 'left');
        else callback(dy > 0 ? 'down' : 'up');
    };
    const onCancel = () => {
        start = null;
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onCancel);
    return () => {
        element.removeEventListener('pointerdown', onDown);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onCancel);
    };
}

// 鍵盤對應：{ ArrowLeft: fn, ' ': fn, ... }，以 event.key 比對
// 有對應的按鍵會 preventDefault（避免方向鍵 / 空白鍵捲動頁面）；預設忽略按住不放的重複觸發
// 回傳移除監聽的函式
export function bindKeys(map, { target = globalThis, allowRepeat = false } = {}) {
    const onKeyDown = (event) => {
        const handler = map[event.key];
        if (!handler) return;
        event.preventDefault();
        if (event.repeat && !allowRepeat) return;
        handler(event);
    };
    target.addEventListener('keydown', onKeyDown);
    return () => target.removeEventListener('keydown', onKeyDown);
}
