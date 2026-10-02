// 2048 的遊戲規則（純邏輯，不碰 DOM）
// 盤面是 size × size 的陣列（列優先），每格是 null 或 { id, value }

export const SIZE = 4;
export const GOAL = 2048;
// 新方塊：90% 是 2、10% 是 4
const FOUR_CHANCE = 0.1;

export const DIRS = ['up', 'down', 'left', 'right'];

export function createGame({ random = Math.random, size = SIZE, state = null } = {}) {
    const game = {
        size,
        cells: Array(size * size).fill(null),
        score: 0,
        won: false,
        // 達到 2048 後選擇繼續玩
        keepPlaying: false,
        over: false,
        canUndo: false,
    };

    let nextId = 1;
    let history = null;
    const newTile = (value) => ({ id: nextId++, value });

    // ---------- 盤面工具 ----------

    const index = (x, y) => y * size + x;

    // 某個方向的每一條線：每條線的格子從「移動目標那一側」開始排
    function lines(dir) {
        const result = [];
        for (let a = 0; a < size; a++) {
            const line = [];
            for (let b = 0; b < size; b++) {
                if (dir === 'left') line.push(index(b, a));
                else if (dir === 'right') line.push(index(size - 1 - b, a));
                else if (dir === 'up') line.push(index(a, b));
                else line.push(index(a, size - 1 - b));
            }
            result.push(line);
        }
        return result;
    }

    const emptyCells = () => game.cells.flatMap((tile, i) => (tile ? [] : [i]));

    function spawn() {
        const empty = emptyCells();
        if (empty.length === 0) return null;
        const at = empty[Math.floor(random() * empty.length)];
        const tile = newTile(random() < FOUR_CHANCE ? 4 : 2);
        game.cells[at] = tile;
        return { id: tile.id, index: at, value: tile.value };
    }

    function hasMoves() {
        if (game.cells.some((tile) => !tile)) return true;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const value = game.cells[index(x, y)].value;
                if (x + 1 < size && game.cells[index(x + 1, y)].value === value) return true;
                if (y + 1 < size && game.cells[index(x, y + 1)].value === value) return true;
            }
        }
        return false;
    }

    const snapshot = () => ({
        cells: game.cells.map((tile) => (tile ? { ...tile } : null)),
        score: game.score,
        won: game.won,
        keepPlaying: game.keepPlaying,
        over: game.over,
    });

    // ---------- 移動 ----------

    // 回傳這一步的結果（給畫面做動畫）；沒有任何方塊移動時回傳 null
    // { slides: [{ id, from, to }], merges: [{ id, value, to, from: [idA, idB] }], spawned, gained }
    function move(dir) {
        if (game.over || !DIRS.includes(dir)) return null;
        const before = snapshot();
        const slides = [];
        const merges = [];
        let gained = 0;
        const next = Array(size * size).fill(null);

        for (const line of lines(dir)) {
            // 每個方塊每一步最多合併一次：記錄這條線上最後放下的方塊是否已經是合併結果
            let target = 0;
            let last = null;
            for (const from of line) {
                const tile = game.cells[from];
                if (!tile) continue;
                if (last && !last.merged && last.tile.value === tile.value) {
                    const merged = newTile(tile.value * 2);
                    const to = line[target - 1];
                    slides.push({ id: tile.id, from, to });
                    merges.push({ id: merged.id, value: merged.value, to, from: [last.tile.id, tile.id] });
                    next[to] = merged;
                    last = { tile: merged, merged: true };
                    gained += merged.value;
                } else {
                    const to = line[target];
                    slides.push({ id: tile.id, from, to });
                    next[to] = tile;
                    last = { tile, merged: false };
                    target += 1;
                }
            }
        }

        const moved = merges.length > 0 || slides.some((s) => s.from !== s.to);
        if (!moved) return null;

        history = before;
        game.canUndo = true;
        game.cells = next;
        game.score += gained;
        const spawned = spawn();

        let reachedGoal = false;
        if (!game.won && merges.some((m) => m.value >= GOAL)) {
            game.won = true;
            reachedGoal = true;
        }
        game.over = !hasMoves();
        return { dir, slides, merges, spawned, gained, reachedGoal, over: game.over };
    }

    // 復原上一步（只能復原一步）
    function undo() {
        if (!history) return false;
        Object.assign(game, history);
        history = null;
        game.canUndo = false;
        return true;
    }

    function continueAfterWin() {
        game.keepPlaying = true;
    }

    const maxTile = () => Math.max(0, ...game.cells.map((tile) => tile?.value ?? 0));

    // 存檔：只存數值，id 載入時重新編號
    function toJSON() {
        return {
            size,
            cells: game.cells.map((tile) => tile?.value ?? 0),
            score: game.score,
            won: game.won,
            keepPlaying: game.keepPlaying,
        };
    }

    // ---------- 開局 / 讀檔 ----------

    function isValidState(s) {
        return (
            s &&
            s.size === size &&
            Array.isArray(s.cells) &&
            s.cells.length === size * size &&
            s.cells.some((v) => v > 0) &&
            s.cells.every((v) => v === 0 || (Number.isInteger(v) && v >= 2 && (v & (v - 1)) === 0)) &&
            Number.isFinite(s.score) &&
            s.score >= 0
        );
    }

    if (isValidState(state)) {
        game.cells = state.cells.map((value) => (value ? newTile(value) : null));
        game.score = state.score;
        game.won = Boolean(state.won);
        game.keepPlaying = Boolean(state.keepPlaying);
        game.over = !hasMoves();
    } else {
        spawn();
        spawn();
    }

    Object.assign(game, { move, undo, continueAfterWin, maxTile, toJSON, hasMoves });
    return game;
}
