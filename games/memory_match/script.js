const emojis = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'];
let cards = [];
let flippedCards = [];
let moves = 0;
let pairs = 0;
let canFlip = true;

function createBoard() {
    const gameBoard = document.getElementById('gameBoard');
    gameBoard.innerHTML = '';
    cards = [];
    flippedCards = [];
    moves = 0;
    pairs = 0;
    updateStats();

    // Create pairs of cards
    const cardPairs = [...emojis, ...emojis];
    // Shuffle cards
    for (let i = cardPairs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardPairs[i], cardPairs[j]] = [cardPairs[j], cardPairs[i]];
    }

    // Create card elements
    cardPairs.forEach((emoji, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-front">${emoji}</div>
            <div class="card-back">?</div>
        `;
        card.dataset.value = emoji;
        card.addEventListener('click', () => flipCard(card));
        gameBoard.appendChild(card);
        cards.push(card);
    });
}

function flipCard(card) {
    if (!canFlip || card.classList.contains('flipped') || flippedCards.length >= 2) return;

    card.classList.add('flipped');
    flippedCards.push(card);

    if (flippedCards.length === 2) {
        moves++;
        updateStats();
        canFlip = false;
        checkMatch();
    }
}

function checkMatch() {
    const [card1, card2] = flippedCards;
    const match = card1.dataset.value === card2.dataset.value;

    if (match) {
        pairs++;
        updateStats();
        flippedCards = [];
        canFlip = true;
        if (pairs === emojis.length) {
            setTimeout(() => {
                alert(`Congratulations! You won in ${moves} moves!`);
            }, 500);
        }
    } else {
        setTimeout(() => {
            card1.classList.remove('flipped');
            card2.classList.remove('flipped');
            flippedCards = [];
            canFlip = true;
        }, 1000);
    }
}

function updateStats() {
    document.getElementById('moves').textContent = moves;
    document.getElementById('pairs').textContent = pairs;
}

function restartGame() {
    createBoard();
}

// Initialize game
createBoard();
