class ChineseChess {
    constructor() {
        this.board = document.getElementById('game-board');
        this.selectedPiece = null;
        this.currentPlayer = 'red';
        this.pieces = [];
        this.cellSize = 0;
        this.modal = document.getElementById('game-over-modal');
        this.winnerText = document.getElementById('winner-text');
        this.initializeBoard();
        this.initializePieces();
        this.addBoardClickListener();
        window.addEventListener('resize', () => this.handleResize());
    }

    getCellSize() {
        return this.board.clientWidth / 8;
    }

    handleResize() {
        this.cellSize = this.getCellSize();
        this.updatePiecesPosition();
    }

    updatePiecesPosition() {
        this.pieces.forEach((piece) => {
            const x = parseInt(piece.dataset.x);
            const y = parseInt(piece.dataset.y);
            piece.style.left = `${x * this.cellSize}px`;
            piece.style.top = `${y * this.cellSize}px`;
        });
    }

    initializeBoard() {
        this.cellSize = this.getCellSize();
        // render horizontal lines
        for (let i = 0; i <= 9; i++) {
            const line = document.createElement('div');
            line.className = 'grid-line horizontal' + (i === 9 ? ' bottom' : '');
            line.style.top = i !== 9 ? `${i * this.cellSize}px` : '';
            this.board.appendChild(line);
        }

        // render vertical lines
        for (let i = 0; i <= 8; i++) {
            const line = document.createElement('div');
            line.className = 'grid-line vertical' + (i === 8 ? ' right' : '');
            line.style.left = i !== 8 ? `${i * this.cellSize}px` : '';
            this.board.appendChild(line);
        }
    }

    initializePieces() {
        const initialPositions = {
            red: [
                { type: '車', x: 0, y: 9 },
                { type: '馬', x: 1, y: 9 },
                { type: '相', x: 2, y: 9 },
                { type: '仕', x: 3, y: 9 },
                { type: '帥', x: 4, y: 9 },
                { type: '仕', x: 5, y: 9 },
                { type: '相', x: 6, y: 9 },
                { type: '馬', x: 7, y: 9 },
                { type: '車', x: 8, y: 9 },
                { type: '炮', x: 1, y: 7 },
                { type: '炮', x: 7, y: 7 },
                { type: '兵', x: 0, y: 6 },
                { type: '兵', x: 2, y: 6 },
                { type: '兵', x: 4, y: 6 },
                { type: '兵', x: 6, y: 6 },
                { type: '兵', x: 8, y: 6 },
            ],
            black: [
                { type: '車', x: 0, y: 0 },
                { type: '馬', x: 1, y: 0 },
                { type: '象', x: 2, y: 0 },
                { type: '士', x: 3, y: 0 },
                { type: '將', x: 4, y: 0 },
                { type: '士', x: 5, y: 0 },
                { type: '象', x: 6, y: 0 },
                { type: '馬', x: 7, y: 0 },
                { type: '車', x: 8, y: 0 },
                { type: '炮', x: 1, y: 2 },
                { type: '炮', x: 7, y: 2 },
                { type: '卒', x: 0, y: 3 },
                { type: '卒', x: 2, y: 3 },
                { type: '卒', x: 4, y: 3 },
                { type: '卒', x: 6, y: 3 },
                { type: '卒', x: 8, y: 3 },
            ],
        };

        for (const color in initialPositions) {
            initialPositions[color].forEach((pos) => {
                this.createPiece(pos.type, pos.x, pos.y, color);
            });
        }
    }

    createPiece(type, x, y, color) {
        const piece = document.createElement('div');
        piece.className = `piece ${color}`;
        piece.textContent = type;
        piece.style.left = `${x * this.cellSize}px`;
        piece.style.top = `${y * this.cellSize}px`;
        piece.dataset.x = x;
        piece.dataset.y = y;
        piece.dataset.color = color;
        piece.dataset.type = type;

        piece.addEventListener('click', () => this.handlePieceClick(piece));
        this.board.appendChild(piece);
        this.pieces.push(piece);
    }

