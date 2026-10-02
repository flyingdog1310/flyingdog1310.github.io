// 井字棋的遊戲規則與電腦對手（純邏輯，不碰 DOM）
// 盤面是長度 9 的陣列（列優先，0 = 左上、8 = 右下），每格 null | 'X' | 'O'

export const LINES = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
];

// 電腦對手的難度：easy 常常漏看、normal 會贏會擋但不會防雙殺、hard 下出完美的一步（不會輸）
export const LEVELS = ['easy', 'normal', 'hard'];

export const other = (mark) => (mark === 'X' ? 'O' : 'X');

// 有人連成一線時回傳 { mark, line }，否則 null
export function winnerOf(board) {
    for (const line of LINES) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line };
    }
    return null;
}

export const emptyCells = (board) => board.flatMap((cell, i) => (cell ? [] : [i]));

// 下在哪一格能讓 mark 立刻連成一線
export function winningMoves(board, mark) {
    return emptyCells(board).filter((i) => {
        const next = [...board];
        next[i] = mark;
        return winnerOf(next)?.mark === mark;
    });
}

// minimax：輪到 mark 下時，以 mark 的角度評分（贏越快越好、輸越慢越好、和局 0）
// 結果只取決於盤面、輪到誰與深度，所以記下來重複使用（空盤第一步從約 45 ms 降到幾乎 0）
const memo = new Map();

function score(board, mark, depth) {
    const key = `${board.map((c) => c ?? '.').join('')}${mark}${depth}`;
    let value = memo.get(key);
    if (value === undefined) {
        value = search(board, mark, depth);
        memo.set(key, value);
    }
    return value;
}

function search(board, mark, depth) {
    const win = winnerOf(board);
    if (win) return win.mark === mark ? 10 - depth : depth - 10;
    const empty = emptyCells(board);
    if (empty.length === 0) return 0;
    let best = -Infinity;
    for (const i of empty) {
        board[i] = mark;
        best = Math.max(best, -score(board, other(mark), depth + 1));
        board[i] = null;
        if (best === 9 - depth) break;
    }
    return best;
}

// 每個空格對 mark 而言的分數（給 hard 選步與測試用）
export function rateMoves(board, mark) {
    const work = [...board];
    return emptyCells(board).map((i) => {
        work[i] = mark;
        const value = -score(work, other(mark), 1);
        work[i] = null;
        return { index: i, score: value };
    });
}

const pick = (list, random) => list[Math.floor(random() * list.length)];

// 電腦這一步下在哪；同樣好的步隨機挑一個，讓每局不一樣
export function chooseMove(board, mark, level = 'hard', random = Math.random) {
    const empty = emptyCells(board);
    if (empty.length === 0 || winnerOf(board)) return null;

    if (level === 'hard') {
        // 空盤每一格都是和局，挑中央或角落看起來比較像高手
        if (empty.length === 9) return pick([0, 2, 4, 6, 8], random);
        const rated = rateMoves(board, mark);
        const top = Math.max(...rated.map((m) => m.score));
        return pick(
            rated.filter((m) => m.score === top).map((m) => m.index),
            random
        );
    }

    const wins = winningMoves(board, mark);
    const blocks = winningMoves(board, other(mark));
    if (level === 'normal') {
        if (wins.length) return pick(wins, random);
        if (blocks.length) return pick(blocks, random);
        // 有一半機會先搶中央，其餘隨機 — 不懂防雙殺，所以贏得了
        if (board[4] === null && random() < 0.5) return 4;
        return pick(empty, random);
    }

    // easy：看到能贏的步只有一半機會下、該擋的只有三分之一機會擋
    if (wins.length && random() < 0.5) return pick(wins, random);
    if (blocks.length && random() < 0.35) return pick(blocks, random);
    return pick(empty, random);
}

// first：先手的記號；state：存檔（toJSON 的結果），用來接著玩
export function createTicTacToe({ first = 'X', state } = {}) {
    if (state) first = state.first;
    if (first !== 'X' && first !== 'O') throw new Error('first 必須是 X 或 O');

    const game = {
        first,
        board: Array(9).fill(null),
        // 依序下過的格子
        moves: [],
        turn: first,
        // playing | won | draw
        status: 'playing',
        // 結束時 { mark, line }
        winner: null,
    };

    function refresh() {
        game.turn = game.moves.length % 2 === 0 ? first : other(first);
        game.winner = winnerOf(game.board);
        game.status = game.winner ? 'won' : game.moves.length === 9 ? 'draw' : 'playing';
    }

    // 回傳 { index, mark, won?: { mark, line }, draw? }；不能下（已有棋子、已結束）時回傳 null
    function play(index) {
        if (game.status !== 'playing' || !Number.isInteger(index) || index < 0 || index > 8) return null;
        if (game.board[index] !== null) return null;
        const mark = game.turn;
        game.board[index] = mark;
        game.moves.push(index);
        refresh();
        const result = { index, mark };
        if (game.status === 'won') result.won = game.winner;
        if (game.status === 'draw') result.draw = true;
        return result;
    }

    // 收回最後一步，回傳 { index, mark }；沒有可以收回的回傳 null
    function undo() {
        if (game.moves.length === 0) return null;
        const index = game.moves.pop();
        const mark = game.board[index];
        game.board[index] = null;
        refresh();
        return { index, mark };
    }

    const legalMoves = () => (game.status === 'playing' ? emptyCells(game.board) : []);
    const toJSON = () => ({ first, moves: [...game.moves] });

    Object.assign(game, { play, undo, legalMoves, toJSON });

    if (state) {
        if (!Array.isArray(state.moves)) throw new Error('存檔格式不符');
        for (const index of state.moves) if (!play(index)) throw new Error('存檔裡有不合法的一步');
    }
    return game;
}
