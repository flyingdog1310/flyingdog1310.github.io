// Get Canvas and Context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game Config
const gridSize = 20;
const tileCount = canvas.width / gridSize;
let speed = 7;

// Snake Initial Position and Speed
let snake = [{ x: 10, y: 10 }];
let dx = 0;
let dy = 0;

// Food Position
let food = {
    x: Math.floor(Math.random() * tileCount),
    y: Math.floor(Math.random() * tileCount),
};

// Game State
let score = 0;
let highScore = 0;
let gameStarted = false;
let gameOver = false;
let hasMoved = false;
let animationId = null;

// Start Button
const startBtn = document.getElementById('startBtn');
const scoreElement = document.getElementById('score');
const highScoreElement = document.getElementById('highScore');
const speedElement = document.getElementById('speed');

// Start Game
startBtn.addEventListener('click', () => {
    if (gameOver) {
        resetGame();
    }
    if (!gameStarted) {
        gameStarted = true;
        hasMoved = false;
        startBtn.style.display = 'none';
        gameLoop();
    }
});

// Reset Game
function resetGame() {
    snake = [{ x: 10, y: 10 }];
    dx = 0;
    dy = 0;
    score = 0;
    speed = 7;
    gameOver = false;
    hasMoved = false;
    gameStarted = false;
    scoreElement.textContent = `Score: ${score}`;
    speedElement.textContent = `Speed: ${speed}`;
    generateFood();
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    startBtn.textContent = 'Start Game';
    startBtn.style.display = 'block';
}

// Update High Score
function updateHighScore() {
    if (score > highScore) {
        highScore = score;
        highScoreElement.textContent = `High Score: ${highScore}`;
    }
}

// Generate Food
function generateFood() {
    food.x = Math.floor(Math.random() * tileCount);
    food.y = Math.floor(Math.random() * tileCount);

    // Ensure Food is Not Generated on Snake
    for (let segment of snake) {
        if (segment.x === food.x && segment.y === food.y) {
            generateFood();
            break;
        }
    }
}

// Game Main Loop
function gameLoop() {
    if (!gameStarted || gameOver) return;

    setTimeout(() => {
        animationId = requestAnimationFrame(gameLoop);
    }, 1000 / speed);

    update();
    draw();
}

// Update Game State
function update() {
    // If Not Moved Yet, Do Not Perform Collision Detection
    if (!hasMoved) return;

    // Move Snake
    const head = { x: snake[0].x + dx, y: snake[0].y + dy };

    // Check if Snake Hits the Wall
    if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
        gameOver = true;
        updateHighScore();
        return;
    }

    // Check if Snake Hits Itself
    for (let segment of snake) {
        if (head.x === segment.x && head.y === segment.y) {
            gameOver = true;
            updateHighScore();
            return;
        }
    }

    snake.unshift(head);

    // Check if Snake Eats Food
    if (head.x === food.x && head.y === food.y) {
        score += 10;
        scoreElement.textContent = `Score: ${score}`;
        generateFood();
        // Increase Speed Every 100 Points
        if (score % 100 === 0) {
            speed += 1;
            speedElement.textContent = `Speed: ${speed}`;
        }
    } else {
        snake.pop();
    }
}

// Draw Game Screen
function draw() {
    // Clear Canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Snake
    ctx.fillStyle = '#538d4e';
    for (let segment of snake) {
        ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 2, gridSize - 2);
    }

    // Draw Food
    ctx.fillStyle = '#b59f3b';
    ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 2, gridSize - 2);

    // Game Over Display
    if (gameOver) {
        ctx.fillStyle = 'black';
        ctx.font = '30px Arial';
        ctx.fillText('Game Over!', canvas.width / 2 - 70, canvas.height / 2);
        startBtn.textContent = 'Restart Game';
        startBtn.style.display = 'block'; // Show Button
        gameStarted = false;
    }
}

// Keyboard Control
document.addEventListener('keydown', (event) => {
    if (!gameStarted) return;

    switch (event.key) {
        case 'ArrowUp':
            if (dy !== 1) {
                // Prevent Moving Down When Moving Up
                dx = 0;
                dy = -1;
                hasMoved = true; // Mark Moved
            }
            break;
        case 'ArrowDown':
            if (dy !== -1) {
                // Prevent Moving Up When Moving Down
                dx = 0;
                dy = 1;
                hasMoved = true; // Mark Moved
            }
            break;
        case 'ArrowLeft':
            if (dx !== 1) {
                // Prevent Moving Right When Moving Left
                dx = -1;
                dy = 0;
                hasMoved = true; // Mark Moved
            }
            break;
        case 'ArrowRight':
            if (dx !== -1) {
                // Prevent Moving Left When Moving Right
                dx = 1;
                dy = 0;
                hasMoved = true; // Mark Moved
            }
            break;
    }
});
