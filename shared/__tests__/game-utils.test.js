import test from 'node:test';
import assert from 'node:assert/strict';
import { setupCanvas, createLoop, autoPause, highScore, onSwipe, bindKeys } from '../game-utils.js';

// 帶有額外欄位的 DOM 事件（Node 沒有 PointerEvent / KeyboardEvent）
const makeEvent = (type, fields = {}) => Object.assign(new Event(type, { cancelable: true }), fields);

// 可手動推進時間的 requestAnimationFrame
function fakeFrames() {
    let time = 0;
    let callback = null;
    return {
        raf: (fn) => {
            callback = fn;
            return 1;
        },
        caf: () => {
            callback = null;
        },
        now: () => time,
        // 經過 ms 毫秒後觸發下一個畫面
        tick(ms) {
            time += ms;
            const fn = callback;
            callback = null;
            fn?.();
        },
    };
}

function memoryStorage() {
    const data = new Map();
    return {
        data,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
    };
}

test('setupCanvas：依 devicePixelRatio 放大實際像素並縮放座標', () => {
    const calls = [];
    const canvas = {
        style: {},
        getContext: () => ({ setTransform: (...args) => calls.push(args) }),
    };
    setupCanvas(canvas, 300, 150, { dpr: 2 });
    assert.equal(canvas.width, 600);
    assert.equal(canvas.height, 300);
    assert.deepEqual(canvas.style, { width: '300px', height: '150px' });
    assert.deepEqual(calls, [[2, 0, 0, 2, 0, 0]]);

    const styled = { style: {}, getContext: () => ({ setTransform() {} }) };
    setupCanvas(styled, 100, 100, { dpr: 1.5, setStyle: false });
    assert.equal(styled.width, 150);
    assert.deepEqual(styled.style, {});
});

test('createLoop：60Hz 與 120Hz 下 update 次數相同（固定步長）', () => {
    for (const frameMs of [1000 / 60, 1000 / 120]) {
        const frames = fakeFrames();
        let updates = 0;
        const loop = createLoop({ update: () => updates++, step: 1 / 60, ...frames });
        loop.start();
        const frameCount = Math.round(1000 / frameMs);
        for (let i = 0; i < frameCount; i++) frames.tick(frameMs);
        assert.ok(Math.abs(updates - 60) <= 1, `${frameMs.toFixed(1)}ms/frame → ${updates} updates`);
    }
});

test('createLoop：長時間中斷後最多補算 maxFrameTime 秒', () => {
    const frames = fakeFrames();
    let updates = 0;
    const loop = createLoop({ update: () => updates++, step: 1 / 60, maxFrameTime: 0.25, ...frames });
    loop.start();
    frames.tick(60_000);
    assert.equal(updates, 15);
});

test('createLoop：stop 後不再更新，可再次 start', () => {
    const frames = fakeFrames();
    let updates = 0;
    const loop = createLoop({ update: () => updates++, step: 1 / 60, ...frames });
    loop.start();
    frames.tick(100);
    loop.stop();
    assert.equal(loop.running, false);
    const afterStop = updates;
    frames.tick(100);
    assert.equal(updates, afterStop);

    loop.start();
    assert.equal(loop.running, true);
    frames.tick(50);
    assert.ok(updates > afterStop);
});

test('createLoop：render 收到 0–1 之間的插值比例', () => {
    const frames = fakeFrames();
    const alphas = [];
    const loop = createLoop({ update() {}, render: (alpha) => alphas.push(alpha), step: 0.01, ...frames });
    loop.start();
    frames.tick(15);
    assert.ok(Math.abs(alphas[0] - 0.5) < 1e-9);
});

test('autoPause：分頁隱藏時暫停、回到前景時繼續', () => {
    const doc = new EventTarget();
    const log = [];
    const dispose = autoPause({ pause: () => log.push('pause'), resume: () => log.push('resume') }, { doc });

    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(log, ['pause', 'resume']);

    dispose();
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(log.length, 2);
});

test('highScore：只在刷新紀錄時寫入；asc 代表越低越好', () => {
    const storage = memoryStorage();
    const best = highScore('snake', { storage });
    assert.equal(best.get(), null);
    assert.equal(best.submit(10), true);
    assert.equal(best.submit(5), false);
    assert.equal(best.submit(12), true);
    assert.equal(best.get(), 12);
    assert.equal(storage.data.get('jsgames:snake:best'), '12');

    const time = highScore('minesweeper', { storage, order: 'asc' });
    assert.equal(time.submit(90), true);
    assert.equal(time.submit(120), false);
    assert.equal(time.submit(60), true);
    assert.equal(time.get(), 60);

    assert.equal(best.submit(Number.NaN), false);
});

test('highScore：localStorage 不可用時不丟錯', () => {
    const broken = {
        getItem() {
            throw new Error('SecurityError');
        },
        setItem() {
            throw new Error('SecurityError');
        },
    };
    const best = highScore('tetris', { storage: broken });
    assert.equal(best.get(), null);
    assert.equal(best.submit(100), false);
});

test('onSwipe：依位移較大的方向判斷，未達門檻不觸發', () => {
    const element = new EventTarget();
    const directions = [];
    const dispose = onSwipe(element, (direction) => directions.push(direction), { threshold: 30 });

    const swipe = (dx, dy) => {
        element.dispatchEvent(makeEvent('pointerdown', { clientX: 100, clientY: 100 }));
        element.dispatchEvent(makeEvent('pointerup', { clientX: 100 + dx, clientY: 100 + dy }));
    };
    swipe(50, 10);
    swipe(-50, 20);
    swipe(5, 60);
    swipe(-10, -40);
    swipe(10, 10);
    assert.deepEqual(directions, ['right', 'left', 'down', 'up']);

    element.dispatchEvent(makeEvent('pointerdown', { clientX: 0, clientY: 0 }));
    element.dispatchEvent(makeEvent('pointercancel'));
    element.dispatchEvent(makeEvent('pointerup', { clientX: 100, clientY: 0 }));
    assert.equal(directions.length, 4);

    dispose();
    swipe(50, 0);
    assert.equal(directions.length, 4);
});

test('bindKeys：有對應的按鍵才處理並 preventDefault，預設忽略重複觸發', () => {
    const target = new EventTarget();
    const pressed = [];
    const dispose = bindKeys({ ArrowLeft: () => pressed.push('left'), ' ': () => pressed.push('space') }, { target });

    const press = (key, repeat = false) => {
        const event = makeEvent('keydown', { key, repeat });
        target.dispatchEvent(event);
        return event.defaultPrevented;
    };
    assert.equal(press('ArrowLeft'), true);
    assert.equal(press(' '), true);
    assert.equal(press('ArrowLeft', true), true);
    assert.equal(press('a'), false);
    assert.deepEqual(pressed, ['left', 'space']);

    dispose();
    press('ArrowLeft');
    assert.equal(pressed.length, 2);
});
