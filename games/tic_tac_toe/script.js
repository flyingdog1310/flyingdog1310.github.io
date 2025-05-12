const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
let board = Array(9).fill(null);
let xIsNext = true;
let gameOver = false;

function renderBoard() {
    boardEl.innerHTML = '';
    board.forEach((cell, idx) => {
        const cellEl = document.createElement('div');
        cellEl.className = 'cell';
        cellEl.textContent = cell ? cell : '';
        cellEl.onclick = () => handleClick(idx);
        boardEl.appendChild(cellEl);
    });
}

function handleClick(idx) {
    if (board[idx] || gameOver) return;
    board[idx] = xIsNext ? 'O' : 'X';
    xIsNext = !xIsNext;
    checkWinner();
    renderBoard();
    updateStatus();
}

function checkWinner() {
    const lines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            gameOver = true;
            highlightWinner([a, b, c]);
            statusEl.textContent = `Winner: ${board[a]}`;
            return;
        }
    }
    if (board.every((cell) => cell)) {
        gameOver = true;
        statusEl.textContent = 'Draw!';
    }
}

function highlightWinner(indices) {
    [...boardEl.children].forEach((cell, idx) => {
        if (indices.includes(idx)) {
            cell.classList.add('winner');
        }
    });
}

function updateStatus() {
    if (!gameOver) {
        statusEl.textContent = `Turn: ${xIsNext ? 'O' : 'X'}`;
    }
}

function restartGame() {
    board = Array(9).fill(null);
    xIsNext = true;
    gameOver = false;
    renderBoard();
    updateStatus();
}

// Initialize
renderBoard();
updateStatus();
