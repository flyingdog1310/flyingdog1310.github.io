// 踩地雷的遊戲規則（純邏輯，不碰 DOM）
// 盤面是 rows × cols 的陣列（列優先），每格 { mine, adjacent, state: 'hidden' | 'revealed' | 'flagged' }

export const LEVELS = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
};

export function createMinesweeper({ rows, cols, mines, random = Math.random }) {
    if (mines >= rows * cols) throw new Error('地雷數必須小於格子數');
    const game = {
        rows,
        cols,
        mines,
        cells: Array.from({ length: rows * cols }, () => ({ mine: false, adjacent: 0, state: 'hidden' })),
        // ready：還沒點第一下（地雷尚未放置）
        status: 'ready',
        flags: 0,
        revealedCount: 0,
    };

    // ---------- 工具 ----------

    function neighbors(index) {
        const r = Math.floor(index / cols);
        const c = index % cols;
        const result = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) result.push(nr * cols + nc);
            }
        }
        return result;
    }

    // 第一下保證安全：避開點的那一格與周圍 8 格（格子不夠時只避開那一格），讓第一下一定能打開一片
    function placeMines(first) {
        const safe = new Set([first]);
        if (rows * cols - 9 >= mines) for (const n of neighbors(first)) safe.add(n);
        const candidates = [];
        for (let i = 0; i < rows * cols; i++) if (!safe.has(i)) candidates.push(i);
        for (let k = 0; k < mines; k++) {
            const j = k + Math.floor(random() * (candidates.length - k));
            [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
            game.cells[candidates[k]].mine = true;
        }
        game.cells.forEach((cell, i) => {
            cell.adjacent = neighbors(i).filter((n) => game.cells[n].mine).length;
        });
        game.status = 'playing';
    }

    const isActive = () => game.status === 'ready' || game.status === 'playing';

    // ---------- 翻開 ----------

    // 從 starts 開始翻開；0 的格子會一路往外展開
    // 回傳翻開的格子與距離（depth，給畫面做由近到遠的動畫）
    function flood(starts) {
        const opened = [];
        const queue = starts.map((index) => ({ index, depth: 0 }));
        for (let q = 0; q < queue.length; q++) {
            const { index, depth } = queue[q];
            const cell = game.cells[index];
            if (cell.state !== 'hidden') continue;
            cell.state = 'revealed';
            game.revealedCount += 1;
            opened.push({ index, depth });
            if (cell.adjacent === 0 && !cell.mine) {
                for (const n of neighbors(index)) if (game.cells[n].state === 'hidden') queue.push({ index: n, depth: depth + 1 });
            }
        }
        return opened;
    }

    function lose(exploded) {
        game.status = 'lost';
        const wrongFlags = [];
        const mines = [];
        game.cells.forEach((cell, i) => {
            if (cell.mine && cell.state === 'hidden') mines.push(i);
            if (!cell.mine && cell.state === 'flagged') wrongFlags.push(i);
        });
        return { exploded, mines, wrongFlags };
    }

    function checkWin() {
        if (game.revealedCount !== rows * cols - mines) return null;
        game.status = 'won';
        // 剩下的地雷自動插旗
        const flagged = [];
        game.cells.forEach((cell, i) => {
            if (cell.mine && cell.state !== 'flagged') {
                cell.state = 'flagged';
                flagged.push(i);
            }
        });
        game.flags = mines;
        return { flagged };
    }

    // 結果：{ opened: [{ index, depth }], lost?: { exploded, mines, wrongFlags }, won?: { flagged } }
    // 沒有任何變化時回傳 null
    function reveal(index) {
        if (!isActive()) return null;
        const cell = game.cells[index];
        if (!cell || cell.state === 'flagged') return null;
        if (cell.state === 'revealed') return chord(index);

        if (game.status === 'ready') placeMines(index);
        if (cell.mine) {
            cell.state = 'revealed';
            return { opened: [{ index, depth: 0 }], lost: lose(index) };
        }
        const opened = flood([index]);
        const won = checkWin();
        return won ? { opened, won } : { opened };
    }

    // 點已翻開的數字：周圍旗子數等於數字時，翻開其餘的鄰格（旗子插錯就會踩到）
    function chord(index) {
        if (game.status !== 'playing') return null;
        const cell = game.cells[index];
        if (cell.state !== 'revealed' || cell.adjacent === 0) return null;
        const around = neighbors(index);
        const flagged = around.filter((n) => game.cells[n].state === 'flagged').length;
        if (flagged !== cell.adjacent) return null;
        const hidden = around.filter((n) => game.cells[n].state === 'hidden');
        if (hidden.length === 0) return null;

        const hit = hidden.find((n) => game.cells[n].mine);
        if (hit !== undefined) {
            const opened = hidden.filter((n) => !game.cells[n].mine).flatMap((n) => flood([n]));
            game.cells[hit].state = 'revealed';
            opened.push({ index: hit, depth: 0 });
            return { opened, lost: lose(hit) };
        }
        const opened = flood(hidden);
        const won = checkWin();
        return won ? { opened, won } : { opened };
    }

    // 插旗 / 拔旗；回傳是否有變化
    function toggleFlag(index) {
        if (!isActive()) return false;
        const cell = game.cells[index];
        if (!cell || cell.state === 'revealed') return false;
        cell.state = cell.state === 'flagged' ? 'hidden' : 'flagged';
        game.flags += cell.state === 'flagged' ? 1 : -1;
        return true;
    }

    const minesLeft = () => mines - game.flags;

    Object.assign(game, { reveal, chord, toggleFlag, neighbors, minesLeft });
    return game;
}
