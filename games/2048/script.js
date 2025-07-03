// Game Config
const GRID_SIZE = 4;
const GRID_PADDING = 15;
const ANIMATION_DURATION = 150;

class Game2048 {
    constructor() {
        this.grid = [];
        this.score = 0;
        this.bestScore = localStorage.getItem('bestScore') || 0;
        this.gameOver = false;
        this.isAnimating = false;
        this.tiles = [];
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeGame();
    }

    initializeElements() {
        this.gridContainer = document.querySelector('.grid');
        this.scoreDisplay = document.getElementById('score');
        this.bestScoreDisplay = document.getElementById('best-score');
        this.gameOverDisplay = document.getElementById('game-over');
        this.finalScoreDisplay = document.getElementById('final-score');
        this.restartBtn = document.getElementById('restart-btn');
        this.playAgainBtn = document.getElementById('play-again-btn');
    }

    setupEventListeners() {
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            switch(e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.move('up');
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.move('down');
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.move('left');
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.move('right');
                    break;
            }
        });

        // Touch controls
        let touchStartX, touchStartY;
        document.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        });

        document.addEventListener('touchend', (e) => {
            if (!touchStartX || !touchStartY) return;

            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;

            const dx = touchEndX - touchStartX;
            const dy = touchEndY - touchStartY;

            if (Math.abs(dx) > Math.abs(dy)) {
                if (dx > 0) this.move('right');
                else this.move('left');
            } else {
                if (dy > 0) this.move('down');
                else this.move('up');
            }
        });

        // Restart button
        this.restartBtn.addEventListener('click', () => this.restartGame());
        this.playAgainBtn.addEventListener('click', () => this.restartGame());
    }

    initializeGame() {
        // Create Initial Grid
        for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
            this.grid[i] = 0;
        }

        // Add Two Initial Tiles
        this.addRandomTile();
        this.addRandomTile();

        // Update Display
        this.updateDisplay();
    }

    addRandomTile() {
        const emptyCells = this.grid.reduce((acc, cell, index) => {
            if (cell === 0) acc.push(index);
            return acc;
        }, []);

        if (emptyCells.length > 0) {
            const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
            this.grid[randomCell] = Math.random() < 0.9 ? 2 : 4;
        }
    }

    updateDisplay() {
        // Get All Cells
        const cells = document.querySelectorAll('.cell');
        // Clear All Cell Content
        cells.forEach((cell) => (cell.innerHTML = ''));
        this.tiles = [];

        // Update Score
        this.scoreDisplay.textContent = this.score;
        this.bestScoreDisplay.textContent = this.bestScore;

        // Insert Tiles Based on Grid State
        this.grid.forEach((value, index) => {
            if (value !== 0) {
                const tile = document.createElement('div');
                tile.className = `tile tile-${value}`;
                tile.textContent = value;
                cells[index].appendChild(tile);
                this.tiles.push(tile);
            }
        });
    }

    async move(direction) {
        if (this.gameOver || this.isAnimating) return;

        let moved = false;

        // Process Movement Based on Direction
        switch (direction) {
            case 'up':
                moved = this.moveUp();
                break;
            case 'down':
                moved = this.moveDown();
                break;
            case 'left':
                moved = this.moveLeft();
                break;
            case 'right':
                moved = this.moveRight();
                break;
        }

        // If Movement Occurred, Add New Tile
        if (moved) {
            this.isAnimating = true;

            // Update All Tiles Position
            this.updateDisplay();

            // Wait for Animation to Complete
            await new Promise((resolve) => setTimeout(resolve, ANIMATION_DURATION));

            this.addRandomTile();
            this.updateDisplay();

            // Check if Game is Over
            if (this.isGameOver()) {
                this.gameOver = true;
                this.finalScoreDisplay.textContent = this.score;
                this.gameOverDisplay.classList.add('active');
            }

            this.isAnimating = false;
        }
    }

    moveUp() {
        let moved = false;
        for (let col = 0; col < GRID_SIZE; col++) {
            for (let row = 1; row < GRID_SIZE; row++) {
                const index = row * GRID_SIZE + col;
                if (this.grid[index] !== 0) {
                    let currentRow = row;
                    while (currentRow > 0) {
                        const currentIndex = currentRow * GRID_SIZE + col;
                        const prevIndex = (currentRow - 1) * GRID_SIZE + col;

                        if (this.grid[prevIndex] === 0) {
                            this.grid[prevIndex] = this.grid[currentIndex];
                            this.grid[currentIndex] = 0;
                            currentRow--;
                            moved = true;
                        } else if (this.grid[prevIndex] === this.grid[currentIndex]) {
                            this.grid[prevIndex] *= 2;
                            this.grid[currentIndex] = 0;
                            this.score += this.grid[prevIndex];
                            if (this.score > this.bestScore) {
                                this.bestScore = this.score;
                                localStorage.setItem('bestScore', this.bestScore);
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

    moveDown() {
        let moved = false;
        for (let col = 0; col < GRID_SIZE; col++) {
            for (let row = GRID_SIZE - 2; row >= 0; row--) {
                const index = row * GRID_SIZE + col;
                if (this.grid[index] !== 0) {
                    let currentRow = row;
                    while (currentRow < GRID_SIZE - 1) {
                        const currentIndex = currentRow * GRID_SIZE + col;
                        const nextIndex = (currentRow + 1) * GRID_SIZE + col;

                        if (this.grid[nextIndex] === 0) {
                            this.grid[nextIndex] = this.grid[currentIndex];
                            this.grid[currentIndex] = 0;
                            currentRow++;
                            moved = true;
                        } else if (this.grid[nextIndex] === this.grid[currentIndex]) {
                            this.grid[nextIndex] *= 2;
                            this.grid[currentIndex] = 0;
                            this.score += this.grid[nextIndex];
                            if (this.score > this.bestScore) {
                                this.bestScore = this.score;
                                localStorage.setItem('bestScore', this.bestScore);
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

    moveLeft() {
        let moved = false;
        for (let row = 0; row < GRID_SIZE; row++) {
            for (let col = 1; col < GRID_SIZE; col++) {
                const index = row * GRID_SIZE + col;
                if (this.grid[index] !== 0) {
                    let currentCol = col;
                    while (currentCol > 0) {
                        const currentIndex = row * GRID_SIZE + currentCol;
                        const prevIndex = row * GRID_SIZE + (currentCol - 1);

                        if (this.grid[prevIndex] === 0) {
                            this.grid[prevIndex] = this.grid[currentIndex];
                            this.grid[currentIndex] = 0;
                            currentCol--;
                            moved = true;
                        } else if (this.grid[prevIndex] === this.grid[currentIndex]) {
                            this.grid[prevIndex] *= 2;
                            this.grid[currentIndex] = 0;
                            this.score += this.grid[prevIndex];
                            if (this.score > this.bestScore) {
                                this.bestScore = this.score;
                                localStorage.setItem('bestScore', this.bestScore);
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

    moveRight() {
        let moved = false;
        for (let row = 0; row < GRID_SIZE; row++) {
            for (let col = GRID_SIZE - 2; col >= 0; col--) {
                const index = row * GRID_SIZE + col;
                if (this.grid[index] !== 0) {
                    let currentCol = col;
                    while (currentCol < GRID_SIZE - 1) {
                        const currentIndex = row * GRID_SIZE + currentCol;
                        const nextIndex = row * GRID_SIZE + (currentCol + 1);

                        if (this.grid[nextIndex] === 0) {
                            this.grid[nextIndex] = this.grid[currentIndex];
                            this.grid[currentIndex] = 0;
                            currentCol++;
                            moved = true;
                        } else if (this.grid[nextIndex] === this.grid[currentIndex]) {
                            this.grid[nextIndex] *= 2;
                            this.grid[currentIndex] = 0;
                            this.score += this.grid[nextIndex];
                            if (this.score > this.bestScore) {
                                this.bestScore = this.score;
                                localStorage.setItem('bestScore', this.bestScore);
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

    isGameOver() {
        // Check for empty cells
        if (this.grid.includes(0)) return false;

        // Check for possible merges
        for (let row = 0; row < GRID_SIZE; row++) {
            for (let col = 0; col < GRID_SIZE; col++) {
                const current = this.grid[row * GRID_SIZE + col];
                
                // Check right neighbor
                if (col < GRID_SIZE - 1 && current === this.grid[row * GRID_SIZE + (col + 1)]) {
                    return false;
                }
                
                // Check bottom neighbor
                if (row < GRID_SIZE - 1 && current === this.grid[(row + 1) * GRID_SIZE + col]) {
                    return false;
                }
            }
        }

        return true;
    }

    restartGame() {
        this.grid = [];
        this.score = 0;
        this.gameOver = false;
        this.isAnimating = false;
        this.tiles = [];
        this.gameOverDisplay.classList.remove('active');
        this.initializeGame();
    }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new Game2048();
});
