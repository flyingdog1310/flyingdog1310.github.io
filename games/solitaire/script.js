document.addEventListener('DOMContentLoaded', () => {
    const suits = ['♥', '♦', '♣', '♠'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const rankValues = {
        A: 1,
        2: 2,
        3: 3,
        4: 4,
        5: 5,
        6: 6,
        7: 7,
        8: 8,
        9: 9,
        10: 10,
        J: 11,
        Q: 12,
        K: 13,
    };

    let deck = [];
    let stock = [];
    let waste = [];
    let foundations = [[], [], [], []];
    let tableau = [[], [], [], [], [], [], []];

    // selectedCard will store information about the selected card or stack
    // For a single card: { cardsToMove: [cardData], elements: [cardElement], sourcePileType, sourcePileIndex, sourceCardIndex }
    // For a stack: { cardsToMove: [cardData1, cardData2, ...], elements: [cardElement1, ...], sourcePileType, sourcePileIndex, sourceCardIndex (index of the top card of the stack) }
    let selectedCard = null;

    // --- DOM Elements for Piles ---
    const stockPileDiv = document.createElement('div');
    stockPileDiv.classList.add('pile', 'stock');
    stockPileDiv.addEventListener('click', drawFromStock);

    const wastePileDiv = document.createElement('div');
    wastePileDiv.classList.add('pile', 'waste');

    const foundationDivs = [];
    for (let i = 0; i < 4; i++) {
        const fPile = document.createElement('div');
        fPile.classList.add('pile', 'foundation', `foundation-${i}`);
        fPile.dataset.pileType = 'foundation';
        fPile.dataset.index = i;
        fPile.addEventListener('click', () => handlePileClick('foundation', i));
        foundationDivs.push(fPile);
    }

    const tableauDivs = [];
    for (let i = 0; i < 7; i++) {
        const tPile = document.createElement('div');
        tPile.classList.add('pile', 'tableau-pile', `tableau-${i}`);
        tPile.dataset.pileType = 'tableau';
        tPile.dataset.index = i;
        tPile.addEventListener('click', () => handlePileClick('tableau', i));
        tableauDivs.push(tPile);
    }

    // --- Card Creation and Rendering ---
    function createCardElement(card, pileType, pileIndex, cardIndexInPile) {
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card');
        cardDiv.dataset.suit = card.suit;
        cardDiv.dataset.rank = card.rank;
        cardDiv.dataset.value = rankValues[card.rank];
        // Store identifiers for click handling
        cardDiv.dataset.pileType = pileType;
        cardDiv.dataset.pileIndex = String(pileIndex); // Ensure it's a string for dataset
        if (cardIndexInPile !== undefined) {
            cardDiv.dataset.cardIndex = String(cardIndexInPile);
        }

        if (card.isFaceUp) {
            const color = card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
            cardDiv.classList.add(color);

            const rankSuitTop = document.createElement('span');
            rankSuitTop.classList.add('card-rank-suit');
            rankSuitTop.textContent = card.rank + card.suit;

            const suitCenter = document.createElement('span');
            suitCenter.classList.add('card-suit-center');
            suitCenter.textContent = card.suit;

            const rankSuitBottom = document.createElement('span');
            rankSuitBottom.classList.add('card-rank-suit', 'bottom');
            rankSuitBottom.textContent = card.rank + card.suit;

            cardDiv.appendChild(rankSuitTop);
            cardDiv.appendChild(suitCenter);
            cardDiv.appendChild(rankSuitBottom);

            cardDiv.addEventListener('click', (event) => {
                event.stopPropagation();
                handleCardClick(card, cardDiv, pileType, pileIndex, cardIndexInPile);
            });
        } else {
            cardDiv.classList.add('face-down');
            if (pileType === 'tableau' && cardIndexInPile === tableau[pileIndex].length - 1 && !card.isFaceUp) {
                cardDiv.addEventListener('click', (event) => {
                    event.stopPropagation();
                    flipTableauCard(pileIndex, cardIndexInPile);
                });
            }
        }
        return cardDiv;
    }

    function createDeck() {
        deck = [];
        for (const suit of suits) {
            for (const rank of ranks) {
                deck.push({ suit, rank, isFaceUp: false, value: rankValues[rank] });
            }
        }
    }

    function shuffleDeck() {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    }

    function dealCards() {
        for (let i = 0; i < 7; i++) {
            tableau[i] = [];
            for (let j = 0; j <= i; j++) {
                const card = deck.pop();
                if (j === i) {
                    card.isFaceUp = true;
                }
                tableau[i].push(card);
            }
        }
        stock = [...deck];
        deck = [];
        stock.forEach((card) => (card.isFaceUp = false));
    }

    function renderBoard() {
        const gameBoard = document.getElementById('game-board');
        gameBoard.innerHTML = '';

        const topArea = document.createElement('div');
        topArea.classList.add('stock-waste-area');
        topArea.appendChild(stockPileDiv);
        topArea.appendChild(wastePileDiv);
        gameBoard.appendChild(topArea);

        const foundationAreaElement = document.createElement('div');
        foundationAreaElement.classList.add('foundation-area');
        foundationDivs.forEach((fd) => foundationAreaElement.appendChild(fd));
        gameBoard.appendChild(foundationAreaElement);

        const tableauAreaElement = document.createElement('div');
        tableauAreaElement.classList.add('tableau-area');
        tableauDivs.forEach((td) => tableauAreaElement.appendChild(td));
        gameBoard.appendChild(tableauAreaElement);

        renderStock();
        renderWaste();
        renderFoundations();
        renderTableau();
    }

    function renderStock() {
        stockPileDiv.innerHTML = '';
        if (stock.length > 0) {
            const backCard = createCardElement({ suit: '', rank: '', isFaceUp: false }, 'stock', 0, -1);
            stockPileDiv.appendChild(backCard);
            stockPileDiv.classList.remove('empty');
        } else {
            stockPileDiv.classList.add('empty');
        }
    }

    function renderWaste() {
        wastePileDiv.innerHTML = '';
        if (waste.length > 0) {
            const topWasteCardData = waste[waste.length - 1];
            const cardElement = createCardElement(
                { ...topWasteCardData, isFaceUp: true },
                'waste',
                0,
                waste.length - 1
            );
            wastePileDiv.appendChild(cardElement);
        }
    }

    function renderFoundations() {
        foundations.forEach((foundationPile, index) => {
            renderFoundationPile(index);
        });
    }

    function renderTableau() {
        tableau.forEach((tableauPile, pileIndex) => {
            renderTableauPile(pileIndex);
        });
    }

    function drawFromStock() {
        if (selectedCard) deselectCard(); // Deselect any card before drawing
        if (stock.length === 0) {
            if (waste.length > 0) {
                stock = waste.reverse().map((card) => ({ ...card, isFaceUp: false }));
                waste = [];
            } else {
                return;
            }
        } else {
            const drawnCard = stock.pop();
            drawnCard.isFaceUp = true;
            waste.push(drawnCard);
        }
        renderStock();
        renderWaste();
    }

    // --- Game Logic: Card Movement, Rules, Win Condition ---
    function handleCardClick(cardData, cardElement, pileType, pileIndex, cardIndexInPile) {
        if (!cardData.isFaceUp && pileType === 'tableau') {
            // This case should be handled by the face-down card's own click listener for flipping
            // If somehow missed, or logic changes, this is a safeguard.
            if (cardIndexInPile === tableau[pileIndex].length - 1) {
                flipTableauCard(pileIndex, cardIndexInPile);
            }
            return;
        }
        if (!cardData.isFaceUp) return; // Should not be able to click other face-down cards

        if (selectedCard) {
            // A card/stack is already selected.
            // If the clicked card is the SAME as the (top of the) selected stack, deselect it.
            if (
                selectedCard.sourcePileType === pileType &&
                selectedCard.sourcePileIndex === pileIndex &&
                selectedCard.sourceCardIndex === cardIndexInPile
            ) {
                deselectCard();
                return;
            }

            // Otherwise, try to move the selected card/stack to the pile of the clicked card.
            // The target pile for the move is determined by where cardElement (the clicked card) resides.
            tryMoveSelectedCard(pileType, pileIndex);
        } else {
            // No card selected, so select this one or the stack it belongs to.
            selectCard(cardData, cardElement, pileType, pileIndex, cardIndexInPile);
        }
    }

    function handlePileClick(targetPileType, targetPileIndex) {
        if (selectedCard) {
            tryMoveSelectedCard(targetPileType, targetPileIndex);
        }
    }

    function flipTableauCard(pileIndex, cardIndex) {
        if (tableau[pileIndex] && tableau[pileIndex][cardIndex]) {
            const cardToFlip = tableau[pileIndex][cardIndex];
            if (!cardToFlip.isFaceUp && cardIndex === tableau[pileIndex].length - 1) {
                cardToFlip.isFaceUp = true;
                renderTableauPile(pileIndex);
            }
        }
    }

    function selectCard(clickedCardData, clickedCardElement, pileType, pileIndex, cardIndexInPile) {
        if (selectedCard) deselectCard(); // Clear previous selection

        let cardsToSelect = [];
        let elementsToSelect = [];

        if (pileType === 'waste' && cardIndexInPile === waste.length - 1) {
            cardsToSelect.push(clickedCardData);
            elementsToSelect.push(clickedCardElement);
            selectedCard = {
                cardsToMove: cardsToSelect,
                elements: elementsToSelect,
                sourcePileType: pileType,
                sourcePileIndex: pileIndex,
                sourceCardIndex: cardIndexInPile, // index of the (only) card
            };
        } else if (pileType === 'tableau' && clickedCardData.isFaceUp) {
            const pile = tableau[pileIndex];
            for (let i = cardIndexInPile; i < pile.length; i++) {
                cardsToSelect.push(pile[i]);
                // Need to find the corresponding DOM element for cards in the stack below the clicked one
                // This requires querying the DOM, which is a bit heavy here.
                // A simpler approach for now: highlight only the clicked card, but know we are moving a stack.
            }
            // For visual feedback, we still highlight only the clicked card, or all of them.
            // Let's try to highlight all selected cards in a stack.
            const tableauPileDiv = tableauDivs[pileIndex];
            for (let i = cardIndexInPile; i < pile.length; i++) {
                // The element for pile[i] needs to be found.
                // The clickedCardElement is for pile[cardIndexInPile].
                // We assume card elements are in order in the DOM pile
                if (tableauPileDiv.children[i]) {
                    // Check if element exists
                    elementsToSelect.push(tableauPileDiv.children[i]);
                } else {
                    // Fallback if element not found (should not happen with current render logic)
                    if (i === cardIndexInPile) elementsToSelect.push(clickedCardElement);
                }
            }

            if (cardsToSelect.length > 0) {
                selectedCard = {
                    cardsToMove: cardsToSelect, // Array of card data objects
                    elements: elementsToSelect, // Array of card DOM elements
                    sourcePileType: pileType,
                    sourcePileIndex: pileIndex,
                    sourceCardIndex: cardIndexInPile, // Index of the TOP card in the selected stack
                };
            }
        } else {
            return; // Do not proceed to highlight if selection is invalid
        }

        if (selectedCard) {
            selectedCard.elements.forEach((el) => el.classList.add('selected'));
        }
    }

    function deselectCard() {
        if (selectedCard && selectedCard.elements) {
            selectedCard.elements.forEach((el) => el.classList.remove('selected'));
        }
        selectedCard = null;
    }

    function tryMoveSelectedCard(targetPileType, targetPileIndex) {
        if (!selectedCard || selectedCard.cardsToMove.length === 0) return;

        const cardsToMove = selectedCard.cardsToMove;
        const firstCardToMove = cardsToMove[0]; // The top card of the stack being moved
        const sourcePileType = selectedCard.sourcePileType;
        const sourcePileIndex = selectedCard.sourcePileIndex;

        let isValidMove = false;
        let targetPileArray;

        if (targetPileType === 'foundation') {
            if (cardsToMove.length > 1) {
                // Only single cards to foundation
                isValidMove = false;
            } else {
                targetPileArray = foundations[targetPileIndex];
                isValidMove = canMoveToFoundation(firstCardToMove, targetPileArray);
            }
        } else if (targetPileType === 'tableau') {
            targetPileArray = tableau[targetPileIndex];
            isValidMove = canMoveToTableau(firstCardToMove, targetPileArray);
        }

        if (isValidMove) {
            // Remove from source pile
            let originalSourcePileArray;
            if (sourcePileType === 'waste') {
                waste.pop(); // Assumes cardsToMove.length is 1
            } else if (sourcePileType === 'tableau') {
                originalSourcePileArray = tableau[sourcePileIndex];
                originalSourcePileArray.splice(selectedCard.sourceCardIndex, cardsToMove.length);
            }
            // Cannot move FROM foundation in this Klondike version

            // Add to target pile
            cardsToMove.forEach((card) => targetPileArray.push(card));

            // Flip card in source tableau pile if necessary
            if (sourcePileType === 'tableau' && tableau[sourcePileIndex].length > 0) {
                const newTopCardInSource = tableau[sourcePileIndex][tableau[sourcePileIndex].length - 1];
                if (!newTopCardInSource.isFaceUp) {
                    newTopCardInSource.isFaceUp = true;
                }
            }

            // Re-render affected piles
            if (sourcePileType === 'waste') renderWaste();
            else if (sourcePileType === 'tableau') renderTableauPile(sourcePileIndex);

            if (targetPileType === 'foundation') renderFoundationPile(targetPileIndex);
            else if (targetPileType === 'tableau') renderTableauPile(targetPileIndex);

            checkWinCondition();
        }
        deselectCard(); // Deselect after attempt, regardless of success
    }

    function canMoveToFoundation(card, foundationPile) {
        // Foundation piles must be built with the same suit
        const targetSuit = foundationPile.length > 0 ? foundationPile[0].suit : card.suit;
        if (card.suit !== targetSuit) return false;
        // Ace on empty, or next rank in sequence
        if (foundationPile.length === 0) {
            return card.rank === 'A';
        }
        const topFoundationCard = foundationPile[foundationPile.length - 1];
        return rankValues[card.rank] === rankValues[topFoundationCard.rank] + 1;
    }

    function canMoveToTableau(cardToPlace, tableauPile) {
        // cardToPlace is the TOP card of the stack being moved
        if (tableauPile.length === 0) {
            return cardToPlace.rank === 'K'; // Only King on empty tableau
        }
        const topTableauCard = tableauPile[tableauPile.length - 1];
        if (!topTableauCard.isFaceUp) return false; // Should not happen if logic is correct elsewhere

        const cardToPlaceColor = cardToPlace.suit === '♥' || cardToPlace.suit === '♦' ? 'red' : 'black';
        const topTableauCardColor = topTableauCard.suit === '♥' || topTableauCard.suit === '♦' ? 'red' : 'black';

        if (cardToPlaceColor === topTableauCardColor) return false;
        return rankValues[cardToPlace.rank] === rankValues[topTableauCard.rank] - 1;
    }

    function renderTableauPile(pileIndex) {
        const tableauPileDiv = tableauDivs[pileIndex];
        tableauPileDiv.innerHTML = '';
        if (!tableau[pileIndex]) return; // Guard against undefined pile during race conditions/resets
        tableau[pileIndex].forEach((cardData, cardIndex) => {
            // Pass correct pileIndex and cardIndex for data attributes
            const cardElement = createCardElement(cardData, 'tableau', pileIndex, cardIndex);
            tableauPileDiv.appendChild(cardElement);
        });
    }

    function renderFoundationPile(pileIndex) {
        const foundationPileDiv = foundationDivs[pileIndex];
        foundationPileDiv.innerHTML = '';
        if (!foundations[pileIndex] || foundations[pileIndex].length === 0) return;
        const topCardData = foundations[pileIndex][foundations[pileIndex].length - 1];
        const cardElement = createCardElement(
            { ...topCardData, isFaceUp: true },
            'foundation',
            pileIndex,
            foundations[pileIndex].length - 1
        );
        foundationPileDiv.appendChild(cardElement);
    }

    function checkWinCondition() {
        const totalCardsInFoundations = foundations.reduce((sum, pile) => sum + pile.length, 0);
        if (totalCardsInFoundations === 52) {
            setTimeout(() => {
                alert('Congratulations! You won!');
                startGame();
            }, 100);
        }
    }

    function startGame() {
        deselectCard();
        deck = [];
        stock = [];
        waste = [];
        foundations = [[], [], [], []];
        tableau = [[], [], [], [], [], [], []];

        createDeck();
        shuffleDeck();
        dealCards();
        renderBoard();
    }

    // Initial game start
    startGame();
});
