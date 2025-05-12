const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Set canvas size
function resizeCanvas() {
    const gameBoard = document.querySelector('.game-board');
    const boardWidth = gameBoard.clientWidth - 20; // Subtract padding
    const aspectRatio = 4/3; // Maintain 4:3 aspect ratio
    canvas.width = boardWidth;
    canvas.height = boardWidth / aspectRatio;
}

// Initial resize
resizeCanvas();

// Resize on window resize
window.addEventListener('resize', resizeCanvas);

// Game States
const GAME_STATE = {
    READY: 'ready',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAME_OVER: 'gameOver',
    GAME_WON: 'gameWon',
};
let gameState = GAME_STATE.READY;

// Game variables
let paddleWidth = canvas.width * 0.15; // 15% of canvas width
let paddleHeight = canvas.height * 0.02; // 2% of canvas height
let paddleX = (canvas.width - paddleWidth) / 2;
const paddleSpeed = canvas.width * 0.01; // 1% of canvas width

let ballRadius = canvas.width * 0.015; // 1.5% of canvas width
let ballX;
let ballY;
const initialBallSpeedY = -canvas.height * 0.01; // 1% of canvas height
const initialBallSpeedXMagnitude = canvas.width * 0.005; // 0.5% of canvas width
let ballSpeedX = 0;
let ballSpeedY = 0;

let brickRowCount = 5;
let brickColumnCount = 8;
let brickWidth = (canvas.width - 60) / brickColumnCount; // Account for padding
let brickHeight = canvas.height * 0.03; // 3% of canvas height
let brickPadding = canvas.width * 0.01; // 1% of canvas width
let brickOffsetTop = canvas.height * 0.05; // 5% of canvas height
let brickOffsetLeft = canvas.width * 0.02; // 2% of canvas width

const brickColors = ['#FF0000', '#FFA500', '#FFFF00', '#00FF00', '#0000FF'];

let score = 0;
let lives = 3;

// Update score and lives display
function updateDisplay() {
    document.getElementById('score').textContent = score;
    document.getElementById('lives').textContent = lives;
}

const bricks = [];
for (let c = 0; c < brickColumnCount; c++) {
    bricks[c] = [];
    for (let r = 0; r < brickRowCount; r++) {
        bricks[c][r] = { x: 0, y: 0, status: 1 };
    }
}

// Paddle movement
let rightPressed = false;
let leftPressed = false;

document.addEventListener('keydown', keyDownHandler, false);
document.addEventListener('keyup', keyUpHandler, false);
document.addEventListener('mousemove', mouseMoveHandler, false);
document.addEventListener('touchmove', touchMoveHandler, false);

// Add restart button listeners
document.getElementById('restart-btn').addEventListener('click', resetGame);
document.getElementById('play-again-btn').addEventListener('click', resetGame);

function setupBallOnPaddle() {
    gameState = GAME_STATE.READY;
    paddleX = (canvas.width - paddleWidth) / 2;
    ballX = paddleX + paddleWidth / 2;
    ballY = canvas.height - paddleHeight - ballRadius - 1;
    ballSpeedX = 0;
    ballSpeedY = 0;
}

function launchBall() {
    if (gameState === GAME_STATE.READY) {
        gameState = GAME_STATE.PLAYING;
        ballSpeedY = initialBallSpeedY;
        ballSpeedX = initialBallSpeedXMagnitude * (Math.random() > 0.5 ? 1 : -1);
    }
}

function keyDownHandler(e) {
    if (e.key === ' ' || e.code === 'Space') {
        if (gameState === GAME_STATE.READY) {
            launchBall();
        }
        e.preventDefault();
    }
    if (gameState !== GAME_STATE.PLAYING && gameState !== GAME_STATE.READY) return;

    if (e.key === 'Right' || e.key === 'ArrowRight') {
        rightPressed = true;
    } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
        leftPressed = true;
    }
}

function keyUpHandler(e) {
    if (e.key === 'Right' || e.key === 'ArrowRight') {
        rightPressed = false;
    } else if (e.key === 'Left' || e.key === 'ArrowLeft') {
        leftPressed = false;
    }
}

function mouseMoveHandler(e) {
    if (gameState !== GAME_STATE.PLAYING && gameState !== GAME_STATE.READY) return;
    const relativeX = e.clientX - canvas.getBoundingClientRect().left;
    if (relativeX > 0 && relativeX < canvas.width) {
        paddleX = relativeX - paddleWidth / 2;
        if (paddleX < 0) paddleX = 0;
        if (paddleX + paddleWidth > canvas.width) paddleX = canvas.width - paddleWidth;
    }
}