    addBoardClickListener() {
        this.board.addEventListener('click', (event) => {
            if (event.target.classList.contains('piece')) {
                return;
            }

            if (!this.selectedPiece) {
                return;
            }

            const rect = this.board.getBoundingClientRect();
            const x = Math.round((event.clientX - rect.left) / this.cellSize);
            const y = Math.round((event.clientY - rect.top) / this.cellSize);

            if (this.isValidMove(this.selectedPiece, x, y)) {
                this.selectedPiece.style.left = `${x * this.cellSize}px`;
                this.selectedPiece.style.top = `${y * this.cellSize}px`;
                this.selectedPiece.dataset.x = x;
                this.selectedPiece.dataset.y = y;
                this.selectedPiece.classList.remove('selected');

                this.selectedPiece = null;
                this.currentPlayer = this.currentPlayer === 'red' ? 'black' : 'red';
            } else {
                this.selectedPiece.classList.remove('selected');
                this.selectedPiece = null;
            }
        });
    }

    handlePieceClick(piece) {
        if (this.selectedPiece) {
            if (this.selectedPiece === piece) {
                // unselect the piece
                this.selectedPiece.classList.remove('selected');
                this.selectedPiece = null;
            } else if (piece.dataset.color === this.currentPlayer) {
                // select the new piece
                this.selectedPiece.classList.remove('selected');
                piece.classList.add('selected');
                this.selectedPiece = piece;
            } else {
                // try to move to the opponent's piece position
                const fromX = parseInt(this.selectedPiece.dataset.x);
                const fromY = parseInt(this.selectedPiece.dataset.y);
                const toX = parseInt(piece.dataset.x);
                const toY = parseInt(piece.dataset.y);

                if (this.isValidMove(this.selectedPiece, toX, toY)) {
                    this.movePiece(this.selectedPiece, piece);
                } else {
                    // if the move is invalid, unselect the piece
                    this.selectedPiece.classList.remove('selected');
                    this.selectedPiece = null;
                }
            }
        } else if (piece.dataset.color === this.currentPlayer) {
            // select the piece
            piece.classList.add('selected');
            this.selectedPiece = piece;
        }
    }

    isValidMove(piece, toX, toY) {
        const fromX = parseInt(piece.dataset.x);
        const fromY = parseInt(piece.dataset.y);
        const type = piece.dataset.type;
        const color = piece.dataset.color;

        // check if the target position has a piece of the same color
        const targetPiece = this.getPieceAt(toX, toY);
        if (targetPiece && targetPiece.dataset.color === color) {
            return false;
        }

        switch (type) {
            case '帥':
            case '將':
                // 將帥can only move one step in the palace
                if (color === 'red') {
                    if (toX < 3 || toX > 5 || toY < 7 || toY > 9) return false;
                } else {
                    if (toX < 3 || toX > 5 || toY > 2 || toY < 0) return false;
                }
                return Math.abs(toX - fromX) + Math.abs(toY - fromY) === 1;

            case '仕':
            case '士':
                // 士can only move one step in the palace
                if (color === 'red') {
                    if (toX < 3 || toX > 5 || toY < 7 || toY > 9) return false;
                } else {
                    if (toX < 3 || toX > 5 || toY > 2 || toY < 0) return false;
                }
                return Math.abs(toX - fromX) === 1 && Math.abs(toY - fromY) === 1;

            case '相':
            case '象':
                // 相象can only move in a square
                if (Math.abs(toX - fromX) !== 2 || Math.abs(toY - fromY) !== 2) return false;
                // check if the eye is blocked
                const eyeX = (fromX + toX) / 2;
                const eyeY = (fromY + toY) / 2;
                if (this.getPieceAt(eyeX, eyeY)) return false;
                // 相象can't cross the river
                if (color === 'red' && toY < 5) return false;
                if (color === 'black' && toY > 4) return false;
                return true;

            case '馬':
                // 馬走日
                const dx = Math.abs(toX - fromX);
                const dy = Math.abs(toY - fromY);
                if (!((dx === 1 && dy === 2) || (dx === 2 && dy === 1))) return false;
                // check if the leg is blocked
                const legX = fromX + (dx === 2 ? (toX > fromX ? 1 : -1) : 0);
                const legY = fromY + (dy === 2 ? (toY > fromY ? 1 : -1) : 0);
                if (this.getPieceAt(legX, legY)) return false;
                return true;

            case '車':
                // 車can only move straight
                if (fromX !== toX && fromY !== toY) return false;
                // check if there is any other piece in the path
                return !this.hasPieceInPath(fromX, fromY, toX, toY);

            case '炮':
                // 炮can only move straight
                if (fromX !== toX && fromY !== toY) return false;
                const piecesInPath = this.getPiecesInPath(fromX, fromY, toX, toY);
                // if the target position has a piece, then it must be flipped
                if (targetPiece) {
                    return piecesInPath.length === 1;
                }
                // if the target position has no piece, then the path must be empty
                return piecesInPath.length === 0;

            case '兵':
            case '卒':
                // 兵卒can only move one step forward or sideways
                if (color === 'red') {
                    if (toY > fromY) return false; // can't move backward
                    if (fromY > 4) {
                        // 未過河
                        return toX === fromX && toY === fromY - 1;
                    } else {
                        // 已過河
                        return (toX === fromX && toY === fromY - 1) || (toY === fromY && Math.abs(toX - fromX) === 1);
                    }
                } else {
                    if (toY < fromY) return false; // can't move backward
                    if (fromY < 5) {
                        // 未過河
                        return toX === fromX && toY === fromY + 1;
                    } else {
                        // 已過河
                        return (toX === fromX && toY === fromY + 1) || (toY === fromY && Math.abs(toX - fromX) === 1);
                    }
                }
        }
        return false;
    }

