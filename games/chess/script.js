class Chess {
    constructor() {
        this.board = document.getElementById('chessboard');
        this.resetBtn = document.getElementById('resetBtn');
        this.currentTurn = document.getElementById('currentTurn');
        this.modal = document.getElementById('game-over-modal');
        this.winnerText = document.getElementById('winner-text');
        this.newGameBtn = document.getElementById('new-game-btn');
        this.selectedPiece = null;
        this.currentPlayer = 'white';
        this.initializeBoard();
        this.setupEventListeners();
    }

    initializeBoard() {
        // Clear the board
        this.board.innerHTML = '';
        // 正確的棋子符號
        const pieces = {
            white: ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖'],
            black: ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
        };
        // 建立棋盤
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'white' : 'black'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                // 放置棋子
                if (row === 0) {
                    square.textContent = pieces.black[col];
                    square.dataset.piece = pieces.black[col];
                    square.dataset.color = 'black';
                } else if (row === 1) {
                    square.textContent = '♟';
                    square.dataset.piece = '♟';
                    square.dataset.color = 'black';
                } else if (row === 6) {
                    square.textContent = '♙';
                    square.dataset.piece = '♙';
                    square.dataset.color = 'white';
                } else if (row === 7) {
                    square.textContent = pieces.white[col];
                    square.dataset.piece = pieces.white[col];
                    square.dataset.color = 'white';
                }
                this.board.appendChild(square);
            }
        }
    }

    setupEventListeners() {
        this.board.addEventListener('click', (e) => {
            const square = e.target.closest('.square');
            if (!square) return;

            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);
            const piece = square.dataset.piece;
            const color = square.dataset.color;

            // If a piece is already selected
            if (this.selectedPiece) {
                // If clicking the same piece, deselect it
                if (this.selectedPiece === square) {
                    this.deselectPiece();
                    return;
                }

                // If clicking a valid move square
                if (square.classList.contains('valid-move')) {
                    this.movePiece(this.selectedPiece, square);
                    this.deselectPiece();
                    this.switchTurn();
                    return;
                }

                // If clicking another piece of the same color
                if (piece && color === this.currentPlayer) {
                    this.deselectPiece();
                    this.selectPiece(square);
                    return;
                }
            }

            // If no piece is selected and clicking a piece of current player's color
            if (piece && color === this.currentPlayer) {
                this.selectPiece(square);
            }
        });

        this.resetBtn.addEventListener('click', () => this.resetGame());
        this.newGameBtn.addEventListener('click', () => this.resetGame());
    }

    selectPiece(square) {
        this.selectedPiece = square;
        square.classList.add('selected');
        this.showValidMoves(square);
    }

    deselectPiece() {
        if (this.selectedPiece) {
            this.selectedPiece.classList.remove('selected');
            this.clearValidMoves();
            this.selectedPiece = null;
        }
    }

    showValidMoves(square) {
        const row = parseInt(square.dataset.row);
        const col = parseInt(square.dataset.col);
        const piece = square.dataset.piece;
        const color = square.dataset.color;
        const validMoves = this.getValidMoves(row, col, piece, color);
        validMoves.forEach(([r, c]) => {
            const target = document.querySelector(`.square[data-row='${r}'][data-col='${c}']`);
            if (target) target.classList.add('valid-move');
        });
    }

    getValidMoves(row, col, piece, color) {
        const moves = [];
        const isInside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
        const getSquare = (r, c) => document.querySelector(`.square[data-row='${r}'][data-col='${c}']`);
        const enemy = color === 'white' ? 'black' : 'white';
        // Pawn
        if ((piece === '♙' && color === 'white') || (piece === '♟' && color === 'black')) {
            const dir = color === 'white' ? -1 : 1;
            // Forward
            if (isInside(row + dir, col) && !getSquare(row + dir, col).dataset.piece) {
                moves.push([row + dir, col]);
                // First move can go two squares
                if ((color === 'white' && row === 6) || (color === 'black' && row === 1)) {
                    if (!getSquare(row + 2 * dir, col).dataset.piece) {
                        moves.push([row + 2 * dir, col]);
                    }
                }
            }
            // Capture
            for (let dc of [-1, 1]) {
                if (isInside(row + dir, col + dc)) {
                    const target = getSquare(row + dir, col + dc);
                    if (target.dataset.piece && target.dataset.color === enemy) {
                        moves.push([row + dir, col + dc]);
                    }
                }
            }
        }
        // Knight
        else if (piece === '♘' || piece === '♞') {
            const knightMoves = [
                [-2, -1],
                [-2, 1],
                [-1, -2],
                [-1, 2],
                [1, -2],
                [1, 2],
                [2, -1],
                [2, 1],
            ];
            for (let [dr, dc] of knightMoves) {
                const r = row + dr,
                    c = col + dc;
                if (isInside(r, c)) {
                    const target = getSquare(r, c);
                    if (!target.dataset.piece || target.dataset.color === enemy) {
                        moves.push([r, c]);
                    }
                }
            }
        }
        // Rook
        else if (piece === '♖' || piece === '♜') {
            for (let [dr, dc] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                for (let i = 1; i < 8; i++) {
                    const r = row + dr * i,
                        c = col + dc * i;
                    if (!isInside(r, c)) break;
                    const target = getSquare(r, c);
                    if (!target.dataset.piece) {
                        moves.push([r, c]);
                    } else {
                        if (target.dataset.color === enemy) moves.push([r, c]);
                        break;
                    }
                }
            }
        }
        // Bishop
        else if (piece === '♗' || piece === '♝') {
            for (let [dr, dc] of [
                [1, 1],
                [1, -1],
                [-1, 1],
                [-1, -1],
            ]) {
                for (let i = 1; i < 8; i++) {
                    const r = row + dr * i,
                        c = col + dc * i;
                    if (!isInside(r, c)) break;
                    const target = getSquare(r, c);
                    if (!target.dataset.piece) {
                        moves.push([r, c]);
                    } else {
                        if (target.dataset.color === enemy) moves.push([r, c]);
                        break;
                    }
                }
            }
        }
        // Queen
        else if (piece === '♕' || piece === '♛') {
            // Rook moves
            for (let [dr, dc] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                for (let i = 1; i < 8; i++) {
                    const r = row + dr * i,
                        c = col + dc * i;
                    if (!isInside(r, c)) break;
                    const target = getSquare(r, c);
                    if (!target.dataset.piece) {
                        moves.push([r, c]);
                    } else {
                        if (target.dataset.color === enemy) moves.push([r, c]);
                        break;
                    }
                }
            }
            // Bishop moves
            for (let [dr, dc] of [
                [1, 1],
                [1, -1],
                [-1, 1],
                [-1, -1],
            ]) {
                for (let i = 1; i < 8; i++) {
                    const r = row + dr * i,
                        c = col + dc * i;
                    if (!isInside(r, c)) break;
                    const target = getSquare(r, c);
                    if (!target.dataset.piece) {
                        moves.push([r, c]);
                    } else {
                        if (target.dataset.color === enemy) moves.push([r, c]);
                        break;
                    }
                }
            }
        }
        // King
        else if (piece === '♔' || piece === '♚') {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const r = row + dr,
                        c = col + dc;
                    if (isInside(r, c)) {
                        const target = getSquare(r, c);
                        if (!target.dataset.piece || target.dataset.color === enemy) {
                            moves.push([r, c]);
                        }
                    }
                }
            }
        }
        return moves;
    }

    clearValidMoves() {
        document.querySelectorAll('.square').forEach((square) => {
            square.classList.remove('valid-move');
        });
    }

    movePiece(fromSquare, toSquare) {
        // Check if the captured piece is a king
        if (toSquare.dataset.piece === '♔' || toSquare.dataset.piece === '♚') {
            const winner = this.currentPlayer;
            this.showGameOver(winner);
        }

        toSquare.textContent = fromSquare.textContent;
        toSquare.dataset.piece = fromSquare.dataset.piece;
        toSquare.dataset.color = fromSquare.dataset.color;

        fromSquare.textContent = '';
        fromSquare.dataset.piece = '';
        fromSquare.dataset.color = '';
    }

    showGameOver(winner) {
        this.winnerText.textContent = `${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`;
        this.modal.style.display = 'block';
    }

    resetGame() {
        this.initializeBoard();
        this.currentPlayer = 'white';
        this.currentTurn.textContent = 'White';
        this.selectedPiece = null;
        this.modal.style.display = 'none';
    }

    switchTurn() {
        this.currentPlayer = this.currentPlayer === 'white' ? 'black' : 'white';
        this.currentTurn.textContent = this.currentPlayer.charAt(0).toUpperCase() + this.currentPlayer.slice(1);
    }
}

// Initialize the game when the page loads
window.addEventListener('load', () => {
    new Chess();
});
