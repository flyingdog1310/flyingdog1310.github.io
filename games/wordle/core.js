// Wordle：遊戲規則（純邏輯，不碰 DOM）
//
// 每一步是一個方法：type / erase / submit，回傳這一步的結果給畫面做動畫，沒有變化時回傳 null。
// 字典由外部注入（isWord），測試可以用小字庫。

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

// 每日題目：當地日期 2026-10-01 是第 1 題
const DAILY_EPOCH = Date.UTC(2026, 9, 1);
const DAY_MS = 86400000;
// 每日題目的出題順序：答案清單用固定種子洗牌（不要照字母順序）
const DAILY_SEED = 20261001;

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
const RANK = { absent: 1, present: 2, correct: 3 };

// 比對一次猜測：先標出位置正確的字母，剩下的字母才依答案裡還沒用掉的數量標成 present
// （例如答案只有一個 E，猜了兩個 E 時只有一個會變色）
export function score(guess, answer) {
    const marks = new Array(WORD_LENGTH).fill('absent');
    const left = {};
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (guess[i] === answer[i]) marks[i] = 'correct';
        else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
    }
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (marks[i] !== 'correct' && left[guess[i]] > 0) {
            marks[i] = 'present';
            left[guess[i]]--;
        }
    }
    return marks;
}

// 困難模式：已經猜中的位置要沿用，出現過的字母要用上（重複字母要用到同樣的數量）
// 回傳第一個不符合的說明，符合時回傳 null
export function hardModeError(guess, history) {
    for (const { word, marks } of history) {
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (marks[i] === 'correct' && guess[i] !== word[i]) {
                return `${ORDINALS[i]} letter must be ${word[i].toUpperCase()}`;
            }
        }
    }
    for (const { word, marks } of history) {
        const need = {};
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (marks[i] !== 'absent') need[word[i]] = (need[word[i]] ?? 0) + 1;
        }
        for (const [letter, count] of Object.entries(need)) {
            const have = [...guess].filter((ch) => ch === letter).length;
            if (have < count) {
                const upper = letter.toUpperCase();
                return count === 1 ? `Guess must contain ${upper}` : `Guess must contain ${count} ${upper}s`;
            }
        }
    }
    return null;
}

// 第幾題每日題目（依當地日期）
export function dayNumber(date = new Date()) {
    return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - DAILY_EPOCH) / DAY_MS) + 1;
}

function seededRandom(seed) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

const dailyOrders = new WeakMap();

export function dailyAnswer(number, answers) {
    let order = dailyOrders.get(answers);
    if (!order) {
        const random = seededRandom(DAILY_SEED);
        order = answers.slice();
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        dailyOrders.set(answers, order);
    }
    const n = order.length;
    return order[(((number - 1) % n) + n) % n];
}

export function randomAnswer(answers, random = Math.random) {
    return answers[Math.floor(random() * answers.length)];
}

/**
 * 建立一局。
 * @param {object} options
 * @param {string} options.answer 答案（小寫）
 * @param {boolean} [options.hard] 困難模式
 * @param {(word: string) => boolean} [options.isWord] 字典
 * @param {object} [options.state] toJSON() 的存檔，用來接著玩
 */
