// 俄羅斯方塊的遊戲規則（純邏輯，不碰 DOM）：SRS 旋轉與踢牆、7-bag、Hold、鎖定延遲、T-spin / Back-to-back / Combo 計分
// 座標：x 向右、y 向下；盤面共 ROWS 列，最上面 HIDDEN_ROWS 列是看不見的出生區

export const COLS = 10;
export const VISIBLE_ROWS = 20;
export const HIDDEN_ROWS = 2;
export const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
export const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

export const LOCK_DELAY = 0.5;
// 著地後移動 / 旋轉可重置鎖定計時的次數上限，避免無限拖延
export const MAX_LOCK_RESETS = 15;
export const CLEAR_DURATION = 0.3;
export const LINES_PER_LEVEL = 10;
const MAX_GRAVITY_LEVEL = 20;
const SOFT_DROP_FACTOR = 20;

// 各方塊在出生方向（rotation 0）的形狀；旋轉以矩陣中心為軸
const SHAPES = {
    I: ['....', 'IIII', '....', '....'],
    J: ['J..', 'JJJ', '...'],
    L: ['..L', 'LLL', '...'],
    O: ['OO', 'OO'],
    S: ['.SS', 'SS.', '...'],
    T: ['.T.', 'TTT', '...'],
    Z: ['ZZ.', '.ZZ', '...'],
};

function rotateCW(matrix) {
    const size = matrix.length;
    return matrix.map((row, y) => row.map((_, x) => matrix[size - 1 - x][y]));
}

// CELLS[type][rotation] = [[x, y], ...]（相對於矩陣左上角）
const CELLS = Object.fromEntries(
    TYPES.map((type) => {
        let matrix = SHAPES[type].map((row) => [...row].map((c) => c !== '.'));
        const rotations = [];
        for (let r = 0; r < 4; r++) {
            const cells = [];
            matrix.forEach((row, y) => row.forEach((filled, x) => filled && cells.push([x, y])));
            rotations.push(cells);
            matrix = rotateCW(matrix);
        }
        return [type, rotations];
    })
);

export function pieceCells(type, rotation = 0) {
    return CELLS[type][rotation];
}

// SRS 踢牆表（Tetris Guideline），原表 y 向上為正，這裡轉成 y 向下
const toDown = (table) =>
    Object.fromEntries(Object.entries(table).map(([key, kicks]) => [key, kicks.map(([x, y]) => [x, -y])]));

const KICKS_JLSTZ = toDown({
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
});

const KICKS_I = toDown({
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
});

function kicksFor(type, from, to) {
    if (type === 'O') return [[0, 0]];
    return (type === 'I' ? KICKS_I : KICKS_JLSTZ)[`${from}>${to}`];
}

// 每下降一格所需秒數（Tetris Guideline 公式）
export function gravityFor(level) {
    const n = Math.min(level, MAX_GRAVITY_LEVEL) - 1;
    return (0.8 - n * 0.007) ** n;
}

// 消行基本分（乘上等級）
const LINE_POINTS = [0, 100, 300, 500, 800];
const TSPIN_POINTS = [400, 800, 1200, 1600];
const TSPIN_MINI_POINTS = [100, 200, 400];

export function scoreFor({ lines, tspin = null, level = 1, backToBack = false, combo = 0 }) {
    let base;
    if (tspin === 'full') base = TSPIN_POINTS[lines];
    else if (tspin === 'mini') base = TSPIN_MINI_POINTS[lines];
    else base = LINE_POINTS[lines];
    if (backToBack) base *= 1.5;
    const comboBonus = lines > 0 && combo > 0 ? 50 * combo : 0;
    return Math.floor((base + comboBonus) * level);
}

// 7-bag：每 7 個方塊內每種各出現一次
export function createBag(random = Math.random) {
    let bag = [];
    return () => {
        if (bag.length === 0) {
            bag = [...TYPES];
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [bag[i], bag[j]] = [bag[j], bag[i]];
            }
        }
        return bag.pop();
    };
}

export function emptyBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

