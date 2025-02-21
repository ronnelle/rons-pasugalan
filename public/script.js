const socket = io('https://rons-colorgame.onrender.com', {
    transports: ['websocket', 'polling']
});

// Rest of the script.js remains unchanged
let playerId = null;
let selectedCoin = null;
let hasBet = false;
let isRoomOwner = false;
let roomCode = null;
let isMuted = false;

const colors = ["red", "yellow", "green", "blue", "white", "pink"];
const colorMap = {
    red: "#ff9999",
    yellow: "#ffff99",
    green: "#99ff99",
    blue: "#99ccff",
    white: "#f0f0f0",
    pink: "#ffccff"
};

// DOM Elements
const coinCount = document.getElementById("coin-count");
const rollBtn = document.getElementById("roll-btn");
const resetBtn = document.getElementById("reset-btn");
const resetGameBtn = document.getElementById("reset-game-btn");
const soundControlBtn = document.getElementById("sound-control-btn");
const colorBoxes = document.querySelectorAll(".color-box");
const coins = document.querySelectorAll(".coin");
const dice = [document.getElementById("die1"), document.getElementById("die2"), document.getElementById("die3")];
const playersDiv = document.getElementById("players");
const resultMessage = document.getElementById("result-message");
const joinScreen = document.getElementById("join-screen");
const playerNameInput = document.getElementById("player-name");
const initialCoinsInput = document.getElementById("initial-coins");
const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const roomCodeInput = document.getElementById("room-code");
const submitJoinBtn = document.getElementById("submit-join-btn");
const roomCodeDisplay = document.getElementById("room-code-display");
const betDisplay = document.getElementById("bet-display");

// Audio Elements
const popSound = document.getElementById("pop-sound");
const tingSound = document.getElementById("ting-sound");
const backgroundMusic = document.getElementById("background-music");

// Initial state
rollBtn.disabled = true;
resetBtn.disabled = true;
backgroundMusic.volume = 0.5;
backgroundMusic.play();

// Room creation/joining
createRoomBtn.addEventListener("click", () => {
    const name = playerNameInput.value.trim();
    if (name) {
        createRoomBtn.style.display = "none";
        joinRoomBtn.style.display = "none";
        initialCoinsInput.style.display = "block";
        createRoomBtn.style.display = "inline-block";
        createRoomBtn.addEventListener("click", submitCreateRoom, { once: true });
    } else {
        alert("Please enter a name!");
    }
});

function submitCreateRoom() {
    const name = playerNameInput.value.trim();
    const initialCoins = parseInt(initialCoinsInput.value.trim()) || 1000;
    if (name) {
        socket.emit('createRoom', { name, initialCoins });
    } else {
        alert("Please enter a name!");
    }
}

joinRoomBtn.addEventListener("click", () => {
    createRoomBtn.style.display = "none";
    joinRoomBtn.style.display = "none";
    roomCodeInput.style.display = "block";
    submitJoinBtn.style.display = "block";
    initialCoinsInput.style.display = "none";
});

submitJoinBtn.addEventListener("click", () => {
    const name = playerNameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (name && code) {
        socket.emit('joinRoom', { name, passcode: code });
    } else {
        alert("Please enter both a name and a room code!");
    }
});

socket.on('roomCreated', ({ passcode, players, roomOwner, initialCoins }) => {
    roomCode = passcode;
    joinScreen.style.display = "none";
    roomCodeDisplay.textContent = `Room Code: ${passcode}`;
    roomCodeDisplay.style.display = "block";
    resetGameBtn.style.display = "inline-block";
    coinCount.textContent = initialCoins;
    enableBetting();
    updateBetDisplay(players);
});

socket.on('roomJoined', ({ passcode, players, roomOwner }) => {
    roomCode = passcode;
    joinScreen.style.display = "none";
    resetGameBtn.style.display = playerId === roomOwner ? "inline-block" : "none";
    coinCount.textContent = players.find(p => p.id === playerId).coins;
    enableBetting();
    updateBetDisplay(players);
});

socket.on('roomClosed', (msg) => {
    alert(msg);
    location.reload();
});

socket.on('serverClosed', (msg) => {
    alert(msg);
    location.reload();
});

