// 律師考古題頁的純邏輯：判斷對錯、統計、題目篩選與作答紀錄的讀取，不碰 DOM

export const LETTERS = ['A', 'B', 'C', 'D'];

// 標準答案可能是單一字母、多個字母（「A或B」/「AB」都給分）或「#」（一律給分）
export function isCorrect(answer, choice) {
    if (!LETTERS.includes(choice)) return false;
    if (/[#＃]/.test(answer)) return true;
    return answer.includes(choice);
}

// 顯示用的正確答案：「(A)」或「(A)(B)」；一律給分時回傳 null
export function answerLabel(answer) {
    if (/[#＃]/.test(answer)) return null;
    return LETTERS.filter((l) => answer.includes(l))
        .map((l) => `(${l})`)
        .join('');
}

export function summarize(questions, answers) {
    let answered = 0;
    let correct = 0;
    for (const q of questions) {
        const choice = answers[q.n];
        if (!choice) continue;
        answered += 1;
        if (isCorrect(q.answer, choice)) correct += 1;
    }
    return {
        total: questions.length,
        answered,
        correct,
        wrong: answered - correct,
        rate: answered ? correct / answered : null,
    };
}

// 題幹裡有 ①②③ 列舉時，每項各自一段
export function splitStem(stem) {
    const marks = stem.match(/[①-⑩]/g) || [];
    if (new Set(marks).size < 2) return [stem];
    return stem
        .split(/\s*(?=[①-⑩])/)
        .map((s) => s.trim())
        .filter(Boolean);
}

// 依篩選條件回傳題目在陣列中的索引：all 全部、wrong 答錯、todo 未答
export function filterIndexes(questions, answers, filter) {
    const out = [];
    questions.forEach((q, i) => {
        const choice = answers[q.n];
        if (filter === 'wrong' && !(choice && !isCorrect(q.answer, choice))) return;
        if (filter === 'todo' && choice) return;
        out.push(i);
    });
    return out;
}

// 在篩選後的清單中往前 / 往後一題；目前這題不在清單裡時，找最近的一題
export function step(indexes, current, dir) {
    if (dir > 0) return indexes.find((i) => i > current) ?? null;
    for (let k = indexes.length - 1; k >= 0; k--) {
        if (indexes[k] < current) return indexes[k];
    }
    return null;
}

// 讀回 localStorage 的作答紀錄；格式不對或題號不存在的部分直接丟掉
export function parseProgress(raw, questions) {
    const empty = { answers: {}, index: 0 };
    if (!raw) return empty;
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return empty;
    }
    if (!data || typeof data !== 'object') return empty;
    const valid = new Set(questions.map((q) => String(q.n)));
    const answers = {};
    for (const [n, choice] of Object.entries(data.answers || {})) {
        if (valid.has(n) && LETTERS.includes(choice)) answers[n] = choice;
    }
    const index = Number.isInteger(data.index) && data.index >= 0 && data.index < questions.length ? data.index : 0;
    return { answers, index };
}

// 把答錯的題目清掉，讓這些題可以重新作答
export function clearWrong(questions, answers) {
    const out = {};
    for (const q of questions) {
        const choice = answers[q.n];
        if (choice && isCorrect(q.answer, choice)) out[q.n] = choice;
    }
    return out;
}

// 一試錄取分數換算成要答對的題數：全卷每題同分，滿分 / 總題數 = 每題分數
export function cutoffTarget(cutoff, papers) {
    const total = papers.reduce((sum, p) => sum + p.questions.length, 0);
    const needed = Math.ceil(cutoff.score / (cutoff.max / total));
    const rate = needed / total;
    const perPaper = Object.fromEntries(papers.map((p) => [p.id, Math.round(p.questions.length * rate)]));
    return { total, needed, rate, perPaper };
}

export function yamolUrl(itemId) {
    return `https://yamol.tw/item-${itemId}.htm`;
}
