// 律師一試考古題：載入題目、作答後公布答案、答錯時附詳解連結；作答紀錄存在 localStorage
import {
    LETTERS,
    answerLabel,
    clearWrong,
    filterIndexes,
    isCorrect,
    parseProgress,
    splitStem,
    step,
    summarize,
    yamolUrl,
} from './lib.js';

const YEAR = 115;
const DATA_URL = `data/${YEAR}.json?v=1`;
// 科目按鈕上的短名稱
const SHORT_NAMES = { public: '公法', criminal: '刑法', civil: '民法', commercial: '商法・英文' };
const PAPER_KEY = 'bar-exam:paper';
const progressKey = (paperId) => `bar-exam:${YEAR}:${paperId}`;

const $ = (id) => document.getElementById(id);
const els = {
    examDate: $('examDate'),
    examTitle: $('examTitle'),
    papers: $('papers'),
    stats: $('stats'),
    progressBar: $('progressBar'),
    retryWrong: $('retryWrong'),
    resetPaper: $('resetPaper'),
    status: $('status'),
    card: $('card'),
    qno: $('qno'),
    paperName: $('paperName'),
    stem: $('stem'),
    options: $('options'),
    feedback: $('feedback'),
    prevBtn: $('prevBtn'),
    nextBtn: $('nextBtn'),
    grid: $('grid'),
    sourceLink: $('sourceLink'),
};

const EXTERNAL_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>';

let data = null;
let paperIdx = 0;
let filter = 'all';
// 剛作答的題目：在「未答」篩選下答完後仍要顯示，直到換題
let justAnswered = null;
// 每一科各自的 { answers, index }
const progress = new Map();

function storageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // 無痕模式等情況存不了就算了，本次瀏覽仍可作答
    }
}

const paper = () => data.papers[paperIdx];
const state = () => progress.get(paper().id);

function save() {
    storageSet(progressKey(paper().id), JSON.stringify(state()));
}

// ---- 繪製 ----

function renderPapers() {
    els.papers.replaceChildren(
        ...data.papers.map((p, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'paper-tab';
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', String(i === paperIdx));
            btn.title = `${p.title}（${p.scope}）`;
            const { answered, total } = summarize(p.questions, progress.get(p.id).answers);
            btn.innerHTML = `
                <span class="paper-tab__name"></span>
                <span class="paper-tab__sub"></span>
                <span class="paper-tab__meter" style="width:${(answered / total) * 100}%"></span>`;
            btn.querySelector('.paper-tab__name').textContent = SHORT_NAMES[p.id] || p.scope;
            btn.querySelector('.paper-tab__sub').textContent = `${answered}/${total} 題`;
            btn.addEventListener('click', () => selectPaper(i));
            return btn;
        })
    );
    els.papers.setAttribute('role', 'tablist');
}

function renderStats() {
    const s = summarize(paper().questions, state().answers);
    const rate = s.rate === null ? '—' : `${Math.round(s.rate * 100)}%`;
    els.stats.innerHTML = `
        <span>已答 <b>${s.answered}</b>/${s.total}</span>
        <span class="is-correct">對 <b>${s.correct}</b></span>
        <span class="is-wrong">錯 <b>${s.wrong}</b></span>
        <span>正確率 <b>${rate}</b></span>`;
    els.progressBar.style.width = `${(s.answered / s.total) * 100}%`;
    els.retryWrong.hidden = s.wrong === 0;
    els.resetPaper.hidden = s.answered === 0;
    for (const chip of document.querySelectorAll('.chip')) {
        chip.setAttribute('aria-checked', String(chip.dataset.filter === filter));
    }
}

