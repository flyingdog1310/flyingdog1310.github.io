// 猜數字（Bulls and Cows / 1A2B）：遊戲規則（純邏輯，不碰 DOM）
//
// 答案是 length 位數字，每一位都不同（可以 0 開頭）。每次猜測回報幾 A 幾 B：
// A（bull）是數字與位置都對，B（cow）是數字對但位置不對。
// 每一步是一個方法：type / erase / submit / giveUp，回傳這一步的結果給畫面做動畫，
// 沒有變化時回傳 null。

export const LEVELS = {
    easy: { length: 3 },
    normal: { length: 4 },
    hard: { length: 5 },
};

const DIGITS = '0123456789';

export function score(guess, secret) {
    let bulls = 0;
    let cows = 0;
    for (let i = 0; i < guess.length; i++) {
        if (guess[i] === secret[i]) bulls++;
        else if (secret.includes(guess[i])) cows++;
    }
    return { bulls, cows };
}

export function createSecret(length, random = Math.random) {
    const digits = [...DIGITS];
    for (let i = 0; i < length; i++) {
        const j = i + Math.floor(random() * (digits.length - i));
        [digits[i], digits[j]] = [digits[j], digits[i]];
    }
    return digits.slice(0, length).join('');
}

// 所有可能的答案（每位數字都不同），依長度快取
const codeCache = new Map();

export function allCodes(length) {
    let codes = codeCache.get(length);
    if (codes) return codes;
    codes = [];
    const build = (prefix) => {
        if (prefix.length === length) {
            codes.push(prefix);
            return;
        }
        for (const d of DIGITS) if (!prefix.includes(d)) build(prefix + d);
    };
    build('');
    codeCache.set(length, codes);
    return codes;
}

const isCode = (code, length) =>
    typeof code === 'string' && new RegExp(`^\\d{${length}}$`).test(code) && new Set(code).size === length;

// state：存檔（toJSON 的結果），用來接著玩
export function createBullsAndCows({ length = LEVELS.normal.length, secret, random = Math.random, state } = {}) {
    if (state) {
        length = state.length;
        secret = state.secret;
    }
    secret ??= createSecret(length, random);
    if (!isCode(secret, length)) throw new Error('答案必須是不重複的數字');

    const game = {
        length,
        secret,
        // 每次猜測：{ code, bulls, cows }
        guesses: [],
        // 正在輸入的數字
        current: '',
        // playing | won | gaveup
        status: 'playing',
    };

    if (state) {
        for (const code of state.guesses ?? []) {
            if (!isCode(code, length)) throw new Error('存檔格式錯誤');
            game.guesses.push({ code, ...score(code, secret) });
        }
        if (game.guesses.some((g) => g.bulls === length)) game.status = 'won';
        else if (state.status === 'gaveup') game.status = 'gaveup';
        if (game.status === 'playing' && isPrefix(state.current)) game.current = state.current;
    }

    function isPrefix(text) {
        return (
            typeof text === 'string' && text.length < length && /^\d*$/.test(text) && new Set(text).size === text.length
        );
    }

    // 結果：{ col }；數字已經用過時 { error: 'repeat', col: 用過的位置 }
    function type(digit) {
        if (game.status !== 'playing' || !/^\d$/.test(digit) || game.current.length >= length) return null;
        const used = game.current.indexOf(digit);
        if (used !== -1) return { error: 'repeat', col: used };
        game.current += digit;
        return { col: game.current.length - 1 };
    }

    function erase() {
        if (game.status !== 'playing' || !game.current) return null;
        game.current = game.current.slice(0, -1);
        return { col: game.current.length };
    }

    // 結果：{ row, bulls, cows, won }；不能送出時 { error, message }
    function submit() {
        if (game.status !== 'playing') return null;
        const code = game.current;
        if (code.length < length) return { error: 'short', message: 'Not enough digits' };
        if (game.guesses.some((g) => g.code === code)) return { error: 'repeat', message: 'Already guessed' };
        const result = score(code, secret);
        game.guesses.push({ code, ...result });
        game.current = '';
        const won = result.bulls === length;
        if (won) game.status = 'won';
        return { row: game.guesses.length - 1, ...result, won };
    }

    function giveUp() {
        if (game.status !== 'playing') return null;
        game.status = 'gaveup';
        game.current = '';
        return { secret };
    }

    // 與目前所有猜測結果相符的答案；只在猜測數改變時重新計算
    let cached = null;
    function candidates() {
        if (cached?.count !== game.guesses.length) {
            const list = allCodes(length).filter((code) =>
                game.guesses.every((g) => {
                    const s = score(g.code, code);
                    return s.bulls === g.bulls && s.cows === g.cows;
                })
            );
            cached = { count: game.guesses.length, list };
        }
        return cached.list;
    }

    // 每個數字目前能確定的事：'out' 一定不在答案裡、'in' 一定在答案裡，其餘不在結果中
    function digitStates() {
        const list = candidates();
        const states = {};
        for (const d of DIGITS) {
            const n = list.filter((code) => code.includes(d)).length;
            if (n === 0) states[d] = 'out';
            else if (n === list.length) states[d] = 'in';
        }
        return states;
    }

    function toJSON() {
        return {
            length,
            secret,
            guesses: game.guesses.map((g) => g.code),
            current: game.current,
            status: game.status,
        };
    }

    Object.assign(game, { type, erase, submit, giveUp, candidates, digitStates, toJSON });
    return game;
}
