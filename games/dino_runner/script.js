class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.score = 0;
        this.highScore = parseInt(localStorage.getItem('dinoHighScore')) || 0;
        this.gameOver = false;
        this.gameReady = true; // Game starts in ready state
        this.speed = 5;
        this.gravity = 0.5;

        // update high score display
        document.getElementById('high-score').textContent = `High Score: ${this.highScore}`;

        // dino settings
        this.dino = {
            x: 50,
            y: this.canvas.height - 40,
            width: 40,
            height: 40,
            jumping: false,
            velocity: 0,
        };

        // obstacle array
        this.obstacles = [];
        this.obstacleTimer = 0;

        // bind event listeners
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('touchstart', this.handleTouchStart.bind(this));
        document.getElementById('restart-button').addEventListener('click', this.restart.bind(this));

        // start game loop
        this.gameLoop();
    }

    handleKeyDown(event) {
        if (this.gameReady && (event.code === 'Space' || event.code === 'ArrowUp')) {
            this.gameReady = false;
            // Optionally, make the first jump happen immediately
            // if (!this.dino.jumping) this.jump();
            return; // Don't jump on the first press that starts the game, unless desired
        }
        if (
            (event.code === 'Space' || event.code === 'ArrowUp') &&
            !this.dino.jumping &&
            !this.gameOver &&
            !this.gameReady
        ) {
            this.jump();
        }
    }

    handleTouchStart(event) {
        if (this.gameReady) {
            this.gameReady = false;
            // Optionally, make the first jump happen immediately
            // if (!this.dino.jumping) this.jump();
            event.preventDefault();
            return; // Don't jump on the first touch that starts the game, unless desired
        }
        if (!this.dino.jumping && !this.gameOver && !this.gameReady) {
            this.jump();
            event.preventDefault();
        }
    }

    jump() {
        this.dino.jumping = true;
        this.dino.velocity = -12;
    }

    update() {
        if (this.gameOver || this.gameReady) return; // Don't update if game over or not started

        // update dino position
        if (this.dino.jumping) {
            this.dino.y += this.dino.velocity;
            this.dino.velocity += this.gravity;

            if (this.dino.y >= this.canvas.height - this.dino.height) {
                this.dino.y = this.canvas.height - this.dino.height;
                this.dino.jumping = false;
                this.dino.velocity = 0;
            }
        }

        // spawn new obstacle
        this.obstacleTimer++;
        if (this.obstacleTimer > 100) {
            this.obstacles.push({
                x: this.canvas.width,
                width: 20,
                height: 40 + Math.random() * 20,
            });
            this.obstacleTimer = 0;
        }

        // update obstacle position
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            this.obstacles[i].x -= this.speed;

            // remove obstacles out of screen
            if (this.obstacles[i].x + this.obstacles[i].width < 0) {
                this.obstacles.splice(i, 1);
                this.score++;
                document.getElementById('score').textContent = `Score: ${this.score}`;
            }

            // collision detection
            if (this.checkCollision(this.obstacles[i])) {
                this.endGame();
            }
        }

        // increase game difficulty
        if (this.score > 0 && this.score % 10 === 0) {
            this.speed += 0.01;
        }
    }

    checkCollision(obstacle) {
        return !(
            this.dino.x + this.dino.width < obstacle.x ||
            this.dino.x > obstacle.x + obstacle.width ||
            this.dino.y + this.dino.height < this.canvas.height - obstacle.height ||
            this.dino.y > this.canvas.height
        );
    }

    draw() {
        // 清空畫布
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // draw ground
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.canvas.height);
        this.ctx.lineTo(this.canvas.width, this.canvas.height);
        this.ctx.strokeStyle = '#4CAF50';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // draw dino
        this.ctx.fillStyle = '#4CAF50';
        this.ctx.fillRect(this.dino.x, this.dino.y, this.dino.width, this.dino.height);

        // draw obstacles
        this.ctx.fillStyle = '#81c784';
        this.obstacles.forEach((obstacle) => {
            this.ctx.fillRect(obstacle.x, this.canvas.height - obstacle.height, obstacle.width, obstacle.height);
        });

        if (this.gameReady) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; // Semi-transparent overlay
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.font = '30px Arial';
            this.ctx.fillStyle = 'white';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('Press SPACE to Start', this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    endGame() {
        this.gameOver = true;
        // check if break record
        if (this.score > this.highScore) {
            this.highScore = this.score;
            localStorage.setItem('dinoHighScore', this.highScore);
            document.getElementById('high-score').textContent = `High Score: ${this.highScore}`;
        }
        document.getElementById('game-over').style.display = 'block';
        document.getElementById('final-score').textContent = this.score;
    }

    restart() {
        this.score = 0;
        this.gameOver = false;
        this.gameReady = true; // Reset to ready state
        this.speed = 5;
        this.obstacles = [];
        this.obstacleTimer = 0;
        this.dino.y = this.canvas.height - this.dino.height;
        this.dino.jumping = false;
        this.dino.velocity = 0;
        document.getElementById('score').textContent = 'Score: 0';
        document.getElementById('game-over').style.display = 'none';
    }

    gameLoop() {
        this.update();
        this.draw();
        // Only request next frame if game is not over, or if it is ready (to show start screen)
        // if (!this.gameOver || this.gameReady) {
        // This logic can be simpler: gameLoop always runs, update/draw handles states.
        requestAnimationFrame(this.gameLoop.bind(this));
        // }
    }
}

// when page loaded, start game
window.onload = () => {
    new Game();
};
