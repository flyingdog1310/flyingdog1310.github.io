let answer = '';
let finished = false;
const message = document.getElementById('message');
const history = document.getElementById('history');
const guessInput = document.getElementById('guessInput');
const submitBtn = document.getElementById('submitBtn');
const restartBtn = document.getElementById('restartBtn');

function generateAnswer() {
    let digits = [];
    while (digits.length < 4) {
        let d = Math.floor(Math.random() * 10).toString();
        if (!digits.includes(d)) digits.push(d);
    }
    return digits.join('');
}

function checkGuess(guess, answer) {
    let A = 0,
        B = 0;
    for (let i = 0; i < 4; i++) {
        if (guess[i] === answer[i]) {
            A++;
        } else if (answer.includes(guess[i])) {
            B++;
        }
    }
    return `${A}A${B}B`;
}

function addHistory(guess, result) {
    const div = document.createElement('div');
    div.textContent = `${guess} → ${result}`;
    history.appendChild(div);
    history.scrollTop = history.scrollHeight;
}

function showMessage(msg, color = '#ffb300') {
    message.textContent = msg;
    message.style.color = color;
}

function resetGame() {
    answer = generateAnswer();
    finished = false;
    history.innerHTML = '';
    showMessage('');
    guessInput.value = '';
    guessInput.disabled = false;
    submitBtn.disabled = false;
}

submitBtn.onclick = function () {
    if (finished) return;
    const guess = guessInput.value.trim();
    if (!/^\d{4}$/.test(guess)) {
        showMessage('Please enter 4 digits', '#ff6666');
        return;
    }
    if (new Set(guess).size !== 4) {
        showMessage('Digits cannot be repeated', '#ff6666');
        return;
    }
    const result = checkGuess(guess, answer);
    addHistory(guess, result);
    if (result === '4A0B') {
        showMessage('Congratulations! You guessed it right!', '#4caf50');
        finished = true;
        guessInput.disabled = true;
        submitBtn.disabled = true;
    } else {
        showMessage('Keep trying!');
    }
    guessInput.value = '';
    guessInput.focus();
};

guessInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitBtn.click();
});

restartBtn.onclick = resetGame;

resetGame();