export function createTetris({ random = Math.random, startLevel = 1, queueSize = 5 } = {}) {
    const nextType = createBag(random);

    const game = {
        board: emptyBoard(),
        active: null,
        held: null,
        canHold: true,
        queue: [],
        score: 0,
        lines: 0,
        level: startLevel,
        combo: -1,
        backToBack: false,
        over: false,
        // 消行動畫期間：{ rows, time }，時間到才真正移除這些列並出下一塊
        clearing: null,
    };

    let events = [];
    let fallTimer = 0;
    let lockTimer = 0;
    let lockResets = 0;
    let lowestY = 0;
    // T-spin 判定需要：最後一個成功動作是否為旋轉、用到第幾組踢牆
    let lastAction = null;
    let lastKick = 0;

    const emit = (event) => events.push(event);

    function fits(type, rotation, x, y) {
        return pieceCells(type, rotation).every(([cx, cy]) => {
            const bx = x + cx;
            const by = y + cy;
            return bx >= 0 && bx < COLS && by < ROWS && (by < 0 || game.board[by][bx] === null);
        });
    }

    const activeFits = (dx = 0, dy = 0, rotation = game.active.rotation) =>
        fits(game.active.type, rotation, game.active.x + dx, game.active.y + dy);

    const onGround = () => !activeFits(0, 1);

    function refillQueue() {
        while (game.queue.length < queueSize) game.queue.push(nextType());
    }

    function spawn(type = game.queue.shift()) {
        refillQueue();
        const width = SHAPES[type][0].length;
        const piece = { type, rotation: 0, x: Math.floor((COLS - width) / 2), y: 0 };
        game.active = piece;
        fallTimer = 0;
        lockTimer = 0;
        lockResets = 0;
        lastAction = null;
        if (!activeFits()) {
            endGame();
            return;
        }
        // 出生後若下方是空的就立刻下降一格，讓方塊最下緣出現在可見區
        if (activeFits(0, 1)) piece.y += 1;
        lowestY = piece.y;
    }

    function endGame() {
        game.over = true;
        emit({ type: 'gameOver', score: game.score });
    }

    // 著地狀態下成功移動 / 旋轉：重置鎖定計時（有次數上限）
    function afterShift() {
        if (onGround() && lockResets < MAX_LOCK_RESETS) {
            lockTimer = 0;
            lockResets++;
        }
    }

    function move(dx) {
        if (!game.active || !activeFits(dx, 0)) return false;
        game.active.x += dx;
        lastAction = 'move';
        afterShift();
        return true;
    }

    function rotate(direction) {
        const piece = game.active;
        if (!piece) return false;
        const to = (piece.rotation + (direction > 0 ? 1 : 3)) % 4;
        const kicks = kicksFor(piece.type, piece.rotation, to);
        for (let i = 0; i < kicks.length; i++) {
            const [kx, ky] = kicks[i];
            if (fits(piece.type, to, piece.x + kx, piece.y + ky)) {
                piece.x += kx;
                piece.y += ky;
                piece.rotation = to;
                lastAction = 'rotate';
                lastKick = i;
                if (piece.y > lowestY) {
                    lowestY = piece.y;
                    lockResets = 0;
                }
                afterShift();
                emit({ type: 'rotate' });
                return true;
            }
        }
        return false;
    }

    // 下降一格；到達新的最低點時重置鎖定次數
    function stepDown() {
        if (!activeFits(0, 1)) return false;
        game.active.y += 1;
        lastAction = 'drop';
        if (game.active.y > lowestY) {
            lowestY = game.active.y;
            lockResets = 0;
            lockTimer = 0;
        }
        return true;
    }

    function softDrop() {
        if (!game.active || !stepDown()) return false;
        game.score += 1;
        return true;
    }

    function hardDrop() {
        const piece = game.active;
        if (!piece) return 0;
        const fromY = piece.y;
        while (stepDown()) {}
        const distance = piece.y - fromY;
        game.score += distance * 2;
        emit({ type: 'hardDrop', piece: { ...piece }, fromY, distance });
        // 直接落下後沒有旋轉機會：保留旋轉的 T-spin 判定只在 distance 為 0 時成立
        if (distance > 0) lastAction = 'drop';
        lock();
        return distance;
    }

    function holdPiece() {
        if (!game.active || !game.canHold) return false;
        const current = game.active.type;
        const swapped = game.held;
        game.held = current;
        game.canHold = false;
        emit({ type: 'hold', piece: current });
        spawn(swapped ?? undefined);
        return true;
    }

    // T 方塊中心周圍四個角；牆壁與地板視為佔用
    function detectTSpin() {
        const piece = game.active;
        if (piece.type !== 'T' || lastAction !== 'rotate') return null;
        const filled = ([cx, cy]) => {
            const x = piece.x + cx;
            const y = piece.y + cy;
            return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && game.board[y][x] !== null);
        };
        const corners = { tl: [0, 0], tr: [2, 0], br: [2, 2], bl: [0, 2] };
        const count = Object.values(corners).filter(filled).length;
        if (count < 3) return null;
        // 「前方」是 T 凸出那一側的兩個角
        const front = [
            ['tl', 'tr'],
            ['tr', 'br'],
            ['br', 'bl'],
            ['bl', 'tl'],
        ][piece.rotation];
        const frontFilled = front.every((key) => filled(corners[key]));
        return frontFilled || lastKick === 4 ? 'full' : 'mini';
    }

    function lock() {
        const piece = game.active;
        const tspin = detectTSpin();
        const cells = pieceCells(piece.type, piece.rotation).map(([cx, cy]) => [piece.x + cx, piece.y + cy]);
        for (const [x, y] of cells) {
            if (y >= 0) game.board[y][x] = piece.type;
        }
        game.active = null;
        game.canHold = true;
        emit({ type: 'lock', piece: { ...piece }, cells });

        // 整塊都停在看不見的出生區：Lock out
        if (cells.every(([, y]) => y < HIDDEN_ROWS)) {
            endGame();
            return;
        }

        const rows = [];
        game.board.forEach((row, y) => row.every((cell) => cell !== null) && rows.push(y));
        const lines = rows.length;

        if (lines > 0) game.combo++;
        else game.combo = -1;

        const difficult = lines === 4 || (tspin !== null && lines > 0);
        const backToBack = difficult && game.backToBack;
        if (lines > 0) game.backToBack = difficult;

        const points = scoreFor({ lines, tspin, level: game.level, backToBack, combo: game.combo });
        game.score += points;

        if (lines > 0 || tspin) {
            emit({ type: 'clear', lines, rows, tspin, backToBack, combo: game.combo, points });
        }

        if (lines > 0) {
            game.lines += lines;
            const level = startLevel + Math.floor(game.lines / LINES_PER_LEVEL);
            if (level > game.level) {
                game.level = level;
                emit({ type: 'levelUp', level });
            }
            game.clearing = { rows, time: CLEAR_DURATION };
        } else {
            spawn();
        }
    }

    function finishClear() {
        const rows = new Set(game.clearing.rows);
        const kept = game.board.filter((_, y) => !rows.has(y));
        game.board = [...Array.from({ length: rows.size }, () => new Array(COLS).fill(null)), ...kept];
        game.clearing = null;
        spawn();
    }

    // 推進時間：重力、軟降、鎖定延遲、消行動畫
    function tick(dt, { softDropping = false } = {}) {
        if (game.over) return;
        if (game.clearing) {
            game.clearing.time -= dt;
            if (game.clearing.time <= 0) finishClear();
            return;
        }
        if (!game.active) return;

        const gravity = gravityFor(game.level);
        const interval = softDropping ? Math.min(gravity, gravity / SOFT_DROP_FACTOR) : gravity;
        fallTimer += dt;
        while (fallTimer >= interval) {
            fallTimer -= interval;
            if (!stepDown()) {
                fallTimer = 0;
                break;
            }
            if (softDropping) game.score += 1;
        }

        if (onGround()) {
            lockTimer += dt;
            if (lockTimer >= LOCK_DELAY) lock();
        } else {
            lockTimer = 0;
        }
    }

    function ghostY() {
        if (!game.active) return null;
        let dy = 0;
        while (activeFits(0, dy + 1)) dy++;
        return game.active.y + dy;
    }

    function takeEvents() {
        const taken = events;
        events = [];
        return taken;
    }

    refillQueue();
    spawn();

    Object.assign(game, { fits, move, rotate, softDrop, hardDrop, hold: holdPiece, tick, ghostY, takeEvents });
    // 目前鎖定延遲的進度（0–1），給畫面做著地提示
    Object.defineProperty(game, 'lockProgress', {
        get: () => (game.active && onGround() ? Math.min(lockTimer / LOCK_DELAY, 1) : 0),
    });
    return game;
}