export function createWordle({ answer, hard = false, isWord = () => true, state = null } = {}) {
    if (state) {
        answer = state.answer;
        hard = Boolean(state.hard);
    }
    if (!/^[a-z]{5}$/.test(answer ?? '')) throw new Error(`答案必須是五個小寫字母：${answer}`);

    const guesses = [];
    let current = '';
    let status = 'playing';

    function commit(word) {
        const marks = score(word, answer);
        guesses.push({ word, marks });
        if (word === answer) status = 'won';
        else if (guesses.length === MAX_GUESSES) status = 'lost';
        return marks;
    }

    // 存檔裡的猜測不再檢查字典與困難模式（當時已經檢查過）
    if (state) {
        for (const word of state.guesses ?? []) {
            if (status === 'playing' && /^[a-z]{5}$/.test(word)) commit(word);
        }
        if (status === 'playing' && /^[a-z]{0,5}$/.test(state.current ?? '')) current = state.current ?? '';
    }

    return {
        get answer() {
            return answer;
        },
        get hard() {
            return hard;
        },
        get status() {
            return status;
        },
        get current() {
            return current;
        },
        // 目前輸入到第幾列
        get row() {
            return guesses.length;
        },
        get guesses() {
            return guesses.map(({ word, marks }) => ({ word, marks: marks.slice() }));
        },

        type(letter) {
            letter = String(letter).toLowerCase();
            if (status !== 'playing' || current.length >= WORD_LENGTH || !/^[a-z]$/.test(letter)) return null;
            current += letter;
            return { row: guesses.length, col: current.length - 1, letter };
        },

        erase() {
            if (status !== 'playing' || current.length === 0) return null;
            current = current.slice(0, -1);
            return { row: guesses.length, col: current.length };
        },

        // 送出這一列：不合法時回傳 { error, message }，成功時回傳 { row, word, marks, status }
        submit() {
            if (status !== 'playing') return null;
            if (current.length < WORD_LENGTH) return { error: 'short', message: 'Not enough letters' };
            if (!isWord(current)) return { error: 'unknown', message: 'Not in word list' };
            if (hard) {
                const message = hardModeError(current, guesses);
                if (message) return { error: 'hard', message };
            }
            const row = guesses.length;
            const word = current;
            current = '';
            const marks = commit(word);
            return { row, word, marks: marks.slice(), status };
        },

        // 困難模式只能在還沒猜之前切換
        setHard(on) {
            if (guesses.length > 0 || status !== 'playing') return false;
            hard = Boolean(on);
            return true;
        },

        // 每個字母目前已知最好的結果（鍵盤上色用）
        letterStates() {
            const states = {};
            for (const { word, marks } of guesses) {
                for (let i = 0; i < WORD_LENGTH; i++) {
                    if (!states[word[i]] || RANK[marks[i]] > RANK[states[word[i]]]) states[word[i]] = marks[i];
                }
            }
            return states;
        },

        toJSON() {
            return { answer, hard, guesses: guesses.map((g) => g.word), current };
        },
    };
}

// ---------- 統計 ----------

export function emptyStats() {
    return { played: 0, wins: 0, streak: 0, lastDay: null, dist: new Array(MAX_GUESSES).fill(0) };
}

// 記錄一局的結果，回傳新的統計（不修改原本的）
// 每日題目（有 day）：前一天沒有贏，連勝就從 1 重新算；練習（day 為 null）：連贏就累加
export function recordResult(stats, { won, guesses, day = null }) {
    const next = { ...emptyStats(), ...stats };
    next.dist = Array.from({ length: MAX_GUESSES }, (_, k) => Number(stats?.dist?.[k]) || 0);
    next.played += 1;
    if (won) {
        next.wins += 1;
        next.dist[guesses - 1] += 1;
        const continues = day === null || (next.lastDay === day - 1 && next.streak > 0);
        next.streak = continues ? next.streak + 1 : 1;
    } else {
        next.streak = 0;
    }
    next.lastDay = day;
    return next;
}

// 目前的連勝：每日題目中間漏掉一天就斷了
export function currentStreak(stats, today = null) {
    if (!stats) return 0;
    if (today !== null && stats.lastDay !== null && stats.lastDay < today - 1) return 0;
    return stats.streak;
}

// 分享用的結果文字（emoji 方格）
export function shareText(game, title) {
    const tries = game.status === 'won' ? game.row : 'X';
    const squares = { correct: '🟩', present: '🟨', absent: '⬛' };
    const grid = game.guesses.map(({ marks }) => marks.map((m) => squares[m]).join(''));
    return `${title} ${tries}/${MAX_GUESSES}${game.hard ? '*' : ''}\n\n${grid.join('\n')}`;
}
