// Reversi game logic will go here

document.addEventListener('DOMContentLoaded', () => {
    const boardElement = document.getElementById('board');
    const statusElement = document.getElementById('status');
    const blackScoreElement = document.getElementById('black-score');
    const whiteScoreElement = document.getElementById('white-score');
    const restartButton = document.getElementById('restart');

    const BOARD_SIZE = 8;
    let board = []; // 0: empty, 1: black, 2: white
    let currentPlayer = 1; // 1: black, 2: white
    let validMoves = [];
    let gameOver = false; // Game state flag

    // Initialize board array
    function initializeBoardArray() {
        board = Array(BOARD_SIZE)
            .fill(null)
            .map(() => Array(BOARD_SIZE).fill(0));
        board[3][3] = 2; // White
        board[3][4] = 1; // Black
        board[4][3] = 1; // Black
        board[4][4] = 2; // White
        currentPlayer = 1; // Black starts
        gameOver = false;
    }

    // Render board in HTML
    function renderBoard() {
        boardElement.innerHTML = '';
        if (!gameOver) {
            findValidMoves(); // Find valid moves for the current player
        }

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.dataset.row = r;
                cell.dataset.col = c;

                const disc = document.createElement('div');
                disc.classList.add('disc');

                if (board[r][c] === 1) {
                    cell.classList.add('black');
                    cell.appendChild(disc);
                } else if (board[r][c] === 2) {
                    cell.classList.add('white');
                    cell.appendChild(disc);
                } else if (!gameOver) {
                    // Check if this empty cell is a valid move for the current player
                    if (validMoves.some((move) => move.row === r && move.col === c)) {
                        cell.classList.add('valid-move');
                    }
                }
                // Add click listener only if game is not over
                if (!gameOver) {
                    cell.addEventListener('click', () => handleCellClick(r, c));
                }
                boardElement.appendChild(cell);
            }
        }
        updateScores();
        updatePlayerTurnDisplay();
    }

    function updateScores() {
        let blackScore = 0;
        let whiteScore = 0;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] === 1) blackScore++;
                else if (board[r][c] === 2) whiteScore++;
            }
        }
        blackScoreElement.textContent = 'Black: ' + blackScore;
        whiteScoreElement.textContent = 'White: ' + whiteScore;
    }

    function updatePlayerTurnDisplay() {
        if (gameOver) {
            const black = parseInt(blackScoreElement.textContent);
            const white = parseInt(whiteScoreElement.textContent);
            let message = 'Game Over! ';
            if (black > white) message += 'Black wins!';
            else if (white > black) message += 'White wins!';
            else message += "It's a Tie!";
            statusElement.textContent = message;
            statusElement.style.color = '#ff4444';
        } else {
            statusElement.textContent = `Current Player: ${currentPlayer === 1 ? 'Black' : 'White'}`;
            statusElement.style.color = '#538d4e';
        }
    }

    function isValidMoveDirection(row, col, dr, dc, player) {
        const opponent = player === 1 ? 2 : 1;
        let r = row + dr;
        let c = col + dc;
        let hasOpponentPiece = false;

        while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            if (board[r][c] === 0) return false; // Empty cell encountered
            if (board[r][c] === opponent) {
                hasOpponentPiece = true;
            } else if (board[r][c] === player) {
                return hasOpponentPiece; // Found a bracketing piece
            }
            r += dr;
            c += dc;
        }
        return false; // Edge of board reached or no bracketing piece found
    }

    // New helper function to check if a player has any valid moves
    // Does not modify global validMoves array
    function checkPlayerHasMoves(player) {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] === 0) {
                    // Only check empty cells
                    const directions = [
                        [-1, -1],
                        [-1, 0],
                        [-1, 1],
                        [0, -1],
                        [0, 1],
                        [1, -1],
                        [1, 0],
                        [1, 1],
                    ];
                    for (const [dr, dc] of directions) {
                        if (isValidMoveDirection(r, c, dr, dc, player)) {
                            return true; // Found at least one valid move
                        }
                    }
                }
            }
        }
        return false; // No valid moves found for this player
    }

    // Finds and stores valid moves for the CURRENT player
    function findValidMoves() {
        validMoves = [];
        // No isGameOver check here to prevent recursion
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] === 0) {
                    // Only check empty cells
                    const directions = [
                        [-1, -1],
                        [-1, 0],
                        [-1, 1],
                        [0, -1],
                        [0, 1],
                        [1, -1],
                        [1, 0],
                        [1, 1],
                    ];
                    let moveIsValidForCell = false;
                    for (const [dr, dc] of directions) {
                        if (isValidMoveDirection(r, c, dr, dc, currentPlayer)) {
                            moveIsValidForCell = true;
                            break;
                        }
                    }
                    if (moveIsValidForCell) {
                        validMoves.push({ row: r, col: c });
                    }
                }
            }
        }
    }

    function getDiscsToFlip(row, col, player) {
        const opponent = player === 1 ? 2 : 1;
        const directions = [
            [-1, -1],
            [-1, 0],
            [-1, 1],
            [0, -1],
            [0, 1],
            [1, -1],
            [1, 0],
            [1, 1],
        ];
        let discsToFlip = [];

        for (const [dr, dc] of directions) {
            let currentLineFlips = [];
            let r = row + dr;
            let c = col + dc;

            while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
                if (board[r][c] === opponent) {
                    currentLineFlips.push({ row: r, col: c });
                } else if (board[r][c] === player) {
                    discsToFlip = discsToFlip.concat(currentLineFlips);
                    break;
                } else {
                    break;
                }
                r += dr;
                c += dc;
            }
        }
        return discsToFlip;
    }

    function handleCellClick(row, col) {
        if (gameOver || board[row][col] !== 0 || !validMoves.some((move) => move.row === row && move.col === col)) {
            return;
        }

        const discsToFlip = getDiscsToFlip(row, col, currentPlayer);
        // This check should ideally not be needed if validMoves is correct, but as a safeguard:
        if (discsToFlip.length === 0 && board[row][col] === 0) {
            // If it's an empty cell that was marked as a valid move, but somehow no discs flip,
            // it implies an issue with either findValidMoves or getDiscsToFlip logic consistency.
            // For now, we'll proceed assuming validMoves are genuinely valid.
        }

        board[row][col] = currentPlayer;
        discsToFlip.forEach((disc) => {
            board[disc.row][disc.col] = currentPlayer;
        });

        let nextPlayer = currentPlayer === 1 ? 2 : 1;

        // Check if the next player has moves
        if (checkPlayerHasMoves(nextPlayer)) {
            currentPlayer = nextPlayer;
        } else {
            // Next player has no moves, check if current player (who just moved) has more moves
            updatePlayerTurnDisplay(); // Update to show skipped player first
            alert(`No valid moves for ${nextPlayer === 1 ? 'Black' : 'White'}. Turn skipped.`);
            if (checkPlayerHasMoves(currentPlayer)) {
                // Current player (who just moved) gets another turn
                // currentPlayer remains the same
            } else {
                // Neither player has moves - Game Over
                gameOver = true;
            }
        }

        renderBoard(); // Re-render the board with new state
        if (gameOver) {
            updatePlayerTurnDisplay(); // Ensure final game over message is displayed
            alert(`Final Score - Black: ${blackScoreElement.textContent}, White: ${whiteScoreElement.textContent}`);
        }
    }

    // This function can be used if a more explicit game over check is needed elsewhere,
    // but handleCellClick now manages the gameOver state.
    function isBoardGameOver() {
        return !checkPlayerHasMoves(1) && !checkPlayerHasMoves(2);
    }

    // Initialize the game
    function startGame() {
        initializeBoardArray();
        renderBoard();
        restartButton.addEventListener('click', () => {
            startGame();
        });
    }

    startGame();
});

// // Rest of the game logic (flipDiscs, checkGameOver etc.) will be added later
