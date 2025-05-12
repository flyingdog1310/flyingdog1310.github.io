const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game States
const GAME_STATE = {
    READY: 'ready',
    PLAYING: 'playing',
    PAUSED: 'paused', // Optional: if you want a pause feature later
    GAME_OVER: 'gameOver',
    GAME_WON: 'gameWon',
};
let gameState = GAME_STATE.READY; // Initial state is READY

// Game variables
let paddleWidth = 75;
let paddleHeight = 10;
let paddleX = (canvas.width - paddleWidth) / 2;
const paddleSpeed = 7;

let ballRadius = 10;
let ballX; // Will be set in setupBallOnPaddle
let ballY; // Will be set in setupBallOnPaddle
const initialBallSpeedY = -3.5; // Slightly faster initial speed
const initialBallSpeedXMagnitude = 2.5;
let ballSpeedX = 0;
let ballSpeedY = 0;

let brickRowCount = 5;
let brickColumnCount = 8;
let brickWidth = 75;
let brickHeight = 20;
let brickPadding = 10;
let brickOffsetTop = 30;
let brickOffsetLeft = 30;

const brickColors = ['#FF0000', '#FFA500', '#FFFF00', '#00FF00', '#0000FF']; // Red, Orange, Yellow, Green, Blue

let score = 0;
let lives = 3;

const bricks = [];
for (let c = 0; c < brickColumnCount; c++) {
    bricks[c] = [];
    for (let r = 0; r < brickRowCount; r++) {
        bricks[c][r] = { x: 0, y: 0, status: 1 }; // status 1 means brick is active
    }
}

// Paddle movement
let rightPressed = false;
let leftPressed = false;

document.addEventListener('keydown', keyDownHandler, false);
document.addEventListener('keyup', keyUpHandler, false);
document.addEventListener('mousemove', mouseMoveHandler, false);
// Add keydown listener for restarting the game
document.addEventListener('keydown', restartGameHandler, false);

function setupBallOnPaddle() {
    gameState = GAME_STATE.READY;
    paddleX = (canvas.width - paddleWidth) / 2;
    ballX = paddleX + paddleWidth / 2;
    ballY = canvas.height - paddleHeight - ballRadius - 1; // -1 to avoid immediate collision
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
        // Prevent space from scrolling the page if the game iframe has focus
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
    const relativeX = e.clientX - canvas.offsetLeft;
    if (relativeX > 0 && relativeX < canvas.width) {
        paddleX = relativeX - paddleWidth / 2;
        if (paddleX < 0) paddleX = 0;
        if (paddleX + paddleWidth > canvas.width) paddleX = canvas.width - paddleWidth;

        // If ball is on paddle, it moves with the paddle
        // if (gameState === GAME_STATE.READY) {
        //    ballX = paddleX + paddleWidth / 2;
        // }
        // This is handled in updateGame now
    }
}

function drawPaddle() {
    ctx.beginPath();
    ctx.rect(paddleX, canvas.height - paddleHeight, paddleWidth, paddleHeight);
    ctx.fillStyle = '#33cc33'; // Bright green paddle
    ctx.fill();
    ctx.closePath();
}

function drawBall() {
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc00'; // Yellow/orange ball
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
                ctx.fillStyle = brickColors[r % brickColors.length]; // Assign color based on row
                ctx.fill();
                ctx.closePath();
            }
        }
    }
}

function collisionDetection() {
    if (gameState !== GAME_STATE.PLAYING) return;
    // Ball and brick collision
    for (let c = 0; c < brickColumnCount; c++) {
        for (let r = 0; r < brickRowCount; r++) {
            const b = bricks[c][r];
            if (b.status === 1) {
                if (ballX > b.x && ballX < b.x + brickWidth && ballY > b.y && ballY < b.y + brickHeight) {
                    ballSpeedY = -ballSpeedY;
                    b.status = 0; // Brick is hit
                    score++;
                    if (score === brickRowCount * brickColumnCount) {
                        gameState = GAME_STATE.GAME_WON;
                    }
                }
            }
        }
    }

    // Ball and paddle collision
    if (
        ballY + ballRadius > canvas.height - paddleHeight && // Check if ball is at paddle level
        ballY - ballRadius < canvas.height - paddleHeight + paddleHeight && // Ensure it's not too far above
        ballX + ballRadius > paddleX &&
        ballX - ballRadius < paddleX + paddleWidth
    ) {
        // Make sure ball is moving downwards to collide, or is just above and moving towards
        if (ballSpeedY > 0 || (ballY + ballRadius >= canvas.height - paddleHeight && ballSpeedY === 0)) {
            ballY = canvas.height - paddleHeight - ballRadius; // Place ball on top of paddle
            ballSpeedY = -Math.abs(ballSpeedY); // Ensure it always bounces up
            if (ballSpeedY === 0) ballSpeedY = initialBallSpeedY; // if it was stationary somehow

            // Optional: Add some X-velocity based on where it hits the paddle
            let deltaX = ballX - (paddleX + paddleWidth / 2);
            ballSpeedX = deltaX * 0.1; // Adjust multiplier for desired effect
        }
    }
}