function renderGrid() {
    const { answers, index } = state();
    const visible = new Set(filterIndexes(paper().questions, answers, filter));
    els.grid.replaceChildren(
        ...paper().questions.map((q, i) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'cell';
            cell.textContent = q.n;
            const choice = answers[q.n];
            let label = `第 ${q.n} 題，未作答`;
            if (choice) {
                const ok = isCorrect(q.answer, choice);
                cell.classList.add(ok ? 'is-correct' : 'is-wrong');
                label = `第 ${q.n} 題，${ok ? '答對' : '答錯'}`;
            }
            cell.classList.toggle('is-current', i === index);
            cell.classList.toggle('is-dim', !visible.has(i));
            cell.setAttribute('aria-label', label);
            if (i === index) cell.setAttribute('aria-current', 'true');
            cell.addEventListener('click', () => goTo(i, { scroll: true }));
            return cell;
        })
    );
}

function renderQuestion() {
    const p = paper();
    const { answers, index } = state();
    const indexes = filterIndexes(p.questions, answers, filter);

    // 篩選後沒有題目（例如沒有錯題）；剛答完的那題仍留在畫面上看答案
    if (indexes.length === 0 && index !== justAnswered) {
        showEmpty();
        return;
    }

    const q = p.questions[index];
    const choice = answers[q.n];
    els.status.hidden = true;
    els.card.hidden = false;
    els.qno.textContent = `第 ${q.n} 題 / ${p.questions.length}`;
    els.paperName.textContent = `${p.title} ${SHORT_NAMES[p.id] || ''}`;

    els.stem.replaceChildren(
        ...splitStem(q.stem).map((text) => {
            const para = document.createElement('p');
            para.textContent = text;
            return para;
        })
    );

    els.options.classList.toggle('is-answered', Boolean(choice));
    els.options.replaceChildren(
        ...LETTERS.map((letter) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'option';
            btn.dataset.letter = letter;
            btn.innerHTML = '<span class="option__letter"></span><span class="option__text"></span>';
            btn.querySelector('.option__letter').textContent = letter;
            btn.querySelector('.option__text').textContent = q.options[letter];
            if (choice) {
                btn.disabled = true;
                btn.classList.toggle('is-answer', isCorrect(q.answer, letter) && q.answer !== '#');
                btn.classList.toggle('is-picked', letter === choice);
            }
            btn.setAttribute('aria-label', `(${letter}) ${q.options[letter]}`);
            btn.addEventListener('click', () => choose(letter));
            return btn;
        })
    );

    renderFeedback(q, choice);

    els.prevBtn.disabled = step(indexes, index, -1) === null;
    els.nextBtn.disabled = step(indexes, index, 1) === null;
}

function renderFeedback(q, choice) {
    const fb = els.feedback;
    if (!choice) {
        fb.hidden = true;
        fb.replaceChildren();
        return;
    }
    const ok = isCorrect(q.answer, choice);
    const label = answerLabel(q.answer);
    fb.hidden = false;
    fb.className = `feedback ${ok ? 'is-correct' : 'is-wrong'}`;
    const verdict = document.createElement('span');
    verdict.className = 'feedback__verdict';
    if (ok) verdict.textContent = label ? `答對了，答案是 ${label}` : '本題一律給分';
    else verdict.textContent = `答錯了，正確答案是 ${label}`;

    const link = document.createElement('a');
    link.href = yamolUrl(q.yamol);
    link.target = '_blank';
    link.rel = 'noopener';
    if (ok) {
        link.textContent = '討論與詳解';
    } else {
        link.className = 'explain-link';
        link.innerHTML = `看詳解${EXTERNAL_ICON}`;
    }
    link.setAttribute('aria-label', `第 ${q.n} 題的網友詳解（阿摩線上測驗，另開新分頁）`);
    fb.replaceChildren(verdict, link);
}

function showEmpty() {
    els.card.hidden = true;
    els.status.hidden = false;
    els.status.textContent = filter === 'wrong' ? '這一科目前沒有答錯的題目。' : '這一科已經全部作答完畢。';
}

function render() {
    renderPapers();
    renderStats();
    renderQuestion();
    renderGrid();
}

// ---- 操作 ----

