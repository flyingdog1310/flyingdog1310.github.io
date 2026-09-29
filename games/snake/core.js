// 貪食蛇的遊戲規則（純邏輯，不碰 DOM）
// 座標：x 向右、y 向下；body[0] 是頭

export const COLS = 20;
export const ROWS = 20;
export const FOOD_POINTS = 10;
export const BONUS_POINTS = 50;
// 每吃幾顆一般果實出現一次限時的金色果實
export const BONUS_EVERY = 5;
export const BONUS_DURATION = 6;
// 最多預先排入幾個轉向，連按很快時不會漏掉
const MAX_QUEUED_TURNS = 3;

export const DIRECTIONS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

// 每秒移動格數：從 6 格開始，每吃一顆加 0.2，最多 14 格
export function speedFor(eaten) {
    return Math.min(6 + eaten * 0.2, 14);
}

const same = (a, b) => a.x === b.x && a.y === b.y;
const opposite = (a, b) => a.x === -b.x && a.y === -b.y;

export function createSnake({ cols = COLS, rows = ROWS, random = Math.random } = {}) {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);

    const game = {
        cols,
        rows,
        body: [
            { x: cx, y: cy },
            { x: cx - 1, y: cy },
            { x: cx - 2, y: cy },
        ],
        dir: DIRECTIONS.right,
        queue: [],
        food: null,
        bonus: null,
        score: 0,
        eaten: 0,
        // 第一次轉向（或 start()）之前蛇不會動
        started: false,
        over: false,
        won: false,
        // 上一步移走的尾巴格子（這步有變長則為 null），畫面用來插值
        prevTail: null,
        // 吞下去的果實在身體中的位置（index），每走一步往後移一格
        bulges: [],
    };

    let events = [];
    let moveTimer = 0;
    const emit = (event) => events.push(event);

    function freeCells() {
        const taken = new Set(game.body.map(({ x, y }) => y * cols + x));
        if (game.food) taken.add(game.food.y * cols + game.food.x);
        if (game.bonus) taken.add(game.bonus.y * cols + game.bonus.x);
        const cells = [];
        for (let i = 0; i < cols * rows; i++) if (!taken.has(i)) cells.push({ x: i % cols, y: Math.floor(i / cols) });
        return cells;
    }

    function randomFreeCell() {
        const cells = freeCells();
        return cells.length ? cells[Math.floor(random() * cells.length)] : null;
    }

    function turn(name) {
        const next = DIRECTIONS[name];
        if (!next || game.over) return false;
        // 與「最後排入的方向」比較，避免快速按兩次形成迴轉
        const last = game.queue.at(-1) ?? game.dir;
        if (same(next, last) || opposite(next, last)) {
            // 還沒開始時按目前方向也算開始
            if (!game.started && same(next, last)) {
                game.started = true;
                return true;
            }
            return false;
        }
        if (game.queue.length >= MAX_QUEUED_TURNS) return false;
        game.queue.push(next);
        game.started = true;
        return true;
    }

    function start() {
        game.started = true;
    }

    function die(cause) {
        game.over = true;
        emit({ type: 'die', cause, score: game.score });
    }

    function step() {
        if (game.queue.length) game.dir = game.queue.shift();
        const head = { x: game.body[0].x + game.dir.x, y: game.body[0].y + game.dir.y };

        if (head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows) {
            die('wall');
            return;
        }

        const eatsFood = game.food && same(head, game.food);
        const eatsBonus = game.bonus && same(head, game.bonus);
        const grows = eatsFood || eatsBonus;
        // 沒有變長時尾巴這一步會移開，可以追著自己的尾巴走
        const body = grows ? game.body : game.body.slice(0, -1);
        if (body.some((part) => same(part, head))) {
            die('self');
            return;
        }

        game.body.unshift(head);
        game.prevTail = grows ? null : game.body.pop();
        game.bulges = game.bulges.map((i) => i + 1).filter((i) => i < game.body.length);

        if (eatsFood) {
            game.score += FOOD_POINTS;
            game.eaten++;
            game.bulges.push(0);
            emit({ type: 'eat', kind: 'food', at: head, points: FOOD_POINTS });
            game.food = null;
            if (game.eaten % BONUS_EVERY === 0 && !game.bonus) {
                const cell = randomFreeCell();
                if (cell) {
                    game.bonus = { ...cell, time: BONUS_DURATION };
                    emit({ type: 'bonus', at: cell });
                }
            }
            game.food = randomFreeCell();
        } else if (eatsBonus) {
            // 越早吃到分數越高：剩餘時間比例 × BONUS_POINTS，至少 10 分
            const points = Math.max(10, Math.round((BONUS_POINTS * game.bonus.time) / BONUS_DURATION / 5) * 5);
            game.score += points;
            game.bulges.push(0);
            emit({ type: 'eat', kind: 'bonus', at: head, points });
            game.bonus = null;
        }

        if (game.body.length === cols * rows) {
            game.won = true;
            game.over = true;
            emit({ type: 'win', score: game.score });
        }
    }

    // 推進時間；回傳這次實際走了幾步
    function update(dt) {
        if (game.over || !game.started) return 0;
        if (game.bonus) {
            game.bonus.time -= dt;
            if (game.bonus.time <= 0) {
                emit({ type: 'bonusExpired', at: { x: game.bonus.x, y: game.bonus.y } });
                game.bonus = null;
            }
        }
        let steps = 0;
        moveTimer += dt;
        while (!game.over && moveTimer >= 1 / speedFor(game.eaten)) {
            moveTimer -= 1 / speedFor(game.eaten);
            step();
            steps++;
        }
        return steps;
    }

    function takeEvents() {
        const taken = events;
        events = [];
        return taken;
    }

    game.food = randomFreeCell();
    Object.assign(game, { turn, start, update, takeEvents });
    // 距離下一步的進度（0–1），畫面用來讓蛇平滑移動
    Object.defineProperty(game, 'progress', {
        get: () => (game.started && !game.over ? Math.min(moveTimer * speedFor(game.eaten), 1) : 0),
    });
    return game;
}
