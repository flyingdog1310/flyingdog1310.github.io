const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 600;

class Player {
    constructor() {
        this.width = 50;
        this.height = 30;
        this.x = canvas.width / 2 - this.width / 2;
        this.y = canvas.height - this.height - 10;
        this.speed = 5;
        this.bullets = [];
    }

    draw() {
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }

    move(direction) {
        if (direction === 'left' && this.x > 0) {
            this.x -= this.speed;
        }
        if (direction === 'right' && this.x < canvas.width - this.width) {
            this.x += this.speed;
        }
    }

    shoot() {
        this.bullets.push(new Bullet(this.x + this.width / 2, this.y));
    }
}

class Enemy {
    constructor(x, y) {
        this.width = 40;
        this.height = 30;
        this.x = x;
        this.y = y;
        this.speed = 1;
        this.direction = 1;
    }

    draw() {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }

    move() {
        this.x += this.speed * this.direction;
    }
}

class Bullet {
    constructor(x, y) {
        this.width = 4;
        this.height = 10;
        this.x = x - this.width / 2;
        this.y = y;
        this.speed = 7;
    }

    draw() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }

    move() {
        this.y -= this.speed;
    }
}

const player = new Player();
let enemies = [];
let score = 0;
let lives = 3;
let gameOver = false;
let gameReady = true;
let keys = {};

function createEnemies() {
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 8; j++) {
            enemies.push(new Enemy(j * 80 + 100, i * 60 + 50));
        }
    }
}

function checkCollision(rect1, rect2) {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

function updateScore() {
    document.getElementById('score').textContent = score;
    document.getElementById('lives').textContent = lives;
}

function showGameOver() {
    document.getElementById('gameOver').classList.remove('hidden');
    document.getElementById('finalScore').textContent = score;
}

function resetGame() {
    player.x = canvas.width / 2 - player.width / 2;
    player.bullets = [];
    enemies = [];
    createEnemies();
    score = 0;
    lives = 3;
    gameOver = false;
    gameReady = true;
    document.getElementById('gameOver').classList.add('hidden');
    updateScore();
    gameLoop();
}

function gameLoop() {
    if (gameOver) {
        showGameOver();
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameReady) {
        player.draw();
        ctx.fillStyle = 'white';
        ctx.font = '30px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Press SPACE to Start', canvas.width / 2, canvas.height / 2);
        ctx.font = '20px Arial';
        ctx.fillText('Use ← → to Move, Space to Shoot', canvas.width / 2, canvas.height / 2 + 40);
        requestAnimationFrame(gameLoop);
        return;
    }

    // Player movement
    if (keys['ArrowLeft']) player.move('left');
    if (keys['ArrowRight']) player.move('right');

    // Update and draw player
    player.draw();

    // Update and draw bullets
    player.bullets = player.bullets.filter((bullet) => {
        bullet.move();
        bullet.draw();
        return bullet.y > 0;
    });

    // Update and draw enemies
    let needsToReverse = false;
    enemies.forEach((enemy) => {
        enemy.move();
        enemy.draw();
        if (enemy.x <= 0 || enemy.x + enemy.width >= canvas.width) {
            needsToReverse = true;
        }
    });

    if (needsToReverse) {
        enemies.forEach((enemy) => {
            enemy.direction *= -1;
            enemy.y += 20;
        });
    }

    // Check collisions
    for (let i = enemies.length - 1; i >= 0; i--) {
        for (let j = player.bullets.length - 1; j >= 0; j--) {
            if (checkCollision(enemies[i], player.bullets[j])) {
                enemies.splice(i, 1);
                player.bullets.splice(j, 1);
                score += 10;
                updateScore();
                break;
            }
        }
    }

    // Check if enemies reached player
    if (enemies.some((enemy) => enemy.y + enemy.height >= player.y)) {
        lives--;
        updateScore();
        if (lives <= 0) {
            gameOver = true;
            showGameOver();
            return;
        }
        enemies = [];
        createEnemies();
    }

    // Check win condition
    if (enemies.length === 0) {
        createEnemies();
    }

    requestAnimationFrame(gameLoop);
}

// Event listeners
document.addEventListener('keydown', (e) => {
    if (gameReady) {
        if (e.key === ' ') {
            gameReady = false;
            player.x = canvas.width / 2 - player.width / 2;
            player.bullets = [];
            return;
        }
        return;
    }

    if (gameOver) return;

    keys[e.key] = true;
    if (e.key === ' ') {
        player.shoot();
    }
});

document.addEventListener('keyup', (e) => {
    if (gameOver && e.key !== 'Enter') return;
    keys[e.key] = false;
});

document.getElementById('restartButton').addEventListener('click', resetGame);

// Start game
createEnemies();
updateScore();
gameLoop();