function choose(letter, { fromKey = false } = {}) {
    const q = paper().questions[state().index];
    if (els.card.hidden || state().answers[q.n]) return;
    state().answers[q.n] = letter;
    justAnswered = state().index;
    save();
    render();
    // 手機上回饋可能在畫面外，捲到看得到
    els.feedback.scrollIntoView({
        block: 'nearest',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    // 用鍵盤作答時把焦點移到「下一題」，按 Enter 就能繼續
    if (fromKey) els.nextBtn.focus({ preventScroll: true });
}

function goTo(index, { scroll = false } = {}) {
    if (index === null || index < 0 || index >= paper().questions.length) return;
    state().index = index;
    justAnswered = null;
    save();
    render();
    if (scroll) els.card.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function move(dir) {
    const { answers, index } = state();
    const next = step(filterIndexes(paper().questions, answers, filter), index, dir);
    if (next === null) return;
    goTo(next);
    // 換題後讓題目回到畫面上方（長題目時特別需要）
    const top = els.card.getBoundingClientRect().top;
    if (top < 0) els.card.scrollIntoView({ block: 'start' });
}

function setFilter(next) {
    filter = next;
    justAnswered = null;
    const { answers, index } = state();
    const indexes = filterIndexes(paper().questions, answers, filter);
    // 目前這題不在篩選結果裡時，跳到結果的第一題
    if (indexes.length && !indexes.includes(index)) state().index = indexes[0];
    render();
}

function selectPaper(i) {
    paperIdx = i;
    storageSet(PAPER_KEY, paper().id);
    els.sourceLink.href = paper().source;
    setFilter('all');
}

function retryWrong() {
    const p = paper();
    const s = summarize(p.questions, state().answers);
    if (!confirm(`清除 ${s.wrong} 題錯題的作答，重新作答？`)) return;
    const wrong = filterIndexes(p.questions, state().answers, 'wrong');
    state().answers = clearWrong(p.questions, state().answers);
    state().index = wrong[0] ?? 0;
    save();
    setFilter('todo');
}

function resetPaper() {
    if (!confirm(`清除「${SHORT_NAMES[paper().id]}」全部的作答紀錄？`)) return;
    progress.set(paper().id, { answers: {}, index: 0 });
    storageSet(progressKey(paper().id), null);
    setFilter('all');
}

function onKey(e) {
    if (!data || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, summary')) return;
    const key = e.key.toUpperCase();
    const letter = LETTERS.includes(key) ? key : LETTERS[Number(e.key) - 1];
    if (letter && e.key !== '0') {
        e.preventDefault();
        choose(letter, { fromKey: true });
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        move(1);
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move(-1);
    }
}

async function init() {
    try {
        const res = await fetch(DATA_URL);
        if (!res.ok) throw new Error(res.status);
        data = await res.json();
    } catch {
        els.status.textContent = '題目載入失敗，請重新整理頁面。';
        return;
    }
    const [y, m, d] = data.date.split('-');
    els.examDate.textContent = `${data.year}年 · ${y}/${m}/${d} 考試 · 官方標準答案`;
    els.examTitle.textContent = '律師第一試 考古題';
    document.title = `${data.year}年律師一試考古題`;

    for (const p of data.papers) progress.set(p.id, parseProgress(storageGet(progressKey(p.id)), p.questions));
    const savedPaper = data.papers.findIndex((p) => p.id === storageGet(PAPER_KEY));
    paperIdx = savedPaper >= 0 ? savedPaper : 0;
    els.sourceLink.href = paper().source;

    els.prevBtn.addEventListener('click', () => move(-1));
    els.nextBtn.addEventListener('click', () => move(1));
    els.retryWrong.addEventListener('click', retryWrong);
    els.resetPaper.addEventListener('click', resetPaper);
    for (const chip of document.querySelectorAll('.chip')) {
        chip.addEventListener('click', () => setFilter(chip.dataset.filter));
    }
    document.addEventListener('keydown', onKey);
    render();
}

init();
