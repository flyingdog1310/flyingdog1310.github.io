// 用「重構前」的 script.js 產生期望輸出 fixtures/golden.json
// 用法：node stock/__tests__/generate-golden.js [git-ref]（預設 64a88b7，Phase 1a 重構前的版本）
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classicLoader, loadScenarios, runScenario } from './harness.js';

const ref = process.argv[2] ?? '64a88b7';
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const source = execFileSync('git', ['show', `${ref}:stock/script.js`], { cwd: repoRoot, encoding: 'utf8' });

if (/^\s*import\s/m.test(source)) {
    throw new Error(`${ref}:stock/script.js 是 ES module，golden 必須由重構前的 classic script 產生`);
}

const golden = {};
for (const [name, scenario] of Object.entries(loadScenarios())) {
    golden[name] = await runScenario(scenario, classicLoader(source));
}

const outFile = new URL('./fixtures/golden.json', import.meta.url);
writeFileSync(outFile, JSON.stringify(golden, null, 2) + '\n');
console.log(`已由 ${ref} 產生 ${Object.keys(golden).length} 個情境 → ${fileURLToPath(outFile)}`);
