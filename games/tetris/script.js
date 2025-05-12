// config
const COLS = 10;
const ROWS = 20;
let BLOCK_SIZE = 30;
const COLORS = ['cyan', 'blue', 'orange', 'yellow', 'green', 'purple', 'red'];

// define the shapes
const SHAPES = [
    [[1, 1, 1, 1]], // I
    [
        [1, 1, 1],
        [0, 1, 0],
    ], // T
    [
        [1, 1, 1],
        [1, 0, 0],
    ], // L
    [
        [1, 1, 1],
        [0, 0, 1],
    ], // J
    [
        [1, 1],
        [1, 1],
    ], // O
    [
        [1, 1, 0],
        [0, 1, 1],
    ], // Z
    [
        [0, 1, 1],
        [1, 1, 0],
    ], // S
];

// game state
let canvas;
let ctx;
let board = [];
let currentPiece;
let nextPiece;
let score = 0;
let level = 1;
let gameOver = false;
let isPaused = false;
let dropInterval;
let dropStart;

// 動態縮放 canvas 與 BLOCK_SIZE
function resizeGameBoard() {
    const maxWidth = Math.min(window.innerWidth * 0.95, 400); // 最大寬度 95vw 或 400px
    const maxHeight = Math.min(window.innerHeight * 0.85, 700); // 最大高度 85vh 或 700px
    // 依據格數決定最大可用 block size
    const sizeByWidth = Math.floor(maxWidth / COLS);
    const sizeByHeight = Math.floor(maxHeight / ROWS);
    BLOCK_SIZE = Math.max(16, Math.min(sizeByWidth, sizeByHeight)); // 最小 16px
    const canvasWidth = BLOCK_SIZE * COLS;
    const canvasHeight = BLOCK_SIZE * ROWS;
    const canvas = document.getElementById('game-board');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
}

window.addEventListener('resize', () => {
    resizeGameBoard();
    draw();
});

// initialize the game
function init() {
    canvas = document.getElementById('game-board');
    ctx = canvas.getContext('2d');
    resizeGameBoard(); // 初始化時也縮放

    // initialize the board
    for (let row = 0; row < ROWS; row++) {
        board[row] = new Array(COLS).fill(0);
    }

    // create the first piece
    createNewPiece();
    // start the game loop
    dropStart = Date.now();
    drop();
}

// create a new piece
function createNewPiece() {
    // If nextPiece exists, make it the current piece
    if (nextPiece) {
        currentPiece = {
            shape: nextPiece.shape,
            color: nextPiece.color,
            x: Math.floor(COLS / 2) - Math.floor(nextPiece.shape[0].length / 2),
            y: 0,
        };
    } else {
        // This only happens at game start
        const shapeIndex = Math.floor(Math.random() * SHAPES.length);
        const shape = SHAPES[shapeIndex];
        const color = COLORS[shapeIndex];

        currentPiece = {
            shape: shape,
            color: color,
            x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
            y: 0,
        };
    }

    // Generate the next piece
    const nextShapeIndex = Math.floor(Math.random() * SHAPES.length);
    nextPiece = {
        shape: SHAPES[nextShapeIndex],
        color: COLORS[nextShapeIndex],
    };

    // show the next piece
    drawNextPiece();

    // check if the game is over
    if (collision()) {
        gameOver = true;
        showGameOver();
    }
}

// draw the next piece
function drawNextPiece() {
    const nextPieceDiv = document.getElementById('next-piece');
    nextPieceDiv.innerHTML = '';

    // create a 4x4 empty array
    const gridArray = Array.from({ length: 4 }, () => Array(4).fill(0));
    const shape = nextPiece.shape;
    const color = nextPiece.color;

    // calculate the center start point
    const offsetY = Math.floor((4 - shape.length) / 2);
    const offsetX = Math.floor((4 - shape[0].length) / 2);

    // fill the shape into 4x4
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[0].length; x++) {
            if (shape[y][x]) {
                gridArray[offsetY + y][offsetX + x] = 1;
            }
        }
    }

    // render the 4x4 grid
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            const cellDiv = document.createElement('div');
            if (gridArray[y][x]) {
                cellDiv.style.backgroundColor = color;
                cellDiv.style.boxShadow = 'inset 0 0 5px rgba(255, 255, 255, 0.3)';
            } else {
                cellDiv.style.backgroundColor = 'transparent';
                cellDiv.style.border = '1px solid #222';
            }
            nextPieceDiv.appendChild(cellDiv);
        }
    }
}

