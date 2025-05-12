// Game Config
const GRID_SIZE = 4;
const CELL_SIZE = 80;
const CELL_GAP = 15;
const GRID_PADDING = 15;
const ANIMATION_DURATION = 150;

// Game State
let grid = [];
let score = 0;
let bestScore = localStorage.getItem('bestScore') || 0;
let gameOver = false;
let isAnimating = false;
let tiles = [];

// DOM Elements
const gridContainer = document.querySelector('.grid');
const scoreDisplay = document.getElementById('score');
const bestScoreDisplay = document.getElementById('best-score');
const gameOverDisplay = document.querySelector('.game-over');

// Initialize Game
function initGame() {
    // Create Initial Grid
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        grid[i] = 0;
    }

    // Add Two Initial Tiles
    addRandomTile();
    addRandomTile();

    // Update Display
    updateDisplay();
}

// Add Random Tile
function addRandomTile() {
    const emptyCells = grid.reduce((acc, cell, index) => {
        if (cell === 0) acc.push(index);
        return acc;
    }, []);

    if (emptyCells.length > 0) {
        const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        grid[randomCell] = Math.random() < 0.9 ? 2 : 4;
    }
}

// Update Display
function updateDisplay() {
    // Get All Cells
    const cells = document.querySelectorAll('.cell');
    // Clear All Cell Content
    cells.forEach((cell) => (cell.innerHTML = ''));
    tiles = [];

    // Update Score
    scoreDisplay.textContent = score;
    bestScoreDisplay.textContent = bestScore;

    // Insert Tiles Based on Grid State
    grid.forEach((value, index) => {
        if (value !== 0) {
            const tile = document.createElement('div');
            tile.className = `tile tile-${value}`;
            tile.textContent = value;
            cells[index].appendChild(tile);
            tiles.push(tile);
        }
    });
}

// Move Tiles
async function move(direction) {
    if (gameOver || isAnimating) return;

    let moved = false;
    const oldGrid = [...grid];
    const oldTiles = [...tiles];

    // Process Movement Based on Direction
    switch (direction) {
        case 'up':
            moved = moveUp();
            break;
        case 'down':
            moved = moveDown();
            break;
        case 'left':
            moved = moveLeft();
            break;
        case 'right':
            moved = moveRight();
            break;
    }

    // If Movement Occurred, Add New Tile
    if (moved) {
        isAnimating = true;

        // Update All Tiles Position
        updateDisplay();

        // Wait for Animation to Complete
        await new Promise((resolve) => setTimeout(resolve, ANIMATION_DURATION));

        addRandomTile();
        updateDisplay();

        // Check if Game is Over
        if (isGameOver()) {
            gameOver = true;
            gameOverDisplay.style.display = 'flex';
        }

        isAnimating = false;
    }
}

// Move Up
function moveUp() {
    let moved = false;
    for (let col = 0; col < GRID_SIZE; col++) {
        for (let row = 1; row < GRID_SIZE; row++) {
            const index = row * GRID_SIZE + col;
            if (grid[index] !== 0) {
                let currentRow = row;
                while (currentRow > 0) {
                    const currentIndex = currentRow * GRID_SIZE + col;
                    const prevIndex = (currentRow - 1) * GRID_SIZE + col;

                    if (grid[prevIndex] === 0) {
                        grid[prevIndex] = grid[currentIndex];
                        grid[currentIndex] = 0;
                        currentRow--;
                        moved = true;
                    } else if (grid[prevIndex] === grid[currentIndex]) {
                        grid[prevIndex] *= 2;
                        grid[currentIndex] = 0;
                        score += grid[prevIndex];
                        if (score > bestScore) {
                            bestScore = score;
                            localStorage.setItem('bestScore', bestScore);
                        }
                        moved = true;
                        break;
                    } else {
                        break;
                    }
                }
            }
        }
    }
    return moved;
}

