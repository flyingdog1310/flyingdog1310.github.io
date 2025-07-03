class Gomoku {
    constructor() {
        this.board = Array(15)
            .fill()
            .map(() => Array(15).fill(null));
        this.currentPlayer = 'Black';
        this.gameOver = false;
        this.init();
    }

    init() {
        this.createBoard();
        this.addEventListeners();
        this.updateStatus();
    }

    createBoard() {
        const boardElement = document.getElementById('board');
        boardElement.innerHTML = '';

        for (let i = 0; i < 15; i++) {
            for (let j = 0; j < 15; j++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = i;
                cell.dataset.col = j;
                boardElement.appendChild(cell);
            }
        }
    }

    addEventListeners() {
        const board = document.getElementById('board');
        const restartButton = document.getElementById('restart');

        board.addEventListener('click', (e) => {
            if (!e.target.classList.contains('cell') || this.gameOver) return;

            const row = parseInt(e.target.dataset.row);
            const col = parseInt(e.target.dataset.col);

            if (this.board[row][col] === null) {
                this.makeMove(row, col);
            }
        });

        restartButton.addEventListener('click', () => {
            this.resetGame();
        });
    }

    makeMove(row, col) {
        this.board[row][col] = this.currentPlayer;
        this.placePiece(row, col);

        if (this.checkWin(row, col)) {
            this.gameOver = true;
            this.updateStatus(`Player ${this.currentPlayer} wins!`);
            return;
        }

        this.currentPlayer = this.currentPlayer === 'Black' ? 'White' : 'Black';
        this.updateStatus();
    }

    placePiece(row, col) {
        const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        const piece = document.createElement('div');
        piece.className = `piece ${this.currentPlayer.toLowerCase()}`;
        cell.appendChild(piece);
    }

    checkWin(row, col) {
        const directions = [
            [
                [0, 1],
                [0, -1],
            ], // horizontal
            [
                [1, 0],
                [-1, 0],
            ], // vertical
            [
                [1, 1],
                [-1, -1],
            ], // diagonal
            [
                [1, -1],
                [-1, 1],
            ], // anti-diagonal
        ];

        return directions.some((dir) => {
            const count =
                1 +
                this.countDirection(row, col, dir[0][0], dir[0][1]) +
                this.countDirection(row, col, dir[1][0], dir[1][1]);
            return count >= 5;
        });
    }

    countDirection(row, col, deltaRow, deltaCol) {
        let count = 0;
        let currentRow = row + deltaRow;
        let currentCol = col + deltaCol;

        while (
            currentRow >= 0 &&
            currentRow < 15 &&
            currentCol >= 0 &&
            currentCol < 15 &&
            this.board[currentRow][currentCol] === this.currentPlayer
        ) {
            count++;
            currentRow += deltaRow;
            currentCol += deltaCol;
        }

        return count;
    }

    updateStatus(message) {
        const status = document.getElementById('status');
        status.textContent = message || `Current Player: ${this.currentPlayer}`;
    }

    resetGame() {
        this.board = Array(15)
            .fill()
            .map(() => Array(15).fill(null));
        this.currentPlayer = 'Black';
        this.gameOver = false;
        this.createBoard();
        this.updateStatus();
    }
}

// Initialize the game when the page loads
window.addEventListener('load', () => {
    new Gomoku();
});