    getPieceAt(x, y) {
        return this.pieces.find((p) => parseInt(p.dataset.x) === x && parseInt(p.dataset.y) === y);
    }

    hasPieceInPath(fromX, fromY, toX, toY) {
        return this.getPiecesInPath(fromX, fromY, toX, toY).length > 0;
    }

    getPiecesInPath(fromX, fromY, toX, toY) {
        const pieces = [];
        if (fromX === toX) {
            const start = Math.min(fromY, toY);
            const end = Math.max(fromY, toY);
            for (let y = start + 1; y < end; y++) {
                const piece = this.getPieceAt(fromX, y);
                if (piece) pieces.push(piece);
            }
        } else if (fromY === toY) {
            const start = Math.min(fromX, toX);
            const end = Math.max(fromX, toX);
            for (let x = start + 1; x < end; x++) {
                const piece = this.getPieceAt(x, fromY);
                if (piece) pieces.push(piece);
            }
        }
        return pieces;
    }

    movePiece(fromPiece, toPiece) {
        const fromX = parseInt(fromPiece.dataset.x);
        const fromY = parseInt(fromPiece.dataset.y);
        const toX = parseInt(toPiece.dataset.x);
        const toY = parseInt(toPiece.dataset.y);

        fromPiece.style.left = `${toX * this.cellSize}px`;
        fromPiece.style.top = `${toY * this.cellSize}px`;
        fromPiece.dataset.x = toX;
        fromPiece.dataset.y = toY;
        fromPiece.classList.remove('selected');

        // Check if the captured piece is 將 or 帥
        if (toPiece.dataset.type === '將' || toPiece.dataset.type === '帥') {
            const winner = this.currentPlayer === 'red' ? 'red' : 'black';
            this.showGameOver(winner);
        }

        this.board.removeChild(toPiece);
        this.pieces = this.pieces.filter((p) => p !== toPiece);

        this.selectedPiece = null;
        this.currentPlayer = this.currentPlayer === 'red' ? 'black' : 'red';
    }

    showGameOver(winner) {
        this.winnerText.textContent = `${winner} wins!`;
        this.modal.style.display = 'block';
    }

    resetGame() {
        // Clear the board
        while (this.board.firstChild) {
            this.board.removeChild(this.board.firstChild);
        }
        this.pieces = [];
        this.selectedPiece = null;
        this.currentPlayer = 'red';

        // Hide the modal
        this.modal.style.display = 'none';

        // Reinitialize the game
        this.initializeBoard();
        this.initializePieces();
    }
}

// initialize the game
let game;
window.onload = () => {
    game = new ChineseChess();
};