// Move Down
function moveDown() {
    let moved = false;
    for (let col = 0; col < GRID_SIZE; col++) {
        for (let row = GRID_SIZE - 2; row >= 0; row--) {
            const index = row * GRID_SIZE + col;
            if (grid[index] !== 0) {
                let currentRow = row;
                while (currentRow < GRID_SIZE - 1) {
                    const currentIndex = currentRow * GRID_SIZE + col;
                    const nextIndex = (currentRow + 1) * GRID_SIZE + col;

                    if (grid[nextIndex] === 0) {
                        grid[nextIndex] = grid[currentIndex];
                        grid[currentIndex] = 0;
                        currentRow++;
                        moved = true;
                    } else if (grid[nextIndex] === grid[currentIndex]) {
                        grid[nextIndex] *= 2;
                        grid[currentIndex] = 0;
                        score += grid[nextIndex];
                        if (score > bestScore) {
                            bestScore = score;
                            localStorage.setItem('bestScore', bestScore);
                        }
                        moved = true;
                        break;
                    } else {
                        break;
                    }
                }
            }
        }
    }
    return moved;
}

// Move Left
function moveLeft() {
    let moved = false;
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 1; col < GRID_SIZE; col++) {
            const index = row * GRID_SIZE + col;
            if (grid[index] !== 0) {
                let currentCol = col;
                while (currentCol > 0) {
                    const currentIndex = row * GRID_SIZE + currentCol;
                    const prevIndex = row * GRID_SIZE + (currentCol - 1);

                    if (grid[prevIndex] === 0) {
                        grid[prevIndex] = grid[currentIndex];
                        grid[currentIndex] = 0;
                        currentCol--;
                        moved = true;
                    } else if (grid[prevIndex] === grid[currentIndex]) {
                        grid[prevIndex] *= 2;
                        grid[currentIndex] = 0;
                        score += grid[prevIndex];
                        if (score > bestScore) {
                            bestScore = score;
                            localStorage.setItem('bestScore', bestScore);
                        }
                        moved = true;
                        break;
                    } else {
                        break;
                    }
                }
            }
        }
    }
    return moved;
}

// Move Right
function moveRight() {
    let moved = false;
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = GRID_SIZE - 2; col >= 0; col--) {
            const index = row * GRID_SIZE + col;
            if (grid[index] !== 0) {
                let currentCol = col;
                while (currentCol < GRID_SIZE - 1) {
                    const currentIndex = row * GRID_SIZE + currentCol;
                    const nextIndex = row * GRID_SIZE + (currentCol + 1);

                    if (grid[nextIndex] === 0) {
                        grid[nextIndex] = grid[currentIndex];
                        grid[currentIndex] = 0;
                        currentCol++;
                        moved = true;
                    } else if (grid[nextIndex] === grid[currentIndex]) {
                        grid[nextIndex] *= 2;
                        grid[currentIndex] = 0;
                        score += grid[nextIndex];
                        if (score > bestScore) {
                            bestScore = score;
                            localStorage.setItem('bestScore', bestScore);
                        }
                        moved = true;
                        break;
                    } else {
                        break;
                    }
                }
            }
        }
    }
    return moved;
}

// Check if Game is Over
function isGameOver() {
    // Check if There is an Empty Cell
    if (grid.includes(0)) return false;

    // Check if There is a Neighbor with the Same Number
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const current = grid[row * GRID_SIZE + col];

            // Check Right Neighbor
            if (col < GRID_SIZE - 1 && current === grid[row * GRID_SIZE + (col + 1)]) {
                return false;
            }

            // Check Bottom Neighbor
            if (row < GRID_SIZE - 1 && current === grid[(row + 1) * GRID_SIZE + col]) {
                return false;
            }
        }
    }

    return true;
}

// Restart Game
function restartGame() {
    grid = [];
    score = 0;
    gameOver = false;
    gameOverDisplay.style.display = 'none';
    initGame();
}

// Keyboard Control
document.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'ArrowUp':
            event.preventDefault();
            move('up');
            break;
        case 'ArrowDown':
            event.preventDefault();
            move('down');
            break;
        case 'ArrowLeft':
            event.preventDefault();
            move('left');
            break;
        case 'ArrowRight':
            event.preventDefault();
            move('right');
            break;
    }
});

// Touch Control
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', (event) => {
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
});

document.addEventListener('touchend', (event) => {
    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;

    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    if (Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX > 0) {
            move('right');
        } else {
            move('left');
        }
    } else {
        if (diffY > 0) {
            move('down');
        } else {
            move('up');
        }
    }
});

// Initialize Game
initGame();