function touchMoveHandler(e) {
    if (gameState !== GAME_STATE.PLAYING && gameState !== GAME_STATE.READY) return;
    e.preventDefault();
    const touch = e.touches[0];
    const relativeX = touch.clientX - canvas.getBoundingClientRect().left;
    if (relativeX > 0 && relativeX < canvas.width) {
        paddleX = relativeX - paddleWidth / 2;
        if (paddleX < 0) paddleX = 0;
        if (paddleX + paddleWidth > canvas.width) paddleX = canvas.width - paddleWidth;
    }
}

function drawPaddle() {
    ctx.beginPath();
    ctx.rect(paddleX, canvas.height - paddleHeight, paddleWidth, paddleHeight);
    ctx.fillStyle = '#33cc33';
    ctx.fill();
    ctx.closePath();
}

function drawBall() {
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc00';
    ctx.fill();
    ctx.closePath();
}

function drawBricks() {
    for (let c = 0; c < brickColumnCount; c++) {
        for (let r = 0; r < brickRowCount; r++) {
            if (bricks[c][r].status === 1) {
                const brickX = c * (brickWidth + brickPadding) + brickOffsetLeft;
                const brickY = r * (brickHeight + brickPadding) + brickOffsetTop;
                bricks[c][r].x = brickX;
                bricks[c][r].y = brickY;
                ctx.beginPath();
                ctx.rect(brickX, brickY, brickWidth, brickHeight);
                ctx.fillStyle = brickColors[r % brickColors.length];
                ctx.fill();
                ctx.closePath();
            }
        }
    }
}

function collisionDetection() {
    if (gameState !== GAME_STATE.PLAYING) return;
    
    for (let c = 0; c < brickColumnCount; c++) {
        for (let r = 0; r < brickRowCount; r++) {
            const b = bricks[c][r];
            if (b.status === 1) {
                if (ballX > b.x && ballX < b.x + brickWidth && ballY > b.y && ballY < b.y + brickHeight) {
                    ballSpeedY = -ballSpeedY;
                    b.status = 0;
                    score++;
                    updateDisplay();
                    if (score === brickRowCount * brickColumnCount) {
                        gameState = GAME_STATE.GAME_WON;
                        showGameOver(true);
                    }
                }
            }
        }
    }

    if (
        ballY + ballRadius > canvas.height - paddleHeight &&
        ballY - ballRadius < canvas.height - paddleHeight + paddleHeight &&
        ballX + ballRadius > paddleX &&
        ballX - ballRadius < paddleX + paddleWidth
    ) {
        if (ballSpeedY > 0 || (ballY + ballRadius >= canvas.height - paddleHeight && ballSpeedY === 0)) {
            ballY = canvas.height - paddleHeight - ballRadius;
            ballSpeedY = -Math.abs(ballSpeedY);
            if (ballSpeedY === 0) ballSpeedY = initialBallSpeedY;

            let deltaX = ballX - (paddleX + paddleWidth / 2);
            ballSpeedX = deltaX * 0.1;
        }
    }
}

function drawReadyScreen() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBricks();
    drawPaddle();
    drawBall();
    
    ctx.font = '24px Arial';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('Press SPACE to Start', canvas.width / 2, canvas.height / 2);
}

function showGameOver(isWin) {
    const gameOver = document.getElementById('game-over');
    const finalScore = document.getElementById('final-score');
    const title = gameOver.querySelector('h2');
    
    finalScore.textContent = score;
    title.textContent = isWin ? 'You Win!' : 'Game Over!';
    gameOver.classList.add('active');
}

function resetGame() {
    score = 0;
    lives = 3;
    updateDisplay();
    document.getElementById('game-over').classList.remove('active');
    
    for (let c = 0; c < brickColumnCount; c++) {
        for (let r = 0; r < brickRowCount; r++) {
            bricks[c][r].status = 1;
        }
    }
    setupBallOnPaddle();
}

function updateGame() {
    if (gameState === GAME_STATE.READY) {
        drawReadyScreen();
        ballX = paddleX + paddleWidth / 2;
        return;
    }

    if (gameState !== GAME_STATE.PLAYING) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBricks();
    drawPaddle();
    drawBall();

    if (rightPressed && paddleX < canvas.width - paddleWidth) {
        paddleX += paddleSpeed;
    } else if (leftPressed && paddleX > 0) {
        paddleX -= paddleSpeed;
    }

    ballX += ballSpeedX;
    ballY += ballSpeedY;

    if (ballX + ballRadius > canvas.width || ballX - ballRadius < 0) {
        ballSpeedX = -ballSpeedX;
    }
    if (ballY - ballRadius < 0) {
        ballSpeedY = -ballSpeedY;
    }

    if (ballY + ballRadius > canvas.height) {
        lives--;
        updateDisplay();
        if (lives === 0) {
            gameState = GAME_STATE.GAME_OVER;
            showGameOver(false);
            return;
        }
        setupBallOnPaddle();
    }

    collisionDetection();
}

// Game loop
function gameLoop() {
    updateGame();
    requestAnimationFrame(gameLoop);
}

// Start the game
setupBallOnPaddle();
gameLoop();
