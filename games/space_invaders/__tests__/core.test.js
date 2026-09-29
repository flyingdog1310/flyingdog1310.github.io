import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ALIEN_COLS,
    ALIEN_ROWS,
    EXTRA_LIFE_AT,
    PLAYER_Y,
    RESPAWN_TIME,
    SPRITES,
    START_LIVES,
    WAVE_PAUSE,
    WIDTH,
    createInvaders,
    marchInterval,
} from '../core.js';

function seeded(seed = 1) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

const STEP = 1 / 60;
function run(game, seconds, input) {
    for (let t = 0; t < seconds; t += STEP) game.update(STEP, input);
}


test('像素圖：同一種圖每一列等寬，兩個影格同尺寸', () => {
    for (const [name, frames] of Object.entries(SPRITES)) {
        const width = frames[0][0].length;
        for (const frame of frames) {
            assert.equal(frame.length, frames[0].length, name);
            for (const row of frame) assert.equal(row.length, width, name);
        }
    }
});

test('開局：5×11 外星人、4 座護盾、3 條命、第 1 波', () => {
    const game = createInvaders({ random: seeded(1) });
    assert.equal(game.aliens.length, ALIEN_COLS * ALIEN_ROWS);
    assert.equal(game.shields.length, 4);
    assert.equal(game.lives, START_LIVES);
    assert.equal(game.wave, 1);
    for (const alien of game.aliens) assert.ok(alien.x >= 0 && alien.x + alien.w <= WIDTH);
});

test('marchInterval：外星人越少走越快，後面的波次更快', () => {
    assert.ok(marchInterval(10) < marchInterval(40));
    assert.ok(marchInterval(1) < 0.05);
    assert.ok(marchInterval(55, 3) < marchInterval(55, 1));
});

test('外星人碰到邊緣時整排往下並反向', () => {
    const game = createInvaders({ random: seeded(2) });
    const top = Math.min(...game.aliens.map((a) => a.y));
    let turned = false;
    for (let i = 0; i < 2000 && !turned; i++) {
        game.update(STEP);
        game.bombs = [];
        if (game.direction === -1) turned = true;
    }
    assert.ok(turned);
    assert.equal(Math.min(...game.aliens.map((a) => a.y)), top + 8);
});

test('射擊：擊中外星人得分，同時最多 2 發', () => {
    const game = createInvaders({ random: seeded(3) });
    const target = game.aliens.find((a) => a.row === ALIEN_ROWS - 1 && a.col === 5);
    game.player.x = target.x + target.w / 2 - 6;
    // 移除護盾以免擋住
    game.shields = [];
    assert.ok(game.fire());
    assert.equal(game.fire(), false, '冷卻中');
    run(game, 0.3);
    assert.ok(game.fire());
    assert.equal(game.shots.length <= 2, true);

    const killed = [];
    for (let i = 0; i < 120 && !killed.length; i++) {
        game.update(STEP);
        game.bombs = [];
        killed.push(...game.takeEvents().filter((e) => e.type === 'alienKilled'));
    }
    assert.equal(killed.length, 1);
    assert.equal(killed[0].alien, 'octopus');
    assert.equal(game.score, 10);
});

test('護盾：子彈打在護盾上會被擋下並留下缺口', () => {
    const game = createInvaders({ random: seeded(4) });
    const shield = game.shields[0];
    const before = shield.cells.reduce((a, b) => a + b, 0);
    game.player.x = shield.x + 5 - 6;
    game.fire();
    let hit = false;
    for (let i = 0; i < 30 && !hit; i++) {
        game.update(STEP);
        game.bombs = [];
        hit = game.takeEvents().some((e) => e.type === 'shieldHit');
    }
    assert.ok(hit);
    assert.equal(game.shots.length, 0);
    assert.ok(shield.cells.reduce((a, b) => a + b, 0) < before);
});

test('被炸彈擊中：少一條命，暫停後在中間重生', () => {
    const game = createInvaders({ random: seeded(5) });
    game.bombs = [{ x: game.player.x + 6, y: PLAYER_Y - 6, w: 1, h: 6, speed: 80, kind: 'plunger' }];
    game.shields = [];
    run(game, 0.2);
    assert.equal(game.lives, START_LIVES - 1);
    assert.equal(game.phase, 'respawn');
    assert.ok(game.takeEvents().some((e) => e.type === 'playerHit'));
    run(game, RESPAWN_TIME + 0.05);
    assert.equal(game.phase, 'play');
});

test('子彈互撞會同時消失', () => {
    const game = createInvaders({ random: seeded(6) });
    game.shields = [];
    const x = game.player.x + 6;
    game.fire();
    game.bombs = [{ x, y: 150, w: 1, h: 6, speed: 80, kind: 'zigzag' }];
    let clash = false;
    for (let i = 0; i < 60 && !clash; i++) {
        game.update(STEP);
        clash = game.takeEvents().some((e) => e.type === 'clash');
    }
    assert.ok(clash);
});

test('全部消滅：暫停後進入下一波，起始位置更低、護盾復原', () => {
    const game = createInvaders({ random: seeded(7) });
    const firstTop = Math.min(...game.aliens.map((a) => a.y));
    game.shields[0].cells.fill(0);
    for (const alien of game.aliens) alien.alive = false;
    game.update(STEP);
    assert.equal(game.phase, 'waveClear');
    run(game, WAVE_PAUSE + 0.05);
    assert.equal(game.wave, 2);
    assert.equal(game.phase, 'play');
    assert.ok(Math.min(...game.aliens.map((a) => a.y)) > firstTop);
    assert.ok(game.shields[0].cells.some((c) => c === 1));
});

test('外星人抵達玩家高度：直接結束', () => {
    const game = createInvaders({ random: seeded(8) });
    for (const alien of game.aliens) alien.y += PLAYER_Y - 60;
    run(game, 1);
    assert.equal(game.phase, 'over');
    assert.ok(game.takeEvents().some((e) => e.type === 'gameOver' && e.cause === 'invaded'));
});

test('命用完：Game over', () => {
    const game = createInvaders({ random: seeded(9) });
    game.lives = 1;
    game.shields = [];
    game.bombs = [{ x: game.player.x + 6, y: PLAYER_Y - 6, w: 1, h: 6, speed: 80, kind: 'plunger' }];
    run(game, 0.2);
    assert.equal(game.phase, 'over');
});

test(`分數達到 ${EXTRA_LIFE_AT}：多一條命（只有一次）`, () => {
    const game = createInvaders({ random: seeded(10) });
    game.shields = [];
    game.score = EXTRA_LIFE_AT - 10;
    const target = game.aliens.find((a) => a.row === ALIEN_ROWS - 1 && a.col === 3);
    game.player.x = target.x + target.w / 2 - 6;
    game.fire();
    for (let i = 0; i < 120 && game.score < EXTRA_LIFE_AT; i++) {
        game.update(STEP);
        game.bombs = [];
    }
    assert.equal(game.lives, START_LIVES + 1);
    assert.ok(game.takeEvents().some((e) => e.type === 'extraLife'));
});

test('觸控：往目標位置移動但不超出場地', () => {
    const game = createInvaders({ random: seeded(11) });
    for (let i = 0; i < 180; i++) {
        game.update(STEP, { targetX: 0 });
        game.bombs = [];
    }
    assert.equal(game.player.x, 2);
});

