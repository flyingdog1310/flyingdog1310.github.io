class Tank {
    constructor(x, y, color, isPlayer = false) {
        this.x = x;
        this.y = y;
        this.width = 30;
        this.height = 30;
        this.color = color;
        this.speed = isPlayer ? 3 : 2;
        this.direction = 0; // 0: up, 1: right, 2: down, 3: left
        this.isPlayer = isPlayer;
        this.bullets = [];
        this.lastShot = 0;
        this.shootDelay = 500; // milliseconds
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate((Math.PI / 2) * this.direction);
        ctx.translate(-(this.x + this.width / 2), -(this.y + this.height / 2));

        // Tank body
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Tank cannon
        ctx.fillStyle = '#666';
        ctx.fillRect(this.x + this.width / 2 - 2, this.y - 10, 4, 20);

        ctx.restore();

        // Draw bullets
        this.bullets.forEach((bullet) => bullet.draw(ctx));
    }

    move(direction) {
        this.direction = direction;
        switch (direction) {
            case 0: // up
                this.y = Math.max(0, this.y - this.speed);
                break;
            case 1: // right
                this.x = Math.min(canvas.width - this.width, this.x + this.speed);
                break;
            case 2: // down
                this.y = Math.min(canvas.height - this.height, this.y + this.speed);
                break;
            case 3: // left
                this.x = Math.max(0, this.x - this.speed);
                break;
        }
    }

    shoot() {
        const now = Date.now();
        if (now - this.lastShot >= this.shootDelay) {
            let bulletX = this.x + this.width / 2;
            let bulletY = this.y + this.height / 2;
            this.bullets.push(new Bullet(bulletX, bulletY, this.direction, this.isPlayer));
            this.lastShot = now;
        }
    }

    update() {
        // Update bullets
        this.bullets = this.bullets.filter((bullet) => {
            bullet.update();
            return !bullet.isOutOfBounds();
        });
    }
}

class Bullet {
    constructor(x, y, direction, isPlayerBullet) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.speed = 5;
        this.size = 4;
        this.isPlayerBullet = isPlayerBullet;
    }

    draw(ctx) {
        ctx.fillStyle = this.isPlayerBullet ? '#fff' : '#ff0000';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }

    update() {
        switch (this.direction) {
            case 0: // up
                this.y -= this.speed;
                break;
            case 1: // right
                this.x += this.speed;
                break;
            case 2: // down
                this.y += this.speed;
                break;
            case 3: // left
                this.x -= this.speed;
                break;
        }
    }

    isOutOfBounds() {
        return this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height;
    }
}

// Game setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const scoreElement = document.getElementById('score');
const livesElement = document.getElementById('lives');
const gameOverElement = document.getElementById('gameOver');
const finalScoreElement = document.getElementById('finalScore');
const playAgainButton = document.getElementById('playAgainButton');

// Set canvas size
function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Game state
let gameRunning = false;
let score = 0;
let lives = 3;
let player;
let enemies = [];
let lastEnemySpawn = 0;
const enemySpawnDelay = 2000; // milliseconds

// Initialize game
function initGame() {
    player = new Tank(canvas.width / 2, canvas.height - 50, '#538d4e', true);
    enemies = [];
    score = 0;
    lives = 3;
    updateScore();
    updateLives();
}

// Game loop
function gameLoop() {
    if (!gameRunning) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Spawn enemies
    const now = Date.now();
    if (now - lastEnemySpawn >= enemySpawnDelay && enemies.length < 5) {
        const x = Math.random() * (canvas.width - 30);
        enemies.push(new Tank(x, 0, '#ff0000'));
        lastEnemySpawn = now;
    }

    // Update and draw player
    player.update();
    player.draw(ctx);

    // Update and draw enemies
    enemies.forEach((enemy) => {
        enemy.update();
        enemy.draw(ctx);

        // Simple AI: move randomly and shoot occasionally
        if (Math.random() < 0.02) {
            enemy.direction = Math.floor(Math.random() * 4);
        }
        if (Math.random() < 0.01) {
            enemy.shoot();
        }
        enemy.move(enemy.direction);
    });

    // Check collisions
    checkCollisions();

    // Remove dead enemies
    enemies = enemies.filter((enemy) => {
        return !enemy.bullets.some((bullet) => {
            return checkBulletCollision(bullet, player);
        });
    });

    requestAnimationFrame(gameLoop);
}

function checkCollisions() {
    // Check player bullets vs enemies
    player.bullets.forEach((bullet) => {
        enemies.forEach((enemy, index) => {
            if (checkBulletCollision(bullet, enemy)) {
                enemies.splice(index, 1);
                score += 100;
                updateScore();
            }
        });
    });

    // Check enemy bullets vs player
    enemies.forEach((enemy) => {
        enemy.bullets.forEach((bullet) => {
            if (checkBulletCollision(bullet, player)) {
                lives--;
                updateLives();
                if (lives <= 0) {
                    gameOver();
                }
            }
        });
    });
}

function checkBulletCollision(bullet, tank) {
    return bullet.x > tank.x && bullet.x < tank.x + tank.width && bullet.y > tank.y && bullet.y < tank.y + tank.height;
}

function updateScore() {
    scoreElement.textContent = score;
}

function updateLives() {
    livesElement.textContent = lives;
}

function gameOver() {
    gameRunning = false;
    finalScoreElement.textContent = score;
    gameOverElement.style.display = 'block';
    startButton.textContent = 'Play Again';
}

// Controls
const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    ' ': false,
};

window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        e.preventDefault(); // Prevent default behavior for space key
        keys[e.key] = true;
    }
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        e.preventDefault(); // Prevent default behavior for space key
        keys[e.key] = false;
    }
});

// Mobile controls
document.getElementById('upButton').addEventListener('click', () => player.move(0));
document.getElementById('rightButton').addEventListener('click', () => player.move(1));
document.getElementById('downButton').addEventListener('click', () => player.move(2));
document.getElementById('leftButton').addEventListener('click', () => player.move(3));
document.getElementById('fireButton').addEventListener('click', () => player.shoot());

// Start button
startButton.addEventListener('click', () => {
    if (!gameRunning) {
        initGame();
        gameRunning = true;
        startButton.textContent = 'Restart';
        gameOverElement.style.display = 'none';
        gameLoop();
    } else {
        initGame();
    }
});

// Play Again button
playAgainButton.addEventListener('click', () => {
    initGame();
    gameRunning = true;
    gameOverElement.style.display = 'none';
    gameLoop();
});

// Handle player movement
setInterval(() => {
    if (!gameRunning) return;

    if (keys.ArrowUp) player.move(0);
    if (keys.ArrowRight) player.move(1);
    if (keys.ArrowDown) player.move(2);
    if (keys.ArrowLeft) player.move(3);
    if (keys[' ']) {
        player.shoot();
    }
}, 1000 / 60);
