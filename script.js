const socket = io({ transports: ['websocket'] });
let passcode = null;
let myId = null;
let initialMoney = null;

const popSound = new Audio('audio/pop.wav');
const tingSound = new Audio('audio/ting.wav');

console.log('Page loaded, start screen should be visible');

function showCreate() {
  console.log('Showing create form');
  document.getElementById('create-form').classList.remove('hidden');
  document.getElementById('join-form').classList.add('hidden');
}

function showJoin() {
  console.log('Showing join form');
  document.getElementById('join-form').classList.remove('hidden');
  document.getElementById('create-form').classList.add('hidden');
}

function createGame() {
  const name = document.getElementById('name').value;
  const potMoney = document.getElementById('pot-money').value;
  const initialMoneyInput = document.getElementById('initial-money').value;
  if (name && potMoney && initialMoneyInput) {
    console.log('Creating game with:', { name, potMoney, initialMoney: initialMoneyInput });
    initialMoney = parseInt(initialMoneyInput);
    socket.emit('createGame', { name, potMoney, initialMoney });
  } else {
    document.getElementById('error').textContent = 'Please fill all fields';
  }
}

function joinGame() {
  const name = document.getElementById('name').value;
  const inputPasscode = document.getElementById('passcode').value.toUpperCase();
  if (name && inputPasscode) {
    console.log('Joining game with:', { name, passcode: inputPasscode });
    socket.emit('joinGame', { name, passcode: inputPasscode });
  } else {
    document.getElementById('error').textContent = 'Please enter name and passcode';
  }
}

socket.on('gameCreated', ({ passcode: p, players, potMoney, totalBets }) => {
  console.log('Game created:', { passcode: p, players, potMoney });
  passcode = p;
  myId = socket.id;
  startGame(p, players, potMoney, totalBets);
});

socket.on('gameJoined', ({ passcode: p, players, potMoney, totalBets }) => {
  console.log('Game joined:', { passcode: p, players, potMoney });
  passcode = p;
  myId = socket.id;
  initialMoney = players.find(p => p.id === myId).money;
  startGame(p, players, potMoney, totalBets);
});

socket.on('error', (msg) => {
  console.log('Error received:', msg);
  document.getElementById('error').textContent = msg;
});

function startGame(p, players, potMoney, totalBets) {
  console.log('Starting game with passcode:', p);
  document.getElementById('start-screen').classList.remove('visible');
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  document.getElementById('game-screen').classList.add('visible');
  document.getElementById('room-passcode').textContent = p;
  document.getElementById('pot-money-display').textContent = potMoney || 0;
  updatePlayers(players, totalBets);
  if (socket.id === players[0].id) {
    console.log('I am the creator, showing roll and reset buttons');
    document.getElementById('roll-btn').classList.remove('hidden');
    document.getElementById('reset-game-btn').classList.remove('hidden');
  }
}

socket.on('playerUpdate', ({ players, totalBets }) => {
  console.log('Player update:', players);
  updatePlayers(players, totalBets);
});

function updatePlayers(players, totalBets) {
  const playersDiv = document.getElementById('players');
  playersDiv.innerHTML = '';
  players.forEach(p => {
    const betColors = {
      red: '#ff0000',
      blue: '#0000ff',
      green: '#00ff00',
      yellow: '#ffff00',
      white: '#ffffff',
      pink: '#ff69b4'
    };
    const betEntries = Object.entries(p.bets).map(([color, amount]) => 
      `<span style="color: ${betColors[color]}">${color}: ${amount}</span>`
    ).join(', ');
    const div = document.createElement('div');
    div.innerHTML = `
      ${p.name}: $${p.money} ${p.ready ? '<span style="color: green;">ready</span>' : ''}
      <button onclick="donate('${p.id}')">Give</button>
      <div>Bets: ${betEntries || 'None'}</div>
    `;
    playersDiv.appendChild(div);
    if (p.id === myId) {
      document.getElementById('ready-btn').classList.toggle('ready', p.ready);
      document.getElementById('ready-btn').classList.toggle('not-ready', !p.ready);
    }
  });

  const player = players.find(p => p.id === myId);
  if (player) {
    document.getElementById('total-red').textContent = player.bets.red || 0;
    document.getElementById('total-blue').textContent = player.bets.blue || 0;
    document.getElementById('total-green').textContent = player.bets.green || 0;
    document.getElementById('total-yellow').textContent = player.bets.yellow || 0;
    document.getElementById('total-white').textContent = player.bets.white || 0;
    document.getElementById('total-pink').textContent = player.bets.pink || 0;
  }
}

