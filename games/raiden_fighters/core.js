// 雷電風格縱向射擊的遊戲規則（純邏輯，不碰 DOM）
// 座標使用邏輯單位：場地 WIDTH × HEIGHT，y 向下；畫面再依螢幕大小縮放

export const WIDTH = 180;
export const HEIGHT = 320;

// ---- 玩家 ----
const PLAYER_SPEED = 120;
const FOCUS_SPEED = 55;
// 被子彈打中的判定半徑（遠小於機身，現代彈幕遊戲的慣例）
export const PLAYER_HITBOX = 2.5;
const PLAYER_BODY = 5;
const PICKUP_RADIUS = 12;
export const MAX_POWER = 4;
export const MAX_MISSILES = 3;
export const MAX_BOMBS = 5;
export const START_LIVES = 3;
export const START_BOMBS = 2;
export const RESPAWN_DELAY = 1.2;
export const INVULNERABLE_TIME = 2.5;
export const BOMB_DURATION = 1.4;
const BOMB_DAMAGE = 30;

// ---- 武器：紅色 Vulcan 散射、藍色 Laser 集中；等級 1–4 ----
const VULCAN_RATE = 0.085;
const LASER_RATE = 0.05;
const MISSILE_RATE = 0.5;
const SHOT_SPEED = 380;
const LASER_SPEED = 520;
const MISSILE_SPEED = 170;
const MISSILE_TURN = 5;

// 每個等級的 Vulcan：[x 偏移, 角度(度)]
const VULCAN_PATTERNS = [
    [
        [-3, 0],
        [3, 0],
    ],
    [
        [-3, 0],
        [3, 0],
        [0, -8],
        [0, 8],
    ],
    [
        [-3, 0],
        [3, 0],
        [-2, -7],
        [2, 7],
        [-1, -15],
        [1, 15],
    ],
    [
        [-4, 0],
        [0, 0],
        [4, 0],
        [-2, -6],
        [2, 6],
        [-1, -13],
        [1, 13],
        [0, -21],
        [0, 21],
    ],
];
// 每個等級的 Laser：x 偏移與單發傷害
const LASER_PATTERNS = [
    { offsets: [0], damage: 1.3 },
    { offsets: [-2.5, 2.5], damage: 1.1 },
    { offsets: [-4, 0, 4], damage: 1.1 },
    { offsets: [-5, -1.7, 1.7, 5], damage: 1.15 },
];

// ---- 敵人 ----
export const ENEMIES = {
    drone: { hp: 2, radius: 6, points: 100 },
    fighter: { hp: 5, radius: 7, points: 250 },
    gunship: { hp: 28, radius: 13, points: 1000 },
    boss: { hp: 420, radius: 30, points: 20000 },
};
// 每關開始後多久出現頭目
export const BOSS_TIME = 55;
const STAGE_CLEAR_PAUSE = 3;
const ENEMY_BULLET_SPEED = 72;

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const toRad = (deg) => (deg * Math.PI) / 180;

