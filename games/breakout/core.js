// 打磚塊的遊戲規則（純邏輯，不碰 DOM）
// 座標使用邏輯單位：場地 WIDTH × HEIGHT，y 向下

export const WIDTH = 320;
export const HEIGHT = 400;

export const COLS = 12;
export const BRICK_W = 24;
export const BRICK_H = 11;
export const BRICKS_LEFT = (WIDTH - COLS * BRICK_W) / 2;
export const BRICKS_TOP = 40;

export const PADDLE_Y = 372;
export const PADDLE_H = 8;
export const PADDLE_W = 52;
export const EXPANDED_W = 80;
const PADDLE_SPEED = 380;

export const BALL_R = 4;
// 球速：每關起始速度遞增，每打到一塊磚加快一點
const BASE_SPEED = 210;
const SPEED_PER_LEVEL = 15;
const SPEED_PER_HIT = 2;
const MAX_SPEED = 420;
// 從擋板正中央到邊緣，反彈角度從垂直到 60 度
const MAX_BOUNCE = (60 * Math.PI) / 180;
// 垂直速度至少佔球速這個比例，避免球在左右牆之間來回很久
const MIN_VERTICAL = 0.3;

export const START_LIVES = 3;
export const CAPSULE_W = 22;
export const CAPSULE_H = 9;
const CAPSULE_SPEED = 90;
const CAPSULE_CHANCE = 0.14;
export const CAPSULE_POINTS = 1000;
export const LASER_SPEED = 520;
const LASER_COOLDOWN = 0.35;
// 接球模式：黏住後最多停這麼久就自動發射
export const CATCH_HOLD = 2.5;
export const LEVEL_CLEAR_DELAY = 2;

// 道具：E 加長、S 減速、C 接球、L 雷射、D 分裂成三顆、P 加一命；後面是出現權重
export const CAPSULES = { E: 0.2, S: 0.2, C: 0.17, L: 0.17, D: 0.18, P: 0.08 };

// 磚塊顏色與分數；s 銀磚（要打多下）、G 金磚（打不破）
export const BRICK_POINTS = { w: 50, o: 60, c: 70, g: 80, r: 90, b: 100, p: 110, y: 120 };

export const LEVELS = [
    ['ssssssssssss', 'rrrrrrrrrrrr', 'yyyyyyyyyyyy', 'bbbbbbbbbbbb', 'pppppppppppp', 'gggggggggggg'],
    [
        'w...........',
        'wo..........',
        'woc.........',
        'wocg........',
        'wocgr.......',
        'wocgrb......',
        'wocgrbp.....',
        'wocgrbpy....',
        'wocgrbpyw...',
        'wocgrbpywo..',
        'wocgrbpywoc.',
        'sssssssssssy',
    ],
    [
        '............',
        'gggggggggggg',
        '............',
        'wwwGGGGGGGGG',
        '............',
        'rrrrrrrrrrrr',
        '............',
        'GGGGGGGGGwww',
        '............',
        'bbbbbbbbbbbb',
    ],
    [
        '..oooooooo..',
        '.oyyyyyyyyo.',
        '.oy.bbbb.yo.',
        '.oy.bGGb.yo.',
        '.oy.bbbb.yo.',
        '.oyyyyyyyyo.',
        '..oooooooo..',
        '............',
        's.s.s..s.s.s',
    ],
    ['pspspspspsps', 'spspspspspsp', 'gcgcgcgcgcgc', 'cgcgcgcgcgcg', 'GwwwwGGwwwwG', '.rrrr..rrrr.'],
];

// 銀磚耐打次數：每 4 關多一下，最多 4 下
export const silverHits = (level) => Math.min(4, 2 + Math.floor((level - 1) / 4));

