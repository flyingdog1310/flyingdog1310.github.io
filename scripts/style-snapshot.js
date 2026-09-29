// 記錄頁面上每個元素最終套用的樣式（computed style），用來確認「只重構 CSS、畫面不變」
//
// 記錄：node scripts/style-snapshot.js <path> <out.json> [--width 1280] [--wait 1000] [--root <dir>]
//   例：node scripts/style-snapshot.js stock/ before.json --width 375 --wait 6000
//   --root 指定網站根目錄（預設為本 repo），可搭配 git worktree 記錄舊版本
// 比對：node scripts/style-snapshot.js --diff before.json after.json
//
// 每個元素以 DOM 路徑（tag:nth-child 串）為 key，記錄全部 computed style 以及 ::before / ::after。
// 不記錄 <head> 內的元素與 CSS 變數本身（--*）。
// 只看當下狀態：:hover、:focus 等互動狀態不會被記錄到。
import { readFileSync, writeFileSync } from 'node:fs';
import { startBrowser, startStaticServer } from './lib/cdp.js';

// 在頁面內執行：收集所有元素的 computed style
const COLLECT = `(() => {
    const pathOf = (el) => {
        const parts = [];
        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
            const index = node.parentElement ? [...node.parentElement.children].indexOf(node) + 1 : 1;
            parts.unshift(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + ':' + index);
        }
        return parts.join('>');
    };
    // CSS 變數（--*）本身不影響畫面，只比對它們解析後的結果
    const read = (style) => {
        const out = {};
        for (const prop of style) {
            if (!prop.startsWith('--')) out[prop] = style.getPropertyValue(prop);
        }
        return out;
    };
    const result = {};
    // <head> 內的元素不會被畫出來
    for (const el of document.querySelectorAll('html, body, body *')) {
        const key = pathOf(el);
        result[key] = read(getComputedStyle(el));
        for (const pseudo of ['::before', '::after']) {
            const style = getComputedStyle(el, pseudo);
            if (style.content && style.content !== 'none' && style.content !== 'normal') {
                result[key + pseudo] = read(style);
            }
        }
    }
    return result;
})()`;

function diff(beforeFile, afterFile) {
    const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
    const after = JSON.parse(readFileSync(afterFile, 'utf8'));
    let count = 0;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!(key in before) || !(key in after)) {
            console.log(`${key in before ? '- 消失' : '+ 新增'} ${key}`);
            count++;
            continue;
        }
        for (const prop of new Set([...Object.keys(before[key]), ...Object.keys(after[key])])) {
            if (before[key][prop] !== after[key][prop]) {
                console.log(`${key}\n    ${prop}: ${before[key][prop]} → ${after[key][prop]}`);
                count++;
            }
        }
    }
    console.log(count === 0 ? '✔ 完全相同' : `✖ ${count} 處不同`);
    process.exitCode = count === 0 ? 0 : 1;
}

async function snapshot(path, outFile, { width, wait, root }) {
    const server = await startStaticServer(root);
    const browser = await startBrowser();
    try {
        const page = await browser.openPage(`${server.origin}/${path}`, { width, height: 900, settleMs: wait });
        const styles = await page.evaluate(COLLECT);
        writeFileSync(outFile, JSON.stringify(styles));
        console.log(`${Object.keys(styles).length} 個元素 → ${outFile}`);
    } finally {
        await browser.close();
        server.close();
    }
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
};

if (args[0] === '--diff') {
    diff(args[1], args[2]);
} else if (args.length >= 2) {
    await snapshot(args[0], args[1], {
        width: Number(option('--width', 1280)),
        wait: Number(option('--wait', 1000)),
        root: option('--root', undefined),
    });
} else {
    console.error('用法：node scripts/style-snapshot.js <path> <out.json> [--width 1280] [--wait 1000] [--root <dir>]');
    console.error('      node scripts/style-snapshot.js --diff before.json after.json');
    process.exitCode = 1;
}