export function createRaiden({ random = Math.random } = {}) {
    const game = {
        player: {
            x: WIDTH / 2,
            y: HEIGHT - 40,
            alive: true,
            invulnerable: 0,
            weapon: 'vulcan',
            power: 1,
            missiles: 0,
        },
        lives: START_LIVES,
        bombs: START_BOMBS,
        score: 0,
        stage: 1,
        // 本關經過的時間（頭目出現後停止計算）
        time: 0,
        // play / stageClear / over
        phase: 'play',
        phaseTimer: 0,
        respawnTimer: 0,
        bombTimer: 0,
        shots: [],
        bullets: [],
        enemies: [],
        items: [],
        boss: null,
        kills: 0,
    };

    let events = [];
    let nextId = 1;
    let fireTimer = 0;
    let missileTimer = 0;
    let waveTimer = 1.5;
    let bossSpawned = false;
    const emit = (event) => events.push(event);

    // 難度隨關卡上升：敵彈速度與射速、敵人血量
    const difficulty = () => 1 + 0.18 * (game.stage - 1);
    const hpScale = () => 1 + 0.3 * (game.stage - 1);

    // ---------- 敵彈 ----------
    function fireBullet(x, y, angle, { speed = ENEMY_BULLET_SPEED, size = 'small' } = {}) {
        const v = speed * difficulty();
        game.bullets.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, radius: size === 'large' ? 4 : 2.5, size });
    }

    const angleToPlayer = (x, y) => Math.atan2(game.player.y - y, game.player.x - x);

    function fan(x, y, center, count, spread, options) {
        for (let i = 0; i < count; i++) {
            const t = count === 1 ? 0 : i / (count - 1) - 0.5;
            fireBullet(x, y, center + toRad(spread) * t, options);
        }
    }

    function ring(x, y, count, offset = 0, options) {
        for (let i = 0; i < count; i++) fireBullet(x, y, offset + (Math.PI * 2 * i) / count, options);
    }

    // ---------- 敵人 ----------
    function spawnEnemy(kind, props) {
        const def = ENEMIES[kind];
        const enemy = {
            id: nextId++,
            kind,
            hp: Math.round(def.hp * hpScale()),
            maxHp: Math.round(def.hp * hpScale()),
            radius: def.radius,
            age: 0,
            flash: 0,
            fireTimer: 0.8 + random() * 1.2,
            entered: false,
            ...props,
        };
        game.enemies.push(enemy);
        return enemy;
    }

    // 各種出場隊形
    const WAVES = {
        // 一列直線落下、左右擺動
        column() {
            const x = 30 + random() * (WIDTH - 60);
            for (let i = 0; i < 5; i++) {
                spawnEnemy('drone', { x, y: -12 - i * 18, baseX: x, vy: 62, sway: 18, phase: i * 0.6, move: 'sway' });
            }
        },
        // V 字隊形直落
        vee() {
            const x = 40 + random() * (WIDTH - 80);
            for (let i = 0; i < 5; i++) {
                const offset = i - 2;
                spawnEnemy('drone', { x: x + offset * 14, y: -12 - Math.abs(offset) * 12, baseX: x + offset * 14, vy: 70, sway: 0, move: 'sway' });
            }
        },
        // 從側邊繞弧線橫越
        sweep() {
            const fromLeft = random() < 0.5;
            for (let i = 0; i < 5; i++) {
                spawnEnemy('fighter', {
                    x: fromLeft ? -12 - i * 16 : WIDTH + 12 + i * 16,
                    y: 30 + i * 4,
                    vx: fromLeft ? 75 : -75,
                    vy: 8,
                    curve: fromLeft ? 1 : -1,
                    move: 'sweep',
                });
            }
        },
        // 兩側同時俯衝向玩家
        pincer() {
            for (const side of [-1, 1]) {
                for (let i = 0; i < 3; i++) {
                    spawnEnemy('fighter', {
                        x: side < 0 ? 20 + i * 14 : WIDTH - 20 - i * 14,
                        y: -14 - i * 16,
                        vx: 0,
                        vy: 90,
                        move: 'dive',
                    });
                }
            }
        },
        // 大型砲艇：下降、停住開火、離開
        gunship() {
            const x = 40 + random() * (WIDTH - 80);
            spawnEnemy('gunship', { x, y: -20, stopY: 55 + random() * 30, hold: 5, move: 'hover', pattern: 0 });
        },
    };

    function pickWave() {
        const pool = ['column', 'vee', 'column', 'sweep'];
        if (game.time > 10) pool.push('pincer', 'sweep');
        if (game.time > 16) pool.push('gunship');
        if (game.stage > 1) pool.push('gunship', 'pincer');
        return pool[Math.floor(random() * pool.length)];
    }

    function spawnBoss() {
        bossSpawned = true;
        const boss = spawnEnemy('boss', { x: WIDTH / 2, y: -40, move: 'boss', pattern: 0, patternTime: 0, spin: 0 });
        game.boss = boss;
        emit({ type: 'bossAppear', stage: game.stage });
    }

    function moveEnemy(enemy, dt) {
        enemy.age += dt;
        switch (enemy.move) {
            case 'sway':
                enemy.y += enemy.vy * dt;
                enemy.x = enemy.baseX + Math.sin(enemy.age * 2.4 + (enemy.phase ?? 0)) * enemy.sway;
                break;
            case 'sweep':
                // 先橫向飛入，之後彎向下方離開
                if (enemy.age > 0.9) enemy.vy = Math.min(enemy.vy + 90 * dt, 110);
                enemy.vx -= enemy.curve * 18 * dt;
                enemy.x += enemy.vx * dt;
                enemy.y += enemy.vy * dt;
                break;
            case 'dive':
                // 衝到一半時朝玩家的 x 修正方向
                if (enemy.age > 0.6 && enemy.age < 1.2) enemy.vx += Math.sign(game.player.x - enemy.x) * 120 * dt;
                enemy.x += enemy.vx * dt;
                enemy.y += enemy.vy * dt;
                break;
            case 'hover':
                if (enemy.hold > 0 && enemy.y < enemy.stopY) {
                    enemy.y += Math.max(12, (enemy.stopY - enemy.y) * 2) * dt;
                } else if (enemy.hold > 0) {
                    enemy.hold -= dt;
                    enemy.x += Math.sin(enemy.age) * 12 * dt;
                } else {
                    enemy.y += 45 * dt;
                }
                break;
            case 'boss':
                if (enemy.y < 58) {
                    enemy.y += 30 * dt;
                } else {
                    enemy.x = WIDTH / 2 + Math.sin(enemy.age * 0.6) * (WIDTH / 2 - 42);
                }
                break;
        }
        const inside = enemy.x > -20 && enemy.x < WIDTH + 20 && enemy.y > -20 && enemy.y < HEIGHT + 20;
        if (inside && enemy.y > 0) enemy.entered = true;
        return !enemy.entered || inside;
    }

    function enemyFire(enemy, dt) {
        if (enemy.y < 8 || enemy.y > HEIGHT * 0.7) return;
        enemy.fireTimer -= dt * difficulty();
        if (enemy.fireTimer > 0) return;
        const aim = angleToPlayer(enemy.x, enemy.y);
        switch (enemy.kind) {
            case 'drone':
                if (random() < 0.45) fireBullet(enemy.x, enemy.y + 4, aim);
                enemy.fireTimer = 99;
                break;
            case 'fighter':
                fireBullet(enemy.x, enemy.y + 4, aim, { speed: 85 });
                enemy.fireTimer = 1.4;
                break;
            case 'gunship':
                if (enemy.hold <= 0) {
                    enemy.fireTimer = 99;
                    break;
                }
                enemy.pattern ^= 1;
                if (enemy.pattern) fan(enemy.x, enemy.y + 8, aim, 5, 50);
                else ring(enemy.x, enemy.y, 12, random() * Math.PI, { size: 'large', speed: 55 });
                enemy.fireTimer = 1.1;
                break;
            case 'boss':
                bossFire(enemy);
                break;
        }
    }

    // 頭目攻擊：螺旋、瞄準扇形、兩側砲台連射；血量低於一半時更密集
    function bossFire(boss) {
        const angry = boss.hp < boss.maxHp / 2;
        const aim = angleToPlayer(boss.x, boss.y);
        boss.patternTime += 1;
        const cycle = Math.floor(boss.patternTime / (angry ? 18 : 24)) % 3;
        if (cycle === 0) {
            boss.spin += angry ? 0.47 : 0.37;
            fireBullet(boss.x, boss.y + 6, boss.spin, { speed: 60 });
            fireBullet(boss.x, boss.y + 6, boss.spin + Math.PI, { speed: 60 });
            if (angry) fireBullet(boss.x, boss.y + 6, -boss.spin, { speed: 55, size: 'large' });
            boss.fireTimer = angry ? 0.07 : 0.09;
        } else if (cycle === 1) {
            if (boss.patternTime % 6 === 0) fan(boss.x, boss.y + 14, aim, angry ? 9 : 7, angry ? 80 : 60, { speed: 90 });
            boss.fireTimer = 0.12;
        } else {
            for (const side of [-1, 1]) fireBullet(boss.x + side * 28, boss.y + 6, angleToPlayer(boss.x + side * 28, boss.y), { speed: 110 });
            if (angry && boss.patternTime % 4 === 0) ring(boss.x, boss.y, 16, boss.patternTime * 0.1, { size: 'large', speed: 50 });
            boss.fireTimer = 0.16;
        }
    }

    function damage(enemy, amount) {
        if (enemy.hp <= 0) return;
        enemy.hp -= amount;
        enemy.flash = 0.06;
        if (enemy.hp > 0) return;
        const def = ENEMIES[enemy.kind];
        const points = Math.round(def.points * (enemy.kind === 'boss' ? game.stage : 1));
        game.score += points;
        game.kills++;
        emit({ type: 'enemyDown', kind: enemy.kind, x: enemy.x, y: enemy.y, points });
        if (enemy.kind === 'gunship' || game.kills % 25 === 0) dropItem(enemy.x, enemy.y);
        if (enemy.kind === 'boss') bossDefeated(enemy);
    }

    function bossDefeated(boss) {
        game.boss = null;
        game.bullets = [];
        dropItem(boss.x - 16, boss.y, 'power');
        dropItem(boss.x + 16, boss.y, 'power');
        dropItem(boss.x, boss.y + 10, 'bomb');
        game.phase = 'stageClear';
        game.phaseTimer = STAGE_CLEAR_PAUSE;
        emit({ type: 'stageClear', stage: game.stage });
    }

    // ---------- 道具 ----------
    function dropItem(x, y, kind) {
        if (!kind) {
            const roll = random();
            const { player } = game;
            if (roll < 0.2 && player.missiles < MAX_MISSILES) kind = 'missile';
            else if (roll < 0.32) kind = 'bomb';
            else kind = 'power';
        }
        game.items.push({ id: nextId++, kind, x, y, age: 0, vx: (random() - 0.5) * 20 });
    }

    function collect(item) {
        const { player } = game;
        let result;
        if (item.kind === 'power') {
            const weapon = itemWeapon(item);
            if (weapon === player.weapon && player.power >= MAX_POWER) {
                game.score += 1000;
                result = 'bonus';
            } else if (weapon === player.weapon) {
                player.power++;
                result = 'powerUp';
            } else {
                player.weapon = weapon;
                result = 'switch';
            }
        } else if (item.kind === 'missile') {
            if (player.missiles >= MAX_MISSILES) {
                game.score += 1000;
                result = 'bonus';
            } else {
                player.missiles++;
                result = 'missileUp';
            }
        } else {
            if (game.bombs >= MAX_BOMBS) {
                game.score += 1000;
                result = 'bonus';
            } else {
                game.bombs++;
                result = 'bombUp';
            }
        }
        emit({ type: 'pickup', kind: item.kind, result, x: item.x, y: item.y, weapon: player.weapon, power: player.power });
    }

    // ---------- 玩家 ----------
    function playerFire(dt) {
        const { player } = game;
        fireTimer -= dt;
        if (fireTimer <= 0) {
            if (player.weapon === 'vulcan') {
                for (const [dx, deg] of VULCAN_PATTERNS[player.power - 1]) {
                    const a = toRad(deg);
                    game.shots.push({ kind: 'vulcan', x: player.x + dx, y: player.y - 8, vx: Math.sin(a) * SHOT_SPEED, vy: -Math.cos(a) * SHOT_SPEED, damage: 1 });
                }
                fireTimer = VULCAN_RATE;
            } else {
                const { offsets, damage: dmg } = LASER_PATTERNS[player.power - 1];
                for (const dx of offsets) game.shots.push({ kind: 'laser', x: player.x + dx, y: player.y - 10, vx: 0, vy: -LASER_SPEED, damage: dmg });
                fireTimer = LASER_RATE;
            }
        }
        if (player.missiles > 0) {
            missileTimer -= dt;
            if (missileTimer <= 0) {
                for (let i = 0; i < player.missiles; i++) {
                    const side = i % 2 === 0 ? -1 : 1;
                    game.shots.push({
                        kind: 'missile',
                        x: player.x + side * (6 + i * 2),
                        y: player.y,
                        angle: -Math.PI / 2 + side * 0.5,
                        vx: 0,
                        vy: 0,
                        damage: 2.5,
                        target: null,
                    });
                }
                missileTimer = MISSILE_RATE;
            }
        }
    }

    function nearestEnemy(x, y) {
        let best = null;
        let bestD = Infinity;
        for (const enemy of game.enemies) {
            if (enemy.hp <= 0 || enemy.y < 0) continue;
            const d = dist2(enemy, { x, y });
            if (d < bestD) {
                bestD = d;
                best = enemy;
            }
        }
        return best;
    }

    function updateShots(dt) {
        for (const shot of game.shots) {
            if (shot.kind === 'missile') {
                // 追蹤：逐步轉向最近的敵人
                if (!shot.target || shot.target.hp <= 0) shot.target = nearestEnemy(shot.x, shot.y);
                if (shot.target) {
                    const want = Math.atan2(shot.target.y - shot.y, shot.target.x - shot.x);
                    let diff = want - shot.angle;
                    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                    shot.angle += clamp(diff, -MISSILE_TURN * dt, MISSILE_TURN * dt);
                }
                shot.vx = Math.cos(shot.angle) * MISSILE_SPEED;
                shot.vy = Math.sin(shot.angle) * MISSILE_SPEED;
            }
            shot.x += shot.vx * dt;
            shot.y += shot.vy * dt;
            if (shot.y < -16 || shot.x < -16 || shot.x > WIDTH + 16 || shot.y > HEIGHT + 16) {
                shot.dead = true;
                continue;
            }
            for (const enemy of game.enemies) {
                if (enemy.hp <= 0 || enemy.y < -4) continue;
                const hitRadius = enemy.kind === 'boss' ? enemy.radius + 6 : enemy.radius + 2;
                if (Math.abs(shot.x - enemy.x) < hitRadius && Math.abs(shot.y - enemy.y) < enemy.radius + 4) {
                    damage(enemy, shot.damage);
                    shot.dead = true;
                    emit({ type: 'hit', x: shot.x, y: shot.y, kind: shot.kind });
                    break;
                }
            }
        }
        game.shots = game.shots.filter((s) => !s.dead);
    }

    function killPlayer() {
        const { player } = game;
        player.alive = false;
        game.lives--;
        player.power = Math.max(1, player.power - 1);
        player.missiles = Math.max(0, player.missiles - 1);
        emit({ type: 'playerDown', x: player.x, y: player.y, lives: game.lives });
        if (game.lives <= 0) {
            game.phase = 'over';
            emit({ type: 'gameOver', score: game.score });
        } else {
            game.respawnTimer = RESPAWN_DELAY;
        }
    }

    function respawn() {
        const { player } = game;
        Object.assign(player, { x: WIDTH / 2, y: HEIGHT - 40, alive: true, invulnerable: INVULNERABLE_TIME });
        game.bombs = Math.max(game.bombs, START_BOMBS);
        game.bullets = [];
        emit({ type: 'respawn' });
    }

    function bomb() {
        const { player } = game;
        if (!player.alive || game.bombs <= 0 || game.bombTimer > 0 || game.phase === 'over') return false;
        game.bombs--;
        game.bombTimer = BOMB_DURATION;
        player.invulnerable = Math.max(player.invulnerable, BOMB_DURATION + 0.4);
        game.bullets = [];
        for (const enemy of game.enemies) {
            if (enemy.y > -10) damage(enemy, enemy.kind === 'boss' ? BOMB_DAMAGE * 2 : BOMB_DAMAGE);
        }
        emit({ type: 'bomb', x: player.x, y: player.y });
        return true;
    }

    // ---------- 每一步 ----------
    // input：{ dx, dy（鍵盤方向 -1–1）, focus（慢速）, targetX, targetY（觸控目標位置） }
    function update(dt, input = {}) {
        if (game.phase === 'over') return;
        const { player } = game;

        if (game.phase === 'stageClear') {
            game.phaseTimer -= dt;
            if (game.phaseTimer <= 0) {
                game.stage++;
                game.time = 0;
                bossSpawned = false;
                waveTimer = 1.5;
                game.phase = 'play';
                emit({ type: 'stageStart', stage: game.stage });
            }
        } else {
            if (!game.boss) game.time += dt;
            if (!bossSpawned && game.time >= BOSS_TIME) {
                spawnBoss();
            } else if (!bossSpawned) {
                waveTimer -= dt;
                if (waveTimer <= 0) {
                    WAVES[pickWave()]();
                    waveTimer = (2.4 + random() * 1.2) / Math.sqrt(difficulty());
                }
            }
        }

        // 玩家
        if (player.alive) {
            const speed = input.focus ? FOCUS_SPEED : PLAYER_SPEED;
            let dx = input.dx ?? 0;
            let dy = input.dy ?? 0;
            const length = Math.hypot(dx, dy);
            if (length > 1) {
                dx /= length;
                dy /= length;
            }
            player.x += dx * speed * dt;
            player.y += dy * speed * dt;
            if (typeof input.targetX === 'number') {
                // 觸控：往目標位置移動，最快為鍵盤速度的 2.5 倍
                const tx = input.targetX - player.x;
                const ty = input.targetY - player.y;
                const d = Math.hypot(tx, ty);
                const max = PLAYER_SPEED * 2.5 * dt;
                if (d > 0) {
                    const k = Math.min(1, max / d);
                    player.x += tx * k;
                    player.y += ty * k;
                }
            }
            player.x = clamp(player.x, 8, WIDTH - 8);
            player.y = clamp(player.y, 16, HEIGHT - 12);
            player.invulnerable = Math.max(0, player.invulnerable - dt);
            playerFire(dt);
        } else if (game.lives > 0) {
            game.respawnTimer -= dt;
            if (game.respawnTimer <= 0) respawn();
        }
        game.bombTimer = Math.max(0, game.bombTimer - dt);

        updateShots(dt);

        // 敵人
        for (const enemy of game.enemies) {
            enemy.flash = Math.max(0, enemy.flash - dt);
            if (enemy.hp <= 0) continue;
            if (!moveEnemy(enemy, dt)) {
                enemy.gone = true;
                continue;
            }
            if (game.phase === 'play') enemyFire(enemy, dt);
            if (player.alive && player.invulnerable <= 0 && enemy.kind !== 'boss') {
                if (dist2(enemy, player) < (enemy.radius + PLAYER_BODY - 2) ** 2) killPlayer();
            }
        }
        game.enemies = game.enemies.filter((e) => e.hp > 0 && !e.gone);

        // 炸彈期間持續清除敵彈
        if (game.bombTimer > 0) game.bullets = [];

        // 敵彈
        for (const bullet of game.bullets) {
            bullet.x += bullet.vx * dt;
            bullet.y += bullet.vy * dt;
            if (bullet.x < -8 || bullet.x > WIDTH + 8 || bullet.y < -8 || bullet.y > HEIGHT + 8) {
                bullet.dead = true;
                continue;
            }
            if (player.alive && player.invulnerable <= 0 && dist2(bullet, player) < (bullet.radius + PLAYER_HITBOX) ** 2) {
                bullet.dead = true;
                killPlayer();
            }
        }
        game.bullets = game.bullets.filter((b) => !b.dead);

        // 道具：緩慢往下飄，靠近時吸過來
        for (const item of game.items) {
            item.age += dt;
            item.vx *= 0.98;
            item.x = clamp(item.x + item.vx * dt, 8, WIDTH - 8);
            item.y += 26 * dt;
            if (player.alive) {
                const d2 = dist2(item, player);
                if (d2 < 40 ** 2) {
                    const d = Math.sqrt(d2) || 1;
                    item.x += ((player.x - item.x) / d) * 90 * dt;
                    item.y += ((player.y - item.y) / d) * 90 * dt;
                }
                if (d2 < PICKUP_RADIUS ** 2) {
                    item.dead = true;
                    collect(item);
                }
            }
            if (item.y > HEIGHT + 10) item.dead = true;
        }
        game.items = game.items.filter((i) => !i.dead);
    }

    function takeEvents() {
        const taken = events;
        events = [];
        return taken;
    }

    Object.assign(game, { update, bomb, takeEvents, spawnEnemy, dropItem, fireBullet, spawnBoss });
    return game;
}

// P 道具目前代表的武器：每 1.5 秒在紅（vulcan）藍（laser）之間切換
export function itemWeapon(item) {
    return Math.floor(item.age / 1.5) % 2 === 0 ? 'vulcan' : 'laser';
}
