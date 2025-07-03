const gameGrid = document.querySelector('.game-grid');
const modal = document.getElementById('game-modal');
const modalFrame = document.getElementById('modal-game-frame');
const closeModalBtn = document.querySelector('.close-modal');
let gameCards = []; // Will be populated after rendering

// Function to render game cards
function renderGameCards(gamesToRender) {
    gameGrid.innerHTML = ''; // Clear existing cards
    gamesToRender.forEach((game) => {
        const card = document.createElement('div');
        card.classList.add('game-card');
        card.dataset.category = game.category;
        card.dataset.game = game.id;

        card.innerHTML = `
      <div class="game-preview">
        <iframe src="${game.src}" frameborder="0"></iframe>
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
            const gameSrc = card.querySelector('iframe').src; // Get src from the new card structure
            modalFrame.src = gameSrc;
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

// Function to get visitor's IP and country
async function getVisitorIP() {
    const visitorIpElement = document.getElementById('visitor-ip');
    const countryFlagElement = document.getElementById('country-flag');

    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if (!response.ok) {
            throw new Error(`IPify API error! status: ${response.status}`);
        }
        const data = await response.json();
        visitorIpElement.textContent = `Your IP : ${data.ip}`;

        try {
            const countryResponse = await fetch(`https://ipapi.co/${data.ip}/json/`);
            if (!countryResponse.ok) {
                throw new Error(`ipapi.co API error! status: ${countryResponse.status}`);
            }
            const countryData = await countryResponse.json();
            if (countryData.country_code) {
                const countryCode = countryData.country_code.toLowerCase();
                countryFlagElement.src = `https://flagcdn.com/w20/${countryCode}.png`;
                countryFlagElement.alt = countryData.country_name || 'Country flag'; // Add alt text
                countryFlagElement.style.display = 'inline-block';
            } else {
                // Handle cases where country_code is not available but IP was fetched
                console.warn('Country code not found in ipapi.co response.');
                countryFlagElement.style.display = 'none';
                countryFlagElement.alt = 'Country flag not available';
            }
        } catch (countryError) {
            console.error('Failed to fetch country information:', countryError);
            countryFlagElement.style.display = 'none';
            countryFlagElement.alt = 'Country flag not available'; // Set alt text
            // Optionally, update visitorIpElement text or add a message here
        }
    } catch (error) {
        console.error('Failed to fetch IP address:', error);
        visitorIpElement.textContent = 'Unable to fetch IP';
        countryFlagElement.style.display = 'none';
        countryFlagElement.alt = 'Country flag not available'; // Set alt text
    }
}

// Call the function when page loads
getVisitorIP();

// Initial render of all games
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('./games.json');
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

// Fetch and display deployment date
fetch('deployment-info.json')
    .then((response) => response.json())
    .then((data) => {
        const deploymentDateElement = document.getElementById('deployment-date');
        if (deploymentDateElement) {
            deploymentDateElement.textContent = `Last updated: ${data.deploymentDate}`;
        }
    })
    .catch((error) => {
        console.error('Error fetching deployment date:', error);
        const deploymentDateElement = document.getElementById('deployment-date');
        if (deploymentDateElement) {
            deploymentDateElement.textContent = 'Last updated: Unknown';
        }
    });
