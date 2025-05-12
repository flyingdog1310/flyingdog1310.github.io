class ConnectFour {
    constructor() {
        this.rows = 6;
        this.cols = 7;
        this.board = Array(this.rows)
            .fill()
            .map(() => Array(this.cols).fill(null));
        this.currentPlayer = 1;
        this.gameOver = false;
        this.initializeBoard();
        this.setupEventListeners();
    }

    initializeBoard() {
        const gameBoard = document.getElementById('game-board');
        gameBoard.innerHTML = '';

        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                gameBoard.appendChild(cell);
            }
        }
    }

    setupEventListeners() {
        const gameBoard = document.getElementById('game-board');
        const resetButton = document.getElementById('reset-button');

        gameBoard.addEventListener('click', (e) => {
            if (!e.target.classList.contains('cell') || this.gameOver) return;

            const col = parseInt(e.target.dataset.col);
            this.makeMove(col);
        });

        resetButton.addEventListener('click', () => {
            this.resetGame();
        });
    }

    makeMove(col) {
        if (this.gameOver) return;

        const row = this.getLowestEmptyRow(col);
        if (row === -1) return;

        this.board[row][col] = this.currentPlayer;
        const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        cell.classList.add(this.currentPlayer === 1 ? 'red' : 'yellow');

        if (this.checkWin(row, col)) {
            document.getElementById('status').textContent = `Player ${this.currentPlayer} wins!`;
            this.gameOver = true;
            return;
        }

        if (this.checkDraw()) {
            document.getElementById('status').textContent = "It's a draw!";
            this.gameOver = true;
            return;
        }

        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        document.getElementById('status').textContent = `Player ${this.currentPlayer}'s turn (${
            this.currentPlayer === 1 ? 'Red' : 'Yellow'
        })`;
    }

    getLowestEmptyRow(col) {
        for (let row = this.rows - 1; row >= 0; row--) {
            if (this.board[row][col] === null) {
                return row;
            }
        }
        return -1;
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
            ], // diagonal /
            [
                [1, -1],
                [-1, 1],
            ], // diagonal \
        ];

        return directions.some((dir) => {
            const count =
                1 +
                this.countDirection(row, col, dir[0][0], dir[0][1]) +
                this.countDirection(row, col, dir[1][0], dir[1][1]);
            return count >= 4;
        });
    }

    countDirection(row, col, deltaRow, deltaCol) {
        let count = 0;
        let currentRow = row + deltaRow;
        let currentCol = col + deltaCol;

        while (
            currentRow >= 0 &&
            currentRow < this.rows &&
            currentCol >= 0 &&
            currentCol < this.cols &&
            this.board[currentRow][currentCol] === this.currentPlayer
        ) {
            count++;
            currentRow += deltaRow;
            currentCol += deltaCol;
        }

        return count;
    }

    checkDraw() {
        return this.board[0].every((cell) => cell !== null);
    }

    resetGame() {
        this.board = Array(this.rows)
            .fill()
            .map(() => Array(this.cols).fill(null));
        this.currentPlayer = 1;
        this.gameOver = false;
        this.initializeBoard();
        document.getElementById('status').textContent = "Player 1's turn (Red)";
    }
}

// Initialize the game
const game = new ConnectFour();
