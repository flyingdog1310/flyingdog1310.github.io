const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('scoreValue');
const gameOverElement = document.getElementById('game-over');
const finalScoreElement = document.getElementById('finalScore');

canvas.width = 400;
canvas.height = 600;

// game state
let gameOver = false;
let gameReady = true; // <-- Add gameReady state, true by default
let score = 0;

// weapon system define
const WEAPON_TYPES = {
    NORMAL: {
        color: '#fff',
        width: 4,
        height: 10,
        speed: 7,
        damage: 1,
        cooldown: 10,
        pattern: 'single',
    },
    SPREAD: {
        color: '#ffff00',
        width: 3,
        height: 8,
        speed: 8,
        damage: 1,
        cooldown: 15,
        pattern: 'spread',
    },
    LASER: {
        color: '#00ffff',
        width: 6,
        height: 15,
        speed: 10,
        damage: 2,
        cooldown: 20,
        pattern: 'single',
    },
    MISSILE: {
        color: '#ff9900',
        width: 6,
        height: 12,
        speed: 6,
        damage: 3,
        cooldown: 30,
        pattern: 'homing',
    },
};

// player state expand
const player = {
    x: canvas.width / 2,
    y: canvas.height - 50,
    width: 40,
    height: 40,
    speed: 5,
    color: '#00ff00',
    currentWeapon: 'NORMAL',
    shootCooldown: 0,
};

// bullet array
let bullets = [];
const bulletSpeed = 7;

// enemy type define
const ENEMY_TYPES = {
    BASIC: {
        width: 30,
        height: 30,
        color: '#ff0000',
        health: 1,
        speed: 2,
        score: 100,
        pattern: 'straight',
    },
    TANK: {
        width: 40,
        height: 40,
        color: '#ff6600',
        health: 3,
        speed: 1,
        score: 300,
        pattern: 'straight',
    },
    FIGHTER: {
        width: 25,
        height: 25,
        color: '#ff00ff',
        health: 1,
        speed: 3,
        score: 200,
        pattern: 'sine',
    },
};

// enemy array
let enemies = [];
let gameTime = 0;

// key state expand
const keys = {
    ArrowLeft: false,
    ArrowRight: false,
    ArrowUp: false,
    ArrowDown: false,
    Space: false,
    Digit1: false,
    Digit2: false,
    Digit3: false,
    Digit4: false,
};

// listen key event
document.addEventListener('keydown', (e) => {
    if (gameReady) {
        if (e.code === 'Space') {
            gameReady = false;
            // Reset gameTime or any other initializations needed when game actually starts
            gameTime = 0;
            // Potentially reset player position or cooldowns if they were frozen
            player.x = canvas.width / 2;
            player.y = canvas.height - 50;
            player.shootCooldown = 0;
            return; // Consume the first space press for starting the game
        }
        // Allow weapon switching even when game is ready
        if (e.code.startsWith('Digit')) {
            const weaponNumber = parseInt(e.code.replace('Digit', ''));
            const weapons = Object.keys(WEAPON_TYPES);
            if (weaponNumber <= weapons.length) {
                player.currentWeapon = weapons[weaponNumber - 1];
            }
        }
        return; // Don't process other keys if game is in ready state (except for weapon switch)
    }

    if (gameOver) return; // Don't process game input if game over

    if (e.code in keys) {
        keys[e.code] = true;
        // switch weapon
        if (e.code.startsWith('Digit')) {
            const weaponNumber = parseInt(e.code.replace('Digit', ''));
            const weapons = Object.keys(WEAPON_TYPES);
            if (weaponNumber <= weapons.length) {
                player.currentWeapon = weapons[weaponNumber - 1];
            }
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code in keys) {
        keys[e.code] = false;
    }
});

// update player position
function updatePlayer() {
    if (keys.ArrowLeft && player.x > 0) player.x -= player.speed;
    if (keys.ArrowRight && player.x < canvas.width - player.width) player.x += player.speed;
    if (keys.ArrowUp && player.y > 0) player.y -= player.speed;
    if (keys.ArrowDown && player.y < canvas.height - player.height) player.y += player.speed;
}

// shoot bullet
function shoot() {
    if (keys.Space && player.shootCooldown <= 0) {
        const weapon = WEAPON_TYPES[player.currentWeapon];

        switch (weapon.pattern) {
            case 'single':
                createBullet(player.x + player.width / 2, player.y, 0);
                break;

            case 'spread':
                for (let angle = -30; angle <= 30; angle += 30) {
                    createBullet(player.x + player.width / 2, player.y, angle);
                }
                break;

            case 'homing':
                const nearestEnemy = findNearestEnemy();
                createHomingBullet(player.x + player.width / 2, player.y, nearestEnemy);
                break;
        }

        player.shootCooldown = weapon.cooldown;
    }

    if (player.shootCooldown > 0) {
        player.shootCooldown--;
    }
}

// create normal bullet
function createBullet(x, y, angle) {
    const weapon = WEAPON_TYPES[player.currentWeapon];
    const radians = (angle * Math.PI) / 180;

    bullets.push({
        x: x - weapon.width / 2,
        y: y,
        width: weapon.width,
        height: weapon.height,
        color: weapon.color,
        speed: weapon.speed,
        damage: weapon.damage,
        dx: Math.sin(radians) * weapon.speed,
        dy: -Math.cos(radians) * weapon.speed,
        type: player.currentWeapon,
    });
}

// create homing bullet
function createHomingBullet(x, y, target) {
    const weapon = WEAPON_TYPES[player.currentWeapon];

    bullets.push({
        x: x - weapon.width / 2,
        y: y,
        width: weapon.width,
        height: weapon.height,
        color: weapon.color,
        speed: weapon.speed,
        damage: weapon.damage,
        target: target,
        type: player.currentWeapon,
    });
}

// find nearest enemy
function findNearestEnemy() {
    let nearest = null;
    let minDistance = Infinity;

    enemies.forEach((enemy) => {
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance) {
            minDistance = distance;
            nearest = enemy;
        }
    });

    return nearest;
}