function drawScore() {
    ctx.font = '16px Arial';
    ctx.fillStyle = '#fff'; // White score text
    ctx.fillText('Score: ' + score, 40, 20);
}

function drawLives() {
    ctx.font = '16px Arial';
    ctx.fillStyle = '#fff'; // White lives text
    ctx.fillText('Lives: ' + lives, canvas.width - 65, 20);
}

function resetGame() {
    score = 0;
    lives = 3;
    for (let c = 0; c < brickColumnCount; c++) {
        for (let r = 0; r < brickRowCount; r++) {
            bricks[c][r].status = 1;
        }
    }
    setupBallOnPaddle(); // This will set gameState to READY and position ball
}

function restartGameHandler(e) {
    if (
        (e.key === 'Enter' || e.code === 'Enter') &&
        (gameState === GAME_STATE.GAME_OVER || gameState === GAME_STATE.GAME_WON)
    ) {
        resetGame();
    }
}

function drawGameOverScreen() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
    ctx.fillStyle = '#000'; // Optional: overlay a semi-transparent black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '48px Arial';
    ctx.fillStyle = 'red';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 40);
    ctx.font = '24px Arial';
    ctx.fillStyle = 'white';
    ctx.fillText('Final Score: ' + score, canvas.width / 2, canvas.height / 2);
    ctx.font = '20px Arial';
    ctx.fillText('Press Enter to Play Again', canvas.width / 2, canvas.height / 2 + 40);
}

function drawGameWonScreen() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas
    ctx.fillStyle = '#000'; // Optional: overlay
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '48px Arial';
    ctx.fillStyle = 'green';
    ctx.textAlign = 'center';
    ctx.fillText('YOU WIN!', canvas.width / 2, canvas.height / 2 - 40);
    ctx.font = '24px Arial';
    ctx.fillStyle = 'white';
    ctx.fillText('Final Score: ' + score, canvas.width / 2, canvas.height / 2);
    ctx.font = '20px Arial';
    ctx.fillText('Press Enter to Play Again', canvas.width / 2, canvas.height / 2 + 40);
}

function drawReadyScreenText() {
    if (gameState === GAME_STATE.READY) {
        ctx.font = '20px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText('Press SPACE to Launch', canvas.width / 2, canvas.height / 2 + 80);
    }
}

function updateGame() {
    if (gameState === GAME_STATE.GAME_OVER) {
        drawGameOverScreen();
        requestAnimationFrame(updateGame);
        return;
    }

    if (gameState === GAME_STATE.GAME_WON) {
        drawGameWonScreen();
        requestAnimationFrame(updateGame);
        return;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#222'; // Match CSS background
    ctx.fillRect(0, 0, canvas.width, canvas.height); // Explicitly draw background

    // Draw elements
    drawBricks();
    drawPaddle();
    drawBall(); // Draw ball before text so text is on top
    drawScore();
    drawLives();
    drawReadyScreenText();

    if (gameState === GAME_STATE.READY) {
        ballX = paddleX + paddleWidth / 2;
        ballY = canvas.height - paddleHeight - ballRadius - 1; // Keep ball on paddle
        // Paddle movement is handled by key/mouse handlers if gameState is READY or PLAYING
    } else if (gameState === GAME_STATE.PLAYING) {
        // Collision detection
        collisionDetection();

        // Ball movement
        ballX += ballSpeedX;
        ballY += ballSpeedY;

        // Wall collision (left/right)
        if (ballX + ballSpeedX > canvas.width - ballRadius || ballX + ballSpeedX < ballRadius) {
            ballSpeedX = -ballSpeedX;
        }

        // Wall collision (top)
        if (ballY + ballSpeedY < ballRadius) {
            ballSpeedY = -ballSpeedY;
        }
        // Wall collision (bottom) - Lose a life
        else if (ballY + ballSpeedY > canvas.height - ballRadius) {
            lives--;
            if (!lives) {
                gameState = GAME_STATE.GAME_OVER;
            } else {
                setupBallOnPaddle(); // Reset ball to paddle, state to READY
            }
        }
    }

    // Paddle movement logic (from key presses)
    if (rightPressed && paddleX < canvas.width - paddleWidth) {
        paddleX += paddleSpeed;
    } else if (leftPressed && paddleX > 0) {
        paddleX -= paddleSpeed;
    }

    requestAnimationFrame(updateGame);
}

// Set canvas dimensions (ensure this is done before game loop starts)
canvas.width = 480;
paddleX = (canvas.width - paddleWidth) / 2; // Recalculate paddleX based on new canvas width
ballX = canvas.width / 2; // Recalculate ballX based on new canvas width
brickOffsetLeft = (canvas.width - (brickColumnCount * (brickWidth + brickPadding) - brickPadding)) / 2;
canvas.height = 320;

// Initial setup
paddleX = (canvas.width - paddleWidth) / 2;
brickOffsetLeft = (canvas.width - (brickColumnCount * (brickWidth + brickPadding) - brickPadding)) / 2;

setupBallOnPaddle(); // Set initial ball position and game state

// Start game loop
updateGame();
