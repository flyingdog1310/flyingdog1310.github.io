const BOARD_SIZE = 9;
const MINES_COUNT = 10;
let board = [];
let gameOver = false;
let flagMode = false;
let timer = 0;
let timerInterval;
let firstClick = true;

function startNewGame() {
    gameOver = false;
    firstClick = true;
    clearInterval(timerInterval);
    timer = 0;
    document.getElementById('timer').textContent = '0';
    document.getElementById('flags-count').textContent = '0';
    document.getElementById('mines-count').textContent = MINES_COUNT;
    initializeBoard();
    renderBoard();
}

function initializeBoard() {
    board = Array(BOARD_SIZE)
        .fill()
        .map(() =>
            Array(BOARD_SIZE)
                .fill()
                .map(() => ({
                    isMine: false,
                    isRevealed: false,
                    isFlagged: false,
                    neighborMines: 0,
                }))
        );
}

function placeMines(firstRow, firstCol) {
    let minesPlaced = 0;
    while (minesPlaced < MINES_COUNT) {
        const row = Math.floor(Math.random() * BOARD_SIZE);
        const col = Math.floor(Math.random() * BOARD_SIZE);

        // Don't place mine on first click or adjacent cells
        if (Math.abs(row - firstRow) <= 1 && Math.abs(col - firstCol) <= 1) {
            continue;
        }

        if (!board[row][col].isMine) {
            board[row][col].isMine = true;
            minesPlaced++;
        }
    }

    // Calculate neighbor mines
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (!board[row][col].isMine) {
                board[row][col].neighborMines = countNeighborMines(row, col);
            }
        }
    }
}

function countNeighborMines(row, col) {
    let count = 0;
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const newRow = row + i;
            const newCol = col + j;
            if (
                newRow >= 0 &&
                newRow < BOARD_SIZE &&
                newCol >= 0 &&
                newCol < BOARD_SIZE &&
                board[newRow][newCol].isMine
            ) {
                count++;
            }
        }
    }
    return count;
}

function renderBoard() {
    const gameBoard = document.getElementById('game-board');
    gameBoard.innerHTML = '';

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;

            if (board[row][col].isRevealed) {
                cell.classList.add('revealed');
                if (board[row][col].isMine) {
                    cell.classList.add('mine');
                    cell.textContent = '💣';
                } else if (board[row][col].isFlagged) {
                    cell.classList.add('flagged');
                    cell.textContent = '🚩';
                } else if (board[row][col].neighborMines > 0) {
                    cell.textContent = board[row][col].neighborMines;
                    cell.classList.add(`number-${board[row][col].neighborMines}`);
                }
            } else if (board[row][col].isFlagged) {
                cell.classList.add('flagged');
                cell.textContent = '🚩';
            }

            cell.addEventListener('click', () => handleCellClick(row, col));
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                handleCellRightClick(row, col);
            });

            gameBoard.appendChild(cell);
        }
    }
}

function handleCellClick(row, col) {
    if (gameOver) return;

    if (flagMode) {
        // in flag mode, right click is used to toggle flags
        handleCellRightClick(row, col);
        return;
    }

    if (board[row][col].isFlagged) return;

    if (firstClick) {
        firstClick = false;
        placeMines(row, col);
        startTimer();
    }

    if (board[row][col].isMine) {
        gameOver = true;
        revealAllMines();
        clearInterval(timerInterval);
        alert('Game Over!');
        return;
    }

    revealCell(row, col);
    checkWin();
}

function handleCellRightClick(row, col) {
    if (gameOver || board[row][col].isRevealed) return;

    board[row][col].isFlagged = !board[row][col].isFlagged;
    const flagsCount = document.getElementById('flags-count');
    const currentFlags = parseInt(flagsCount.textContent);
    flagsCount.textContent = board[row][col].isFlagged ? currentFlags + 1 : currentFlags - 1;
    renderBoard();
}

function revealCell(row, col) {
    if (
        row < 0 ||
        row >= BOARD_SIZE ||
        col < 0 ||
        col >= BOARD_SIZE ||
        board[row][col].isRevealed ||
        board[row][col].isFlagged
    ) {
        return;
    }

    board[row][col].isRevealed = true;

    if (board[row][col].neighborMines === 0) {
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                revealCell(row + i, col + j);
            }
        }
    }

    renderBoard();
}

function revealAllMines() {
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (board[row][col].isMine) {
                board[row][col].isRevealed = true;
            }
        }
    }
    renderBoard();
}

function checkWin() {
    let unrevealedCount = 0;
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (!board[row][col].isRevealed && !board[row][col].isMine) {
                unrevealedCount++;
            }
        }
    }
    if (unrevealedCount === 0) {
        gameOver = true;
        clearInterval(timerInterval);
        alert('Congratulations! You won!');
    }
}

function startTimer() {
    timerInterval = setInterval(() => {
        timer++;
        document.getElementById('timer').textContent = timer;
    }, 1000);
}

function toggleFlagMode() {
    flagMode = !flagMode;
    document.getElementById('flag-mode').textContent = `Flag Mode: ${flagMode ? 'On' : 'Off'}`;
}

// Initialize the game
startNewGame();