// update bullet position
function updateBullets() {
    bullets = bullets.filter((bullet) => {
        if (bullet.type === 'MISSILE' && bullet.target) {
            // homing bullet move logic
            const dx = bullet.target.x - bullet.x;
            const dy = bullet.target.y - bullet.y;
            const angle = Math.atan2(dy, dx);

            bullet.x += Math.cos(angle) * bullet.speed;
            bullet.y += Math.sin(angle) * bullet.speed;
        } else {
            // normal bullet move logic
            bullet.x += bullet.dx || 0;
            bullet.y += bullet.dy || -bullet.speed;
        }

        return bullet.y > 0 && bullet.y < canvas.height && bullet.x > 0 && bullet.x < canvas.width;
    });
}

// spawn enemy
function spawnEnemy() {
    if (Math.random() < 0.02) {
        const types = Object.keys(ENEMY_TYPES);
        const selectedType = types[Math.floor(Math.random() * types.length)];
        const typeConfig = ENEMY_TYPES[selectedType];

        enemies.push({
            x: Math.random() * (canvas.width - typeConfig.width),
            y: -typeConfig.height,
            width: typeConfig.width,
            height: typeConfig.height,
            color: typeConfig.color,
            health: typeConfig.health,
            speed: typeConfig.speed,
            score: typeConfig.score,
            pattern: typeConfig.pattern,
            initialX: 0,
            time: 0,
        });
    }
}

// update enemy position
function updateEnemies() {
    gameTime += 0.016; // about equal to the time of each frame (assuming 60FPS)

    enemies = enemies.filter((enemy) => {
        // update enemy time counter
        enemy.time += 0.016;

        // update position based on different move patterns
        switch (enemy.pattern) {
            case 'straight':
                enemy.y += enemy.speed;
                break;
            case 'sine':
                if (enemy.initialX === 0) {
                    enemy.initialX = enemy.x;
                }
                enemy.y += enemy.speed;
                enemy.x = enemy.initialX + Math.sin(enemy.time * 3) * 50;
                break;
        }

        return enemy.y < canvas.height && enemy.health > 0;
    });
}

// collision detection
function checkCollisions() {
    // bullet hit enemy
    bullets.forEach((bullet, bulletIndex) => {
        enemies.forEach((enemy) => {
            if (collision(bullet, enemy)) {
                bullets.splice(bulletIndex, 1);
                enemy.health -= bullet.damage;

                if (enemy.health <= 0) {
                    const enemyIndex = enemies.indexOf(enemy);
                    if (enemyIndex > -1) {
                        enemies.splice(enemyIndex, 1);
                        score += enemy.score;
                        scoreElement.textContent = score;
                    }
                }
            }
        });
    });

    // player hit enemy
    enemies.forEach((enemy) => {
        if (collision(player, enemy)) {
            gameOver = true;
            finalScoreElement.textContent = score;
            gameOverElement.style.display = 'block';
        }
    });
}

