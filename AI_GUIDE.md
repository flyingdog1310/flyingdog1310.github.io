# AI Development Guide

## 1. Project Overview
### 1.1 Directory Structure
- Games location: `games/`
- Resources location: `assets/`
- Configuration: `games.json`

### 1.2 Technical Stack
- Frontend: HTML5, CSS3, JavaScript (ES6+)
- Dependencies: None (self-contained)
- Design: Mobile responsive

### 1.3 Color Theme
```css
:root {
    --background-color: #121213;
    --secondary-color: #2d2d2d;
    --accent-color: #538d4e;
    --text-color: #ffffff;
    --border-color: #3d3d3d;
}
```

## 2. Development Standards
### 2.1 Core Rules
1. Self-contained game directories
2. Pure HTML/CSS/JS implementation
3. Mobile responsive design
4. Comprehensive documentation
5. Consistent coding style
6. Theme compliance

### 2.2 File Structure Template
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Game Name]</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="game-container">
        <!-- Game components here -->
    </div>
    <script src="script.js"></script>
</body>
</html>
```

## 3. Component Standards
### 3.1 Required Components
1. **Header**
   - Game title
   - Optional logo

2. **Game Info**
   - Score display
   - Lives/Health counter
   - Level/Stage indicator
   - Time display (if applicable)

3. **Game Board**
   - Canvas or DOM-based
   - Responsive sizing
   - Aspect ratio maintenance

4. **Controls**
   - Restart button
   - Game-specific controls

5. **Game Over Modal**
   - Final score display
   - Play again option

### 3.2 Component Templates
```html
<!-- Header -->
<div class="game-header">
    <h1 class="title">[Game Name]</h1>
</div>

<!-- Game Info -->
<div class="game-info">
    <div class="info-box">
        <h3>Score</h3>
        <div id="score">0</div>
    </div>
    <div class="info-box">
        <h3>Lives</h3>
        <div id="lives">3</div>
    </div>
</div>

<!-- Game Board -->
<div class="game-board" id="game-board">
    <!-- Game implementation -->
</div>

<!-- Game Over Modal -->
<div class="game-over" id="game-over">
    <div class="modal-content">
        <h2>Game Over</h2>
        <p>Final Score: <span id="final-score">0</span></p>
        <button id="play-again-btn">Play Again</button>
    </div>
</div>
```

## 4. CSS Standards
### 4.1 Core Layout
```css
.game-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    padding: 15px;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    max-height: 100vh;
    box-sizing: border-box;
}

.game-board {
    background: var(--secondary-color);
    padding: 10px;
    border-radius: 6px;
    position: relative;
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border-color);
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}
```

### 4.2 Responsive Design
```css
/* Large Screens (≤1200px) */
@media (max-width: 1200px) {
    .game-container { width: fit-content; }
    .game-board { width: fit-content; }
    #board {
        width: min(700px, calc(100vh - 200px));
        min-width: 300px;
    }
}

/* Small Screens (≤768px) */
@media (max-width: 768px) {
    .game-container {
        padding: 10px;
        width: 100%;
        min-width: 320px;
    }
    .game-board {
        width: 100%;
        min-width: 320px;
    }
    #board {
        width: min(450px, calc(100vh - 150px));
        min-width: 300px;
    }
}
```

## 5. JavaScript Standards
### 5.1 Game Class Template
```javascript
class Game {
    constructor() {
        this.initializeElements();
        this.setupEventListeners();
        this.initializeGame();
    }

    initializeElements() {
        // DOM element initialization
    }

    setupEventListeners() {
        // Event listener setup
    }

    initializeGame() {
        // Game state initialization
    }

    restartGame() {
        // Game reset logic
    }

    gameOver() {
        // Game over handling
    }
}
```

## 6. Implementation Requirements
### 6.1 Responsive Design
- Desktop and mobile compatibility
- Relative unit usage (%, vh, vw)
- Touch control support

### 6.2 Accessibility
- ARIA labels
- Keyboard navigation
- Color contrast compliance
- Screen reader support

### 6.3 Performance
- Canvas optimization
- requestAnimationFrame usage
- Proper cleanup procedures

### 6.4 State Management
- Clear state/UI separation
- Consistent reset mechanisms
- Proper event handling

## 7. Size Guidelines
### 7.1 Minimum Requirements
- Game Board: 300px minimum width
- Container: 320px minimum width (mobile)
- Maintain aspect ratios
- Prevent excessive shrinking

### 7.2 Responsive Behavior
- Horizontal scroll on small screens
- Minimum size preservation
- Visual quality maintenance
- Usability optimization 