class CheckersGame {
    constructor() {
        this.board = document.getElementById('board');
        this.currentTurn = document.getElementById('currentTurn');
        this.resetButton = document.getElementById('reset-button');
        this.selectedPiece = null;
        this.currentPlayer = 'red';
        this.gameBoard = [];
        this.initializeBoard();
        this.setupEventListeners();
    }

    initializeBoard() {
        // Clear the board
        this.board.innerHTML = '';
        this.gameBoard = Array(8)
            .fill()
            .map(() => Array(8).fill(null));

        // Create cells and initial pieces
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cell = document.createElement('div');
                cell.className = `cell ${(row + col) % 2 === 0 ? 'white' : 'black'}`;
                cell.dataset.row = row;
                cell.dataset.col = col;
                this.board.appendChild(cell);

                // Place initial pieces
                if ((row + col) % 2 === 1) {
                    if (row < 3) {
                        this.placePiece(row, col, 'black');
                    } else if (row > 4) {
                        this.placePiece(row, col, 'red');
                    }
                }
            }
        }
    }

    placePiece(row, col, color) {
        const piece = document.createElement('div');
        piece.className = `piece ${color}`;
        this.gameBoard[row][col] = { color, isKing: false };
        this.board.children[row * 8 + col].appendChild(piece);
    }

    setupEventListeners() {
        this.board.addEventListener('click', (e) => {
            const cell = e.target.closest('.cell');
            if (!cell) return;

            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);

            if (this.selectedPiece) {
                this.handleMove(row, col);
            } else {
                this.handleSelection(row, col);
            }
        });

        this.resetButton.addEventListener('click', () => {
            this.resetGame();
        });

        document.getElementById('new-game-btn').addEventListener('click', () => {
            document.getElementById('game-over-modal').classList.remove('active');
            this.resetGame();
        });
    }

    handleSelection(row, col) {
        const piece = this.gameBoard[row][col];
        if (!piece || piece.color !== this.currentPlayer) return;

        this.clearHighlights();
        this.selectedPiece = { row, col };
        this.board.children[row * 8 + col].classList.add('selected');

        // Show valid moves
        this.showValidMoves(row, col);
    }

    handleMove(row, col) {
        const validMoves = this.getValidMoves(this.selectedPiece.row, this.selectedPiece.col);
        const move = validMoves.find((m) => m.row === row && m.col === col);

        if (move) {
            this.movePiece(this.selectedPiece.row, this.selectedPiece.col, row, col);
            if (move.captured) {
                this.removePiece(move.captured.row, move.captured.col);
            }
            this.checkForKing(row, col);
            this.switchPlayer();
        }

        this.clearHighlights();
        this.selectedPiece = null;
    }

    getValidMoves(row, col) {
        const piece = this.gameBoard[row][col];
        const moves = [];
        const directions = piece.isKing
            ? [
                  [-1, -1],
                  [-1, 1],
                  [1, -1],
                  [1, 1],
              ]
            : piece.color === 'red'
            ? [
                  [-1, -1],
                  [-1, 1],
              ]
            : [
                  [1, -1],
                  [1, 1],
              ];

        // Check for jumps
        for (const [dx, dy] of directions) {
            const jumpRow = row + dx * 2;
            const jumpCol = col + dy * 2;
            const middleRow = row + dx;
            const middleCol = col + dy;

            if (
                this.isValidPosition(jumpRow, jumpCol) &&
                this.gameBoard[jumpRow][jumpCol] === null &&
                this.gameBoard[middleRow][middleCol]?.color !== piece.color &&
                this.gameBoard[middleRow][middleCol] !== null
            ) {
                moves.push({
                    row: jumpRow,
                    col: jumpCol,
                    captured: { row: middleRow, col: middleCol },
                });
            }
        }

        // If no jumps available, check for regular moves
        if (moves.length === 0) {
            for (const [dx, dy] of directions) {
                const newRow = row + dx;
                const newCol = col + dy;

                if (this.isValidPosition(newRow, newCol) && this.gameBoard[newRow][newCol] === null) {
                    moves.push({ row: newRow, col: newCol });
                }
            }
        }

        return moves;
    }

    showValidMoves(row, col) {
        const validMoves = this.getValidMoves(row, col);
        for (const move of validMoves) {
            this.board.children[move.row * 8 + move.col].classList.add('valid-move');
        }
    }

    movePiece(fromRow, fromCol, toRow, toCol) {
        const piece = this.gameBoard[fromRow][fromCol];
        this.gameBoard[toRow][toCol] = piece;
        this.gameBoard[fromRow][fromCol] = null;

        const fromCell = this.board.children[fromRow * 8 + fromCol];
        const toCell = this.board.children[toRow * 8 + toCol];
        const pieceElement = fromCell.querySelector('.piece');
        toCell.appendChild(pieceElement);
    }

    removePiece(row, col) {
        this.gameBoard[row][col] = null;
        const cell = this.board.children[row * 8 + col];
        const piece = cell.querySelector('.piece');
        if (piece) piece.remove();
    }

    checkForKing(row, col) {
        const piece = this.gameBoard[row][col];
        if (!piece) return;

        if ((piece.color === 'red' && row === 0) || (piece.color === 'black' && row === 7)) {
            piece.isKing = true;
            const pieceElement = this.board.children[row * 8 + col].querySelector('.piece');
            pieceElement.classList.add('king');
        }
    }

    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 'red' ? 'black' : 'red';
        this.currentTurn.textContent = this.currentPlayer.charAt(0).toUpperCase() + this.currentPlayer.slice(1);
        this.checkGameOver();
    }

    checkGameOver() {
        let redPieces = 0;
        let blackPieces = 0;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.gameBoard[row][col];
                if (piece) {
                    if (piece.color === 'red') redPieces++;
                    else blackPieces++;
                }
            }
        }

        if (redPieces === 0) {
            this.showGameOver('Black');
        } else if (blackPieces === 0) {
            this.showGameOver('Red');
        }
    }

    showGameOver(winner) {
        const modal = document.getElementById('game-over-modal');
        const winnerText = document.getElementById('winner-text');
        winnerText.textContent = `${winner} wins!`;
        modal.classList.add('active');
    }

    resetGame() {
        this.currentPlayer = 'red';
        this.selectedPiece = null;
        this.currentTurn.textContent = 'Red';
        this.initializeBoard();
    }

    clearHighlights() {
        const cells = this.board.getElementsByClassName('cell');
        for (const cell of cells) {
            cell.classList.remove('selected', 'valid-move');
        }
    }

    isValidPosition(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
    }
}

// Initialize the game when the page loads
window.addEventListener('load', () => {
    new CheckersGame();
});
