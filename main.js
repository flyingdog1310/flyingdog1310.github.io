const gameGrid = document.querySelector('.game-grid');
const modal = document.getElementById('game-modal');
const modalFrame = document.getElementById('modal-game-frame');
const closeModalBtn = document.querySelector('.close-modal');
let gameCards = []; // Will be populated after rendering

// Cards above the fold load their thumbnail right away; the rest load lazily
const EAGER_THUMBNAILS = 4;

// Start loading the game list immediately instead of waiting for DOMContentLoaded
const gamesRequest = fetch('./games.json');

// Function to render game cards
function renderGameCards(gamesToRender) {
    gameGrid.innerHTML = ''; // Clear existing cards
    gamesToRender.forEach((game, index) => {
        const card = document.createElement('div');
        card.classList.add('game-card');
        card.dataset.category = game.category;
        card.dataset.game = game.id;
        card.dataset.src = game.src;

        card.innerHTML = `
      <div class="game-preview">
        <img src="${game.thumbnail}" alt="${game.name} preview" width="480" height="320"
          loading="${index < EAGER_THUMBNAILS ? 'eager' : 'lazy'}" decoding="async">
      </div>
      <div class="game-info">
        <h3>${game.name}</h3>
        <p>${game.description}</p>
      </div>
    `;
        gameGrid.appendChild(card);
    });
    // Update the gameCards NodeList after rendering
    gameCards = document.querySelectorAll('.game-card');
    // Re-attach modal listeners to the new cards
    attachModalListeners();
}

// Modal functionality
function attachModalListeners() {
    gameCards.forEach((card) => {
        card.addEventListener('click', () => {
            modalFrame.src = card.dataset.src;
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';
            setTimeout(() => {
                modalFrame.focus();
            }, 100);
        });
    });
}

closeModalBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    modalFrame.src = '';
    document.body.style.overflow = 'auto';
});

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.style.display = 'none';
        modalFrame.src = '';
        document.body.style.overflow = 'auto';
    }
});

// Initial render of all games
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await gamesRequest;
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const gamesData = await response.json();
        renderGameCards(gamesData);
        // Initialize filtering and search functionalities after cards are rendered
        initializeFilteringAndSearch();
    } catch (error) {
        console.error('Could not load game data:', error);
        // Optionally, display a message to the user in the gameGrid
        if (gameGrid) {
            gameGrid.innerHTML = '<p class="error-message">Failed to load games. Please try refreshing the page.</p>';
        }
    }
});

function initializeFilteringAndSearch() {
    // Category filtering
    const categoryButtons = document.querySelectorAll('.category-btn');
    const categorySelect = document.getElementById('category-select');

    function filterGames(category) {
        gameCards.forEach((card) => {
            if (category === 'all' || card.dataset.category === category) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    }

    categoryButtons.forEach((button) => {
        button.addEventListener('click', () => {
            categoryButtons.forEach((btn) => btn.classList.remove('active'));
            button.classList.add('active');
            const category = button.dataset.category;
            filterGames(category);
            categorySelect.value = category;
        });
    });

    categorySelect.addEventListener('change', (e) => {
        const category = e.target.value;
        filterGames(category);
        categoryButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });
    });

    // Search functionality
    const searchInput = document.getElementById('game-search');
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const currentCategory = categorySelect.value;

        gameCards.forEach((card) => {
            const gameName = card.querySelector('h3').textContent.toLowerCase();
            const gameDescription = card.querySelector('p').textContent.toLowerCase();
            const matchesSearch = gameName.includes(searchTerm) || gameDescription.includes(searchTerm);
            const matchesCategory = currentCategory === 'all' || card.dataset.category === currentCategory;

            if (matchesSearch && matchesCategory) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    });
}
