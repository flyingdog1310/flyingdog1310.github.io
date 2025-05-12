let selectedCell = null;
let board = [];
let solution = [];
let fixedCells = new Set();

// Initialize the board
function initializeBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';

    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = i;
            cell.dataset.col = j;
            cell.addEventListener('click', () => selectCell(cell));
            boardElement.appendChild(cell);
        }
    }

    // Create number pad
    const numberPad = document.getElementById('numberPad');
    numberPad.innerHTML = '';
    for (let i = 1; i <= 9; i++) {
        const button = document.createElement('button');
        button.textContent = i;
        button.addEventListener('click', () => inputNumber(i));
        numberPad.appendChild(button);
    }
}

// Select a cell
function selectCell(cell) {
    if (selectedCell) {
        selectedCell.classList.remove('selected');
    }
    if (!cell.classList.contains('fixed')) {
        selectedCell = cell;
        cell.classList.add('selected');
    }
}

// Input a number
function inputNumber(num) {
    if (selectedCell && !selectedCell.classList.contains('fixed')) {
        const row = parseInt(selectedCell.dataset.row);
        const col = parseInt(selectedCell.dataset.col);

        selectedCell.textContent = num;
        board[row][col] = num;

        // Check if the number is valid
        if (!isValidMove(row, col, num)) {
            selectedCell.classList.add('error');
        } else {
            selectedCell.classList.remove('error');
        }
    }
}

// Check if a move is valid
function isValidMove(row, col, num) {
    // Check row
    for (let i = 0; i < 9; i++) {
        if (i !== col && board[row][i] === num) return false;
    }

    // Check column
    for (let i = 0; i < 9; i++) {
        if (i !== row && board[i][col] === num) return false;
    }

    // Check 3x3 box
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (boxRow + i !== row && boxCol + j !== col && board[boxRow + i][boxCol + j] === num) return false;
        }
    }

    return true;
}

// Generate a new Sudoku puzzle
function generatePuzzle() {
    // Initialize empty board
    board = Array(9)
        .fill()
        .map(() => Array(9).fill(0));
    solution = Array(9)
        .fill()
        .map(() => Array(9).fill(0));
    fixedCells.clear();

    // Fill diagonal boxes
    for (let box = 0; box < 9; box += 3) {
        fillBox(box, box);
    }

    // Solve the rest of the puzzle
    solveSudoku(0, 0);

    // Copy solution
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            solution[i][j] = board[i][j];
        }
    }

    // Remove numbers based on difficulty
    const difficulty = document.getElementById('difficulty').value;
    const cellsToRemove = {
        easy: 40,
        medium: 50,
        hard: 60,
    }[difficulty];

    let removed = 0;
    while (removed < cellsToRemove) {
        const row = Math.floor(Math.random() * 9);
        const col = Math.floor(Math.random() * 9);
        if (board[row][col] !== 0) {
            board[row][col] = 0;
            removed++;
        }
    }

    // Mark fixed cells
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            if (board[i][j] !== 0) {
                fixedCells.add(`${i},${j}`);
            }
        }
    }
}

// Fill a 3x3 box with random numbers
function fillBox(row, col) {
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            const randomIndex = Math.floor(Math.random() * numbers.length);
            board[row + i][col + j] = numbers[randomIndex];
            numbers.splice(randomIndex, 1);
        }
    }
}

// Solve Sudoku using backtracking
function solveSudoku(row, col) {
    if (col === 9) {
        row++;
        col = 0;
    }
    if (row === 9) return true;
    if (board[row][col] !== 0) return solveSudoku(row, col + 1);

    for (let num = 1; num <= 9; num++) {
        if (isValidMove(row, col, num)) {
            board[row][col] = num;
            if (solveSudoku(row, col + 1)) return true;
            board[row][col] = 0;
        }
    }
    return false;
}

// Start a new game
function newGame() {
    initializeBoard();
    generatePuzzle();
    updateBoard();
}

// Update the board display
function updateBoard() {
    const cells = document.querySelectorAll('.cell');
    cells.forEach((cell) => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        const value = board[row][col];

        cell.textContent = value || '';
        cell.classList.remove('fixed', 'error');

        if (fixedCells.has(`${row},${col}`)) {
            cell.classList.add('fixed');
        }
    });
}

// Check the current solution
function checkSolution() {
    const cells = document.querySelectorAll('.cell');
    let isComplete = true;
    let isCorrect = true;

    cells.forEach((cell) => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        const value = board[row][col];

        if (value === 0) {
            isComplete = false;
        }
        if (value !== solution[row][col]) {
            isCorrect = false;
            cell.classList.add('error');
        } else {
            cell.classList.remove('error');
        }
    });

    if (!isComplete) {
        alert('Please fill in all cells!');
    } else if (isCorrect) {
        alert('Congratulations! You solved the puzzle!');
    } else {
        alert('There are some errors in your solution.');
    }
}

// Solve the puzzle
function solvePuzzle() {
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            board[i][j] = solution[i][j];
        }
    }
    updateBoard();
}

// Start the game when the page loads
window.onload = newGame;