// draw the game board
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // draw the fixed blocks
    board.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value) {
                ctx.fillStyle = value;
                ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE - 1, BLOCK_SIZE - 1);
            }
        });
    });

    // draw the current piece
    if (currentPiece) {
        ctx.fillStyle = currentPiece.color;
        currentPiece.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value) {
                    ctx.fillRect(
                        (currentPiece.x + x) * BLOCK_SIZE,
                        (currentPiece.y + y) * BLOCK_SIZE,
                        BLOCK_SIZE - 1,
                        BLOCK_SIZE - 1
                    );
                }
            });
        });
    }
}

// collision detection
function collision() {
    return currentPiece.shape.some((row, y) => {
        return row.some((value, x) => {
            if (!value) return false;
            const newX = currentPiece.x + x;
            const newY = currentPiece.y + y;
            return newX < 0 || newX >= COLS || newY >= ROWS || (newY >= 0 && board[newY][newX]);
        });
    });
}

// lock the piece to the board
function lockPiece() {
    currentPiece.shape.forEach((row, y) => {
        row.forEach((value, x) => {
            if (value) {
                const newY = currentPiece.y + y;
                if (newY >= 0) {
                    board[newY][currentPiece.x + x] = currentPiece.color;
                }
            }
        });
    });
}

// clear the full lines
function clearLines() {
    let linesCleared = 0;

    for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y].every((cell) => cell !== 0)) {
            board.splice(y, 1);
            board.unshift(new Array(COLS).fill(0));
            linesCleared++;
            y++;
        }
    }

    if (linesCleared > 0) {
        // update the score
        score += linesCleared * 100 * level;
        document.getElementById('score').textContent = score;

        // update the level
        if (score >= level * 1000) {
            level++;
            document.getElementById('level').textContent = level;
        }
    }
}

// move the piece
function movePiece(dx, dy) {
    currentPiece.x += dx;
    currentPiece.y += dy;

    if (collision()) {
        currentPiece.x -= dx;
        currentPiece.y -= dy;
        if (dy > 0) {
            lockPiece();
            clearLines();
            createNewPiece();
        }
        return false;
    }
    return true;
}

// rotate the piece
function rotatePiece() {
    const originalShape = currentPiece.shape;
    const rows = originalShape.length;
    const cols = originalShape[0].length;

    // create the new rotated shape
    const rotated = Array(cols)
        .fill()
        .map(() => Array(rows).fill(0));
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            rotated[x][rows - 1 - y] = originalShape[y][x];
        }
    }

    // save the original shape
    currentPiece.shape = rotated;

    // if there is a collision, restore the original shape
    if (collision()) {
        currentPiece.shape = originalShape;
    }
}

// hard drop (drop to the bottom)
function hardDrop() {
    while (movePiece(0, 1)) {}
}

// game main loop
function drop() {
    if (gameOver || isPaused) return;

    const now = Date.now();
    const delta = now - dropStart;

    if (delta > 1000 - (level - 1) * 100) {
        movePiece(0, 1);
        dropStart = now;
    }

    draw();
    requestAnimationFrame(drop);
}

// show the game over screen
function showGameOver() {
    document.getElementById('game-over').style.display = 'block';
    document.getElementById('final-score').textContent = score;
}

// restart the game
function restartGame() {
    // reset the game state
    board = Array(ROWS)
        .fill()
        .map(() => Array(COLS).fill(0));
    score = 0;
    level = 1;
    gameOver = false;
    isPaused = false;

    // update the display
    document.getElementById('score').textContent = '0';
    document.getElementById('level').textContent = '1';
    document.getElementById('game-over').style.display = 'none';

    // restart the game
    createNewPiece();
    dropStart = Date.now();
    drop();
}

// pause/continue the game
function togglePause() {
    isPaused = !isPaused;
    if (!isPaused) {
        dropStart = Date.now();
        drop();
    }
}

// keyboard control
document.addEventListener('keydown', (event) => {
    if (gameOver) return;

    switch (event.keyCode) {
        case 37: // left arrow
            movePiece(-1, 0);
            break;
        case 39: // right arrow
            movePiece(1, 0);
            break;
        case 40: // down arrow
            movePiece(0, 1);
            break;
        case 38: // up arrow
            rotatePiece();
            break;
        case 32: // space
            hardDrop();
            break;
        case 80: // P key
            togglePause();
            break;
    }
});

// start the game
init();