// collision detection function
function collision(rect1, rect2) {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

// draw game objects
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // draw player
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);

    // draw bullets
    bullets.forEach((bullet) => {
        ctx.fillStyle = bullet.color;
        if (bullet.type === 'MISSILE') {
            // missile special draw
            ctx.save();
            ctx.translate(bullet.x + bullet.width / 2, bullet.y + bullet.height / 2);
            if (bullet.target && (bullet.target.x !== bullet.x || bullet.target.y !== bullet.y)) {
                // Check if target exists and not at same position to avoid atan2(0,0)
                const angle = Math.atan2(
                    bullet.target.y - (bullet.y + bullet.height / 2), // Calculate angle from center of bullet
                    bullet.target.x - (bullet.x + bullet.width / 2)
                );
                ctx.rotate(angle + Math.PI / 2); // Add PI/2 because missiles usually point upwards
            }
            ctx.fillRect(-bullet.width / 2, -bullet.height / 2, bullet.width, bullet.height);
            ctx.restore();
        } else {
            // normal bullet draw
            ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
        }
    });

    // draw enemies
    enemies.forEach((enemy) => {
        // draw enemy body
        ctx.fillStyle = enemy.color;
        ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);

        // draw health bar for enemies with health > 1 (e.g., TANKs)
        const enemyTypeDetails = Object.values(ENEMY_TYPES).find((et) => et.color === enemy.color); // A bit inefficient, but works for finding max health
        const maxHealth = enemyTypeDetails ? enemyTypeDetails.health : 1;

        if (enemy.health > 0 && maxHealth > 1 && enemy.health < maxHealth) {
            // Only draw if damaged and maxHealth > 1
            const healthBarWidth = enemy.width;
            const healthBarHeight = 5;
            const healthPercentage = enemy.health / maxHealth;

            // health bar background (e.g., dark red for damage)
            ctx.fillStyle = '#550000';
            ctx.fillRect(enemy.x, enemy.y - healthBarHeight - 2, healthBarWidth, healthBarHeight);

            // current health (e.g., green)
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(enemy.x, enemy.y - healthBarHeight - 2, healthBarWidth * healthPercentage, healthBarHeight);
        }
    });

    // show current weapon type on screen, only if game is not in ready state
    if (!gameReady) {
        ctx.fillStyle = '#fff';
        ctx.font = "16px 'Courier New', Courier, monospace";
        ctx.textAlign = 'left';
        ctx.fillText(`Weapon: ${player.currentWeapon}`, 10, canvas.height - 10);
    }

    // if game ready, show start message
    if (gameReady) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = "30px 'Courier New', Courier, monospace";
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText('Press SPACE to Start', canvas.width / 2, canvas.height / 2 - 30);
        ctx.font = "20px 'Courier New', Courier, monospace";
        ctx.fillText('Use Arrows to Move', canvas.width / 2, canvas.height / 2 + 20);
        ctx.fillText('Space to Shoot', canvas.width / 2, canvas.height / 2 + 50);
        ctx.fillText('1-4 to Switch Weapons', canvas.width / 2, canvas.height / 2 + 80);
    }
}

// game loop
function gameLoop() {
    if (gameOver) {
        gameOverElement.style.display = 'block';
        finalScoreElement.textContent = score;
        return;
    }

    if (!gameReady) {
        // Only run game logic if not in ready state
        updatePlayer();
        shoot();
        updateBullets();
        spawnEnemy();
        updateEnemies();
        checkCollisions();
        gameTime++;
    }

    draw();
    scoreElement.textContent = score;
    requestAnimationFrame(gameLoop);
}

// restart game
function restartGame() {
    gameOver = false;
    gameReady = true; // <-- Set gameReady to true on restart
    score = 0;
    gameTime = 0;
    player.x = canvas.width / 2;
    player.y = canvas.height - 50;
    player.currentWeapon = 'NORMAL';
    player.shootCooldown = 0;
    bullets = [];
    enemies = [];
    keys.Space = false; // Reset space key state
    gameOverElement.style.display = 'none';
    requestAnimationFrame(gameLoop); // <-- ADD THIS LINE to re-initiate the game loop
}

// start game
gameLoop();
