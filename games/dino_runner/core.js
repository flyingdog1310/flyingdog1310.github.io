// 恐龍快跑的遊戲規則（純邏輯，不碰 DOM）
// 座標使用邏輯單位：場地 WIDTH × HEIGHT，y 向下，地面在 GROUND_Y

export const WIDTH = 600;
export const HEIGHT = 200;
export const GROUND_Y = 172;

export const DINO_X = 44;
export const DINO_WIDTH = 44;
export const DINO_HEIGHT = 46;
export const DUCK_HEIGHT = 28;
export const DUCK_WIDTH = 56;

const GRAVITY = 2600;
// 按住跳躍鍵時的初速；提早放開時把上升速度限制在 SHORT_HOP，形成小跳
const JUMP_VELOCITY = -780;
const SHORT_HOP = -380;
// 空中按下：加速下墜
const FAST_FALL = 3;

export const START_SPEED = 330;
export const MAX_SPEED = 760;
const ACCELERATION = 5;
// 每跑 DISTANCE_PER_POINT 單位得 1 分
export const DISTANCE_PER_POINT = 40;
// 分數達到這個值之後才會出現翼龍
export const BIRD_FROM = 350;

// 障礙物尺寸與碰撞框（相對於左上角，已比外觀略小以求公平）
export const OBSTACLES = {
    cactusSmall: { width: 17, height: 35, boxes: [[3, 0, 11, 35], [0, 10, 17, 12]] },
    cactusLarge: { width: 25, height: 50, boxes: [[7, 0, 11, 50], [0, 14, 25, 16]] },
    bird: { width: 44, height: 36, boxes: [[2, 12, 22, 10], [14, 4, 18, 26], [30, 12, 12, 8]] },
};
// 翼龍高度：low 需要跳、mid 要蹲或跳、high 可以直接跑過
export const BIRD_HEIGHTS = { low: GROUND_Y - 36, mid: GROUND_Y - 58, high: GROUND_Y - 84 };

// 恐龍碰撞框（相對於左上角）
const DINO_BOXES = [
    [24, 0, 20, 14],
    [6, 16, 28, 20],
    [12, 36, 16, 10],
];
const DUCK_BOXES = [[4, 4, 50, 22]];

const overlap = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];

// 相鄰障礙物的最小間距：速度越快間距越大，確保一定跳得過
export function minGap(speed) {
    return speed * 0.62 + 140;
}

export function createRunner({ random = Math.random } = {}) {
    const game = {
        dino: { y: GROUND_Y - DINO_HEIGHT, vy: 0, onGround: true, ducking: false, runTime: 0 },
        obstacles: [],
        speed: START_SPEED,
        distance: 0,
        score: 0,
        time: 0,
        over: false,
    };

    let events = [];
    let nextGap = 420;
    let jumpHeld = false;
    let lastMilestone = 0;
    const emit = (event) => events.push(event);

    function dinoBoxes() {
        const { dino } = game;
        const top = dino.ducking ? GROUND_Y - DUCK_HEIGHT : dino.y;
        return (dino.ducking ? DUCK_BOXES : DINO_BOXES).map(([x, y, w, h]) => [DINO_X + x, top + y, w, h]);
    }

    function obstacleBoxes(obstacle) {
        const def = OBSTACLES[obstacle.kind];
        const boxes = [];
        for (let i = 0; i < obstacle.count; i++) {
            for (const [x, y, w, h] of def.boxes) boxes.push([obstacle.x + i * def.width + x, obstacle.y + y, w, h]);
        }
        return boxes;
    }

    function spawn() {
        const canBird = game.score >= BIRD_FROM;
        const roll = random();
        let obstacle;
        if (canBird && roll < 0.22) {
            const levels = Object.keys(BIRD_HEIGHTS);
            const level = levels[Math.floor(random() * levels.length)];
            obstacle = { kind: 'bird', level, count: 1, y: BIRD_HEIGHTS[level], speedBonus: 30 + random() * 40 };
        } else {
            const large = random() < (game.speed > 450 ? 0.5 : 0.3);
            const kind = large ? 'cactusLarge' : 'cactusSmall';
            // 速度快時才出現三株一組
            const maxCount = game.speed > 520 ? 3 : game.speed > 380 ? 2 : 1;
            const count = 1 + Math.floor(random() * maxCount);
            obstacle = { kind, count, y: GROUND_Y - OBSTACLES[kind].height, speedBonus: 0 };
        }
        obstacle.x = WIDTH + 10;
        obstacle.width = OBSTACLES[obstacle.kind].width * obstacle.count;
        obstacle.variant = Math.floor(random() * 3);
        game.obstacles.push(obstacle);
        nextGap = minGap(game.speed) * (1 + random() * 0.8) + obstacle.width;
    }

    // input：{ jump（按住中）, duck（按住中） }
    function update(dt, input = {}) {
        if (game.over) return;
        const { dino } = game;
        game.time += dt;
        game.speed = Math.min(game.speed + ACCELERATION * dt, MAX_SPEED);

        // 跳躍：按下的那一刻起跳；上升中放開 → 小跳
        if (input.jump && !jumpHeld && dino.onGround) {
            dino.vy = JUMP_VELOCITY;
            dino.onGround = false;
            dino.ducking = false;
            emit({ type: 'jump' });
        }
        if (!input.jump && dino.vy < SHORT_HOP) dino.vy = SHORT_HOP;
        jumpHeld = Boolean(input.jump);

        if (!dino.onGround) {
            dino.vy += GRAVITY * (input.duck ? FAST_FALL : 1) * dt;
            dino.y += dino.vy * dt;
            if (dino.y >= GROUND_Y - DINO_HEIGHT) {
                dino.y = GROUND_Y - DINO_HEIGHT;
                dino.vy = 0;
                dino.onGround = true;
                emit({ type: 'land' });
            }
        }
        dino.ducking = dino.onGround && Boolean(input.duck);
        dino.runTime += dt;

        // 前進與計分
        const step = game.speed * dt;
        game.distance += step;
        game.score = Math.floor(game.distance / DISTANCE_PER_POINT);
        const milestone = Math.floor(game.score / 100);
        if (milestone > lastMilestone) {
            lastMilestone = milestone;
            emit({ type: 'milestone', score: milestone * 100 });
        }

        // 障礙物
        for (const obstacle of game.obstacles) obstacle.x -= step + obstacle.speedBonus * dt;
        game.obstacles = game.obstacles.filter((o) => o.x + o.width > -20);
        const last = game.obstacles.at(-1);
        if (!last || WIDTH + 10 - last.x >= nextGap) spawn();

        // 碰撞
        const mine = dinoBoxes();
        for (const obstacle of game.obstacles) {
            if (obstacle.x > DINO_X + DUCK_WIDTH + 4 || obstacle.x + obstacle.width < DINO_X - 4) continue;
            if (obstacleBoxes(obstacle).some((box) => mine.some((m) => overlap(m, box)))) {
                game.over = true;
                emit({ type: 'crash', score: game.score, obstacle: obstacle.kind });
                return;
            }
        }
    }

    function takeEvents() {
        const taken = events;
        events = [];
        return taken;
    }

    Object.assign(game, { update, takeEvents, dinoBoxes, obstacleBoxes });
    return game;
}
