// Game Config
const WORD_LENGTH = 5;
const MAX_ATTEMPTS = 6;

// Game State
let currentRow = 0;
let currentTile = 0;
let isGameOver = false;
let targetWord = '';

// DOM Elements
const board = document.getElementById('board');
const keyboard = document.getElementById('keyboard');
const message = document.getElementById('message');
const gameOver = document.getElementById('gameOver');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverWord = document.getElementById('gameOverWord');

// Initialize Game
function initGame() {
    // Reset Game State
    currentRow = 0;
    currentTile = 0;
    isGameOver = false;

    // Clear Game Board
    board.innerHTML = '';

    // Create Game Board
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const row = document.createElement('div');
        row.className = 'row';
        for (let j = 0; j < WORD_LENGTH; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            row.appendChild(tile);
        }
        board.appendChild(row);
    }

    // Reset Keyboard
    const keys = keyboard.querySelectorAll('.key');
    keys.forEach((key) => {
        key.className = 'key' + (key.classList.contains('wide') ? ' wide' : '');
    });

    // Select Target Word
    targetWord = WORDS[Math.floor(Math.random() * WORDS.length)];

    // Hide Game Over Screen
    gameOver.classList.remove('show');
}

// Show Message
function showMessage(text, duration = 2000) {
    message.textContent = text;
    message.classList.add('show');
    setTimeout(() => {
        message.classList.remove('show');
    }, duration);
}

// Handle Key Press
function handleKeyPress(key) {
    if (isGameOver) return;

    if (key === 'enter') {
        checkRow();
    } else if (key === 'backspace') {
        deleteLetter();
    } else if (/^[a-z]$/.test(key)) {
        addLetter(key.toUpperCase());
    }
}

// Add Letter
function addLetter(letter) {
    if (currentTile < WORD_LENGTH && currentRow < MAX_ATTEMPTS) {
        const row = board.children[currentRow];
        const tile = row.children[currentTile];
        tile.textContent = letter;
        tile.classList.add('filled');
        currentTile++;
    }
}

// Delete Letter
function deleteLetter() {
    if (currentTile > 0) {
        currentTile--;
        const row = board.children[currentRow];
        const tile = row.children[currentTile];
        tile.textContent = '';
        tile.classList.remove('filled');
    }
}

// Check Row
function checkRow() {
    if (currentTile !== WORD_LENGTH) {
        showMessage(GAME_TEXT.notEnoughLetters);
        return;
    }

    const row = board.children[currentRow];
    const guess = Array.from(row.children)
        .map((tile) => tile.textContent)
        .join('')
        .toLowerCase();

    if (!WORDS.includes(guess)) {
        showMessage(GAME_TEXT.notValidWord);
        return;
    }

    const targetLetters = targetWord.split('');
    const guessLetters = guess.split('');
    const result = new Array(WORD_LENGTH).fill('absent');

    // Check Correct Position
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (guessLetters[i] === targetLetters[i]) {
            result[i] = 'correct';
            targetLetters[i] = null;
        }
    }

    // Check Incorrect Position
    for (let i = 0; i < WORD_LENGTH; i++) {
        if (result[i] === 'correct') continue;

        const index = targetLetters.indexOf(guessLetters[i]);
        if (index !== -1) {
            result[i] = 'present';
            targetLetters[index] = null;
        }
    }

    // Update Box Color
    for (let i = 0; i < WORD_LENGTH; i++) {
        const tile = row.children[i];
        tile.classList.add(result[i]);

        // Update Keyboard Color
        const key = keyboard.querySelector(`[data-key="${guessLetters[i].toLowerCase()}"]`);
        if (key) {
            if (result[i] === 'correct') {
                key.classList.add('correct');
            } else if (result[i] === 'present' && !key.classList.contains('correct')) {
                key.classList.add('present');
            } else if (
                result[i] === 'absent' &&
                !key.classList.contains('correct') &&
                !key.classList.contains('present')
            ) {
                key.classList.add('absent');
            }
        }
    }

    // Check if Game is Over
    if (guess === targetWord) {
        isGameOver = true;
        showGameOver(true);
    } else if (currentRow === MAX_ATTEMPTS - 1) {
        isGameOver = true;
        showGameOver(false);
    } else {
        currentRow++;
        currentTile = 0;
    }
}

// Show Game Over Screen
function showGameOver(isWin) {
    gameOverTitle.textContent = isWin ? GAME_TEXT.win : GAME_TEXT.gameOver;
    gameOverWord.textContent = `${GAME_TEXT.correctWord}${targetWord}`;
    gameOver.classList.add('show');
}

// Restart Game
function restartGame() {
    initGame();
}

// Keyboard Event Listener
document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        handleKeyPress('enter');
    } else if (event.key === 'Backspace') {
        handleKeyPress('backspace');
    } else if (/^[a-zA-Z]$/.test(event.key)) {
        handleKeyPress(event.key.toLowerCase());
    }
});

// Virtual Keyboard Event Listener
keyboard.addEventListener('click', (event) => {
    const key = event.target;
    if (key.classList.contains('key')) {
        handleKeyPress(key.dataset.key);
    }
});

// Initialize Game
initGame();