socket.on('updatePlayers', ({ players, roomOwner }) => {
    const me = players.find(p => p.id === playerId);
    if (me) {
        coinCount.textContent = me.coins;
        colorBoxes.forEach(box => {
            const color = box.dataset.color;
            box.textContent = `${color.charAt(0).toUpperCase() + color.slice(1)} (${me.bets[color]})`;
        });
        resetBtn.disabled = colors.every(color => me.bets[color] === 0);
    }
    isRoomOwner = (playerId === roomOwner);
    rollBtn.style.display = isRoomOwner ? "inline-block" : "none";
    rollBtn.disabled = !isRoomOwner || !hasBet;
    resetGameBtn.style.display = isRoomOwner ? "inline-block" : "none";
    playersDiv.innerHTML = players.map(p => `
        <span class="player-info">
            ${p.name}: ${p.coins}
            ${p.id !== playerId && me.coins > 0 ? `
                <span class="give-coins-container">
                    <button class="give-coins-btn" data-id="${p.id}" data-amount="10">10</button>
                    <button class="give-coins-btn" data-id="${p.id}" data-amount="50">50</button>
                    <button class="give-coins-btn" data-id="${p.id}" data-amount="100">100</button>
                </span>
            ` : ""}
        </span>
    `).join("");
    document.querySelectorAll('.give-coins-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.id;
            const amount = parseInt(btn.dataset.amount);
            socket.emit('giveCoins', { roomCode, targetId, amount });
        });
    });
    updateBetDisplay(players);
});

socket.on('diceRolled', (results) => {
    console.log("Received Dice Results:", results);
    animateDice(results);
    resetBtn.disabled = true;
});

socket.on('payoutMessage', ({ dice, message }) => {
    setTimeout(() => {
        resultMessage.innerHTML = `
            Dice: ${dice.join(", ")}
            <div class="winners">
                ${message.length ? message.map(winner => `<span class="winner-item">${winner.name}: ${winner.amount}</span>`).join("") : "No winners this round"}
            </div>
        `;
        resultMessage.style.display = "block";
        if (!isMuted) tingSound.play();
        setTimeout(() => {
            resultMessage.style.display = "none";
            hasBet = false;
            rollBtn.disabled = !isRoomOwner || !hasBet;
            enableBetting();
        }, 3000);
    }, 1000);
});

socket.on('gameReset', (msg) => {
    resultMessage.innerHTML = msg;
    resultMessage.style.display = "block";
    if (!isMuted) tingSound.play();
    setTimeout(() => {
        resultMessage.style.display = "none";
    }, 3000);
});

socket.on('error', (msg) => {
    alert(msg);
});

socket.on('connect', () => {
    playerId = socket.id;
});

function enableBetting() {
    coins.forEach(coin => {
        coin.disabled = false;
        coin.classList.remove("selected");
    });
    colorBoxes.forEach(box => box.style.pointerEvents = "auto");
    selectedCoin = null;
}

function disableBetting() {
    coins.forEach(coin => {
        coin.disabled = true;
        coin.classList.remove("selected");
    });
    colorBoxes.forEach(box => box.style.pointerEvents = "none");
}

function placeBet(color, amount) {
    socket.emit('placeBet', { roomCode, color, amount });
    if (!isMuted) popSound.play();
    hasBet = true;
    if (isRoomOwner) rollBtn.disabled = false;
    resetBtn.disabled = false;
}

function resetBets() {
    socket.emit('resetBets', roomCode);
    hasBet = false;
    if (isRoomOwner) rollBtn.disabled = true;
    resetBtn.disabled = true;
}

function resetGame() {
    socket.emit('resetGame', roomCode);
}

function animateDice(results) {
    let rolls = 0;
    const rollInterval = setInterval(() => {
        dice.forEach(die => {
            const randomColor = colors[Math.floor(Math.random() * 6)];
            die.style.backgroundColor = colorMap[randomColor];
        });
        rolls++;
        if (rolls >= 5) {
            clearInterval(rollInterval);
            dice.forEach((die, index) => {
                die.style.backgroundColor = colorMap[results[index]];
            });
        }
    }, 100);
}

function updateBetDisplay(players) {
    const totalBets = { red: 0, yellow: 0, green: 0, blue: 0, white: 0, pink: 0 };
    players.forEach(player => {
        colors.forEach(color => {
            totalBets[color] += player.bets[color];
        });
    });
    betDisplay.innerHTML = colors.map(color => `
        <span class="bet-item" data-color="${color}">${color.charAt(0).toUpperCase() + color.slice(1)}: ${totalBets[color]}</span>
    `).join("");
}

function toggleSound() {
    isMuted = !isMuted;
    soundControlBtn.textContent = isMuted ? "🔇" : "🔊";
    backgroundMusic.muted = isMuted;
    popSound.muted = isMuted;
    tingSound.muted = isMuted;
}

coins.forEach(coin => {
    coin.addEventListener("click", () => {
        coins.forEach(c => c.classList.remove("selected"));
        coin.classList.add("selected");
        selectedCoin = parseInt(coin.dataset.value);
    });
});

colorBoxes.forEach(box => {
    box.addEventListener("click", () => {
        if (selectedCoin) {
            placeBet(box.dataset.color, selectedCoin);
        } else {
            alert("Select a coin amount first!");
        }
    });
});

rollBtn.addEventListener("click", () => {
    if (!hasBet) {
        alert("Place a bet first!");
        return;
    }
    socket.emit('rollDice', roomCode);
});

resetBtn.addEventListener("click", resetBets);
resetGameBtn.addEventListener("click", resetGame);
soundControlBtn.addEventListener("click", toggleSound);