function bet(color) {
  const amount = parseInt(document.getElementById('denomination').value);
  console.log('Placing bet:', { color, amount });
  popSound.play();
  socket.emit('placeBet', { passcode, color, amount });
}

function resetBets() {
  console.log('Resetting bets');
  socket.emit('resetBets', { passcode });
}

function setReady() {
  console.log('Toggling ready state');
  socket.emit('toggleReady', { passcode });
}

function rollCubes() {
  console.log('Roll button clicked, passcode:', passcode);
  if (passcode) {
    socket.emit('rollCubes', { passcode });
    console.log('Emitted rollCubes event');
  } else {
    console.log('No passcode, cannot roll');
  }
}

function resetGame() {
  console.log('Reset game clicked, passcode:', passcode);
  if (passcode) {
    socket.emit('resetGame', { passcode });
    console.log('Emitted resetGame event');
  } else {
    console.log('No passcode, cannot reset');
  }
}

function animateRoll(cubesDiv) {
  console.log('Animating roll');
  cubesDiv.innerHTML = '';
  const colors = ['red', 'blue', 'green', 'yellow', 'white', 'pink'];
  let rolls = 0;
  const maxRolls = 15;
  const interval = setInterval(() => {
    cubesDiv.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const randomColor = colors[Math.floor(Math.random() * 6)];
      cubesDiv.innerHTML += `<div class="cube ${randomColor}">${randomColor}</div>`;
    }
    rolls++;
    if (rolls >= maxRolls) {
      clearInterval(interval);
      console.log('Animation complete');
    }
  }, 100);
}

socket.on('rollResult', ({ cubes, players, potMoney, totalBets, winners }) => {
  console.log('Roll result received:', { cubes, potMoney, winners });
  const cubesDiv = document.getElementById('cubes');
  animateRoll(cubesDiv);
  setTimeout(() => {
    cubesDiv.innerHTML = cubes.map(c => `<div class="cube ${c}">${c}</div>`).join('');
    document.getElementById('pot-money-display').textContent = potMoney || 0;
    updatePlayers(players, totalBets);
    tingSound.play();

    console.log('Processing GIFs and winners for player ID:', myId);
    const gifOverlay = document.getElementById('result-gif');
    const gifImage = document.getElementById('gif-image');
    const player = players.find(p => p.id === myId);
    const isWinner = winners && winners.some(w => w.name === player.name);

    if (player) {
      console.log(`Player ${player.name} money: ${player.money}, initial: ${initialMoney}, isWinner: ${isWinner}`);
      if (isWinner) {
        gifImage.src = 'img/win.gif';
        gifOverlay.classList.remove('hidden');
        gifOverlay.classList.add('visible');
        console.log('Showing win.gif for', player.name);
      } else if (player.money < initialMoney) {
        gifImage.src = 'img/lose.gif';
        gifOverlay.classList.remove('hidden');
        gifOverlay.classList.add('visible');
        console.log('Showing lose.gif for', player.name);
      }
      setTimeout(() => {
        gifOverlay.classList.remove('visible');
        gifOverlay.classList.add('hidden');
        console.log('Hiding GIF overlay');
      }, 3000);
    } else {
      console.log('Player not found in players list');
    }

    if (winners && winners.length > 0) {
      console.log('Showing winners overlay');
      const overlay = document.getElementById('winner-overlay');
      overlay.innerHTML = winners.map(w => `${w.name} won ${w.winnings}!`).join('<br>');
      overlay.classList.remove('hidden');
      overlay.classList.add('visible');
      setTimeout(() => {
        overlay.classList.remove('visible');
        overlay.classList.add('hidden');
        console.log('Hiding winners overlay');
      }, 4000);
    } else {
      console.log('No winners to display');
    }
  }, 1600);
});

socket.on('gameOver', () => {
  console.log('Game over');
  document.getElementById('game-over').classList.remove('hidden');
});

socket.on('gameReset', ({ players, potMoney, totalBets }) => {
  console.log('Game reset received:', { players, potMoney });
  document.getElementById('pot-money-display').textContent = potMoney || 0;
  document.getElementById('cubes').innerHTML = '';
  document.getElementById('game-over').classList.add('hidden');
  updatePlayers(players, totalBets);
});

function donate(toPlayerId) {
  const amount = prompt('How much to donate?');
  if (amount) {
    console.log('Donating:', { toPlayerId, amount });
    socket.emit('donate', { passcode, toPlayerId, amount: parseInt(amount) });
  }
}

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('connect_error', (err) => {
  console.error('Socket.IO connection error:', err);
});