export function parseLevel(rows, level = 1) {
    const bricks = [];
    rows.forEach((row, r) => {
        if (row.length !== COLS) throw new Error(`第 ${r + 1} 行必須是 ${COLS} 個字元`);
        [...row].forEach((ch, c) => {
            if (ch === '.') return;
            const brick = { col: c, row: r, x: BRICKS_LEFT + c * BRICK_W, y: BRICKS_TOP + r * BRICK_H, kind: ch };
            if (ch === 'G') Object.assign(brick, { hp: Infinity, points: 0 });
            else if (ch === 's') Object.assign(brick, { hp: silverHits(level), points: 50 * level });
            else if (BRICK_POINTS[ch]) Object.assign(brick, { hp: 1, points: BRICK_POINTS[ch] });
            else throw new Error(`未知的磚塊：${ch}`);
            bricks.push(brick);
        });
    });
    return bricks;
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// 圓與矩形是否重疊
function circleHitsRect(cx, cy, r, x, y, w, h) {
    const dx = cx - clamp(cx, x, x + w);
    const dy = cy - clamp(cy, y, y + h);
    return dx * dx + dy * dy < r * r;
}

export function createBreakout({ random = Math.random, level = 1, levels = LEVELS } = {}) {
    const game = {
        level,
        bricks: [],
        balls: [],
        capsules: [],
        lasers: [],
        paddle: { x: (WIDTH - PADDLE_W) / 2, w: PADDLE_W },
        mode: null,
        score: 0,
        lives: START_LIVES,
        clearTimer: 0,
        time: 0,
        over: false,
    };

    let events = [];
    let launchHeld = false;
    let laserCooldown = 0;
    const emit = (event) => events.push(event);

    const baseSpeed = () => BASE_SPEED + (game.level - 1) * SPEED_PER_LEVEL;

    // ---------- 關卡與發球 ----------

    function loadLevel(n) {
        game.level = n;
        game.bricks = parseLevel(levels[(n - 1) % levels.length], n);
        game.capsules = [];
        game.lasers = [];
        game.clearTimer = 0;
        setMode(null);
        serve();
        emit({ type: 'level-start', level: n });
    }

    // 新球黏在擋板中央，等玩家發射
    function serve() {
        game.balls = [{ x: 0, y: 0, vx: 0, vy: 0, speed: baseSpeed(), stuck: { offset: 0, hold: Infinity } }];
        placeStuck(game.balls[0]);
    }

    function placeStuck(ball) {
        ball.x = clamp(game.paddle.x + game.paddle.w / 2 + ball.stuck.offset, BALL_R, WIDTH - BALL_R);
        ball.y = PADDLE_Y - BALL_R;
    }

    // 依球打在擋板上的位置決定反彈角度：中央垂直往上，越靠邊越斜
    function bounceFromPaddle(ball) {
        const center = game.paddle.x + game.paddle.w / 2;
        const rel = clamp((ball.x - center) / (game.paddle.w / 2), -1, 1);
        const angle = rel * MAX_BOUNCE;
        ball.vx = Math.sin(angle) * ball.speed;
        ball.vy = -Math.cos(angle) * ball.speed;
    }

    function launch(ball) {
        // 發球時稍微偏一邊，避免垂直上下來回
        if (ball.stuck.offset === 0) ball.x += random() < 0.5 ? -6 : 6;
        bounceFromPaddle(ball);
        ball.stuck = null;
        emit({ type: 'launch' });
    }

    // ---------- 道具 ----------

    function setMode(mode) {
        game.mode = mode;
        const width = mode === 'expand' ? EXPANDED_W : PADDLE_W;
        const center = game.paddle.x + game.paddle.w / 2;
        game.paddle.w = width;
        game.paddle.x = clamp(center - width / 2, 0, WIDTH - width);
        // 離開接球模式時，黏住的球立刻發射
        if (mode !== 'catch') {
            for (const ball of game.balls) if (ball.stuck && ball.stuck.hold !== Infinity) launch(ball);
        }
    }

    function rollCapsule() {
        let roll = random();
        for (const [kind, weight] of Object.entries(CAPSULES)) {
            if ((roll -= weight) < 0) return kind;
        }
        return 'E';
    }

    function maybeDropCapsule(brick) {
        if (game.capsules.length > 0 || game.balls.length > 1) return;
        if (random() >= CAPSULE_CHANCE) return;
        const kind = rollCapsule();
        game.capsules.push({ kind, x: brick.x + (BRICK_W - CAPSULE_W) / 2, y: brick.y + 1 });
        emit({ type: 'capsule', kind });
    }

    function collect(kind) {
        switch (kind) {
            case 'E':
                setMode('expand');
                break;
            case 'L':
                setMode('laser');
                break;
            case 'C':
                setMode('catch');
                break;
            case 'S':
                for (const ball of game.balls) {
                    ball.speed = Math.min(ball.speed, baseSpeed() * 0.8);
                    rescale(ball);
                }
                break;
            case 'D': {
                setMode(null);
                const source = game.balls.find((b) => !b.stuck) ?? game.balls[0];
                if (source.stuck) launch(source);
                const angle = Math.atan2(source.vx, -source.vy);
                for (const turn of [-0.35, 0.35]) {
                    const a = clamp(angle + turn, -MAX_BOUNCE, MAX_BOUNCE);
                    game.balls.push({
                        x: source.x,
                        y: source.y,
                        vx: Math.sin(a) * source.speed,
                        vy: -Math.cos(a) * source.speed,
                        speed: source.speed,
                        stuck: null,
                    });
                }
                break;
            }
            case 'P':
                game.lives += 1;
                break;
        }
        game.score += CAPSULE_POINTS;
        emit({ type: 'pickup', kind, x: game.paddle.x + game.paddle.w / 2, y: PADDLE_Y });
    }

    // ---------- 磚塊 ----------

    const breakable = (brick) => brick.hp !== Infinity;

    function hitBrick(brick) {
        if (!breakable(brick)) {
            emit({ type: 'brick-hit', kind: brick.kind, x: brick.x + BRICK_W / 2, y: brick.y + BRICK_H / 2, destroyed: false });
            return;
        }
        brick.hp -= 1;
        if (brick.hp > 0) {
            emit({ type: 'brick-hit', kind: brick.kind, x: brick.x + BRICK_W / 2, y: brick.y + BRICK_H / 2, destroyed: false });
            return;
        }
        game.bricks = game.bricks.filter((b) => b !== brick);
        game.score += brick.points;
        emit({
            type: 'brick-break',
            kind: brick.kind,
            x: brick.x + BRICK_W / 2,
            y: brick.y + BRICK_H / 2,
            points: brick.points,
        });
        maybeDropCapsule(brick);
    }

    function rescale(ball) {
        const len = Math.hypot(ball.vx, ball.vy) || 1;
        ball.vx = (ball.vx / len) * ball.speed;
        ball.vy = (ball.vy / len) * ball.speed;
    }

    // 撞牆後確保垂直速度不會太小
    function keepVertical(ball) {
        const min = ball.speed * MIN_VERTICAL;
        if (Math.abs(ball.vy) >= min) return;
        ball.vy = (ball.vy < 0 ? -1 : 1) * min;
        ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(ball.speed ** 2 - min ** 2);
    }

    function speedUp(ball) {
        ball.speed = Math.min(MAX_SPEED, ball.speed + SPEED_PER_HIT);
        rescale(ball);
    }

    // 沿一個軸移動；撞到磚塊就反彈並打那一塊（離球最近的）
    function moveAxis(ball, axis, dist) {
        ball[axis] += dist;
        const touching = game.bricks.filter((b) => circleHitsRect(ball.x, ball.y, BALL_R, b.x, b.y, BRICK_W, BRICK_H));
        if (touching.length === 0) return;
        ball[axis] -= dist;
        const v = axis === 'x' ? 'vx' : 'vy';
        ball[v] = -ball[v];
        const dist2 = (b) => (b.x + BRICK_W / 2 - ball.x) ** 2 + (b.y + BRICK_H / 2 - ball.y) ** 2;
        const nearest = touching.reduce((a, b) => (dist2(b) < dist2(a) ? b : a));
        hitBrick(nearest);
        if (breakable(nearest)) speedUp(ball);
    }

    // ---------- 球 ----------

    function stepBall(ball, dt) {
        if (ball.stuck) {
            placeStuck(ball);
            return true;
        }
        const dist = ball.speed * dt;
        const steps = Math.max(1, Math.ceil(dist / 2));
        for (let s = 0; s < steps; s++) {
            moveAxis(ball, 'x', (ball.vx * dt) / steps);
            moveAxis(ball, 'y', (ball.vy * dt) / steps);

            if (ball.x < BALL_R) {
                ball.x = BALL_R;
                ball.vx = Math.abs(ball.vx);
                keepVertical(ball);
                emit({ type: 'wall' });
            } else if (ball.x > WIDTH - BALL_R) {
                ball.x = WIDTH - BALL_R;
                ball.vx = -Math.abs(ball.vx);
                keepVertical(ball);
                emit({ type: 'wall' });
            }
            if (ball.y < BALL_R) {
                ball.y = BALL_R;
                ball.vy = Math.abs(ball.vy);
                emit({ type: 'wall' });
            }

            // 擋板：只在往下時反彈
            const { paddle } = game;
            if (ball.vy > 0 && circleHitsRect(ball.x, ball.y, BALL_R, paddle.x, PADDLE_Y, paddle.w, PADDLE_H)) {
                ball.y = PADDLE_Y - BALL_R;
                if (game.mode === 'catch') {
                    ball.stuck = { offset: ball.x - (paddle.x + paddle.w / 2), hold: CATCH_HOLD };
                    ball.vx = 0;
                    ball.vy = 0;
                    emit({ type: 'catch' });
                    return true;
                }
                bounceFromPaddle(ball);
                emit({ type: 'paddle', x: ball.x });
            }

            if (ball.y - BALL_R > HEIGHT) return false;
        }
        return true;
    }

    // ---------- 雷射 ----------

    function updateLasers(dt, input) {
        laserCooldown -= dt;
        if (game.mode === 'laser' && input.fire && laserCooldown <= 0) {
            const { paddle } = game;
            game.lasers.push({ x: paddle.x + 5, y: PADDLE_Y }, { x: paddle.x + paddle.w - 5, y: PADDLE_Y });
            laserCooldown = LASER_COOLDOWN;
            emit({ type: 'laser' });
        }
        game.lasers = game.lasers.filter((laser) => {
            laser.y -= LASER_SPEED * dt;
            if (laser.y < 0) return false;
            const brick = game.bricks.find(
                (b) => laser.x >= b.x && laser.x <= b.x + BRICK_W && laser.y >= b.y && laser.y <= b.y + BRICK_H
            );
            if (brick) {
                hitBrick(brick);
                return false;
            }
            return true;
        });
    }

    // ---------- 主迴圈 ----------

    // input：{ dir: -1 | 0 | 1（鍵盤按住方向）, target: 擋板中心 x（滑鼠 / 觸控，優先）, launch（按住中）, fire（按住中） }
    function update(dt, input = {}) {
        if (game.over) return;
        game.time += dt;

        if (game.clearTimer > 0) {
            game.clearTimer -= dt;
            if (game.clearTimer <= 0) loadLevel(game.level + 1);
            return;
        }

        // 擋板
        const { paddle } = game;
        if (Number.isFinite(input.target)) paddle.x = input.target - paddle.w / 2;
        else if (input.dir) paddle.x += input.dir * PADDLE_SPEED * dt;
        paddle.x = clamp(paddle.x, 0, WIDTH - paddle.w);

        // 發射黏住的球（按下的那一刻），或接球模式停太久自動發射
        const pressed = Boolean(input.launch) && !launchHeld;
        launchHeld = Boolean(input.launch);
        for (const ball of game.balls) {
            if (!ball.stuck) continue;
            ball.stuck.hold -= dt;
            if (pressed || ball.stuck.hold <= 0) launch(ball);
        }

        game.balls = game.balls.filter((ball) => {
            const alive = stepBall(ball, dt);
            if (!alive) emit({ type: 'ball-lost', x: ball.x });
            return alive;
        });
        updateLasers(dt, input);

        // 膠囊往下掉，擋板接到就生效
        game.capsules = game.capsules.filter((capsule) => {
            capsule.y += CAPSULE_SPEED * dt;
            const caught =
                capsule.y + CAPSULE_H >= PADDLE_Y &&
                capsule.y <= PADDLE_Y + PADDLE_H &&
                capsule.x + CAPSULE_W >= paddle.x &&
                capsule.x <= paddle.x + paddle.w;
            if (caught) collect(capsule.kind);
            return !caught && capsule.y < HEIGHT;
        });

        if (!game.bricks.some(breakable)) {
            game.balls = [];
            game.capsules = [];
            game.lasers = [];
            game.clearTimer = LEVEL_CLEAR_DELAY;
            emit({ type: 'level-clear', level: game.level });
            return;
        }

        if (game.balls.length === 0) {
            game.lives -= 1;
            game.capsules = [];
            game.lasers = [];
            emit({ type: 'life-lost', lives: game.lives });
            if (game.lives <= 0) {
                game.over = true;
                emit({ type: 'game-over', score: game.score, level: game.level });
                return;
            }
            setMode(null);
            serve();
        }
    }

    function takeEvents() {
        const taken = events;
        events = [];
        return taken;
    }

    Object.assign(game, { update, takeEvents, collect });
    loadLevel(level);
    return game;
}
