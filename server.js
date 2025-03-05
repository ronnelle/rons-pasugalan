const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(__dirname));

const games = {};

function generatePasscode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function rollCubes() {
  const colors = ['red', 'blue', 'green', 'yellow', 'white', 'pink'];
  return [
    colors[Math.floor(Math.random() * 6)],
    colors[Math.floor(Math.random() * 6)],
    colors[Math.floor(Math.random() * 6)]
  ];
}

io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  socket.on('createGame', ({ name, potMoney, initialMoney }) => {
    const passcode = generatePasscode();
    games[passcode] = {
      creator: socket.id,
      players: [{ id: socket.id, name, money: parseInt(initialMoney), bets: {}, ready: false }],
      potMoney: parseInt(potMoney),
      initialPotMoney: parseInt(potMoney), // Store original pot money
      initialMoney: parseInt(initialMoney),
      rolled: false,
      cubes: [],
      totalBets: { red: 0, blue: 0, green: 0, yellow: 0, white: 0, pink: 0 }
    };
    socket.join(passcode);
    console.log('Game created:', passcode);
    socket.emit('gameCreated', { passcode, players: games[passcode].players, potMoney: games[passcode].potMoney, totalBets: games[passcode].totalBets });
  });

  socket.on('joinGame', ({ name, passcode }) => {
    const game = games[passcode];
    if (game) {
      game.players.push({ id: socket.id, name, money: game.initialMoney, bets: {}, ready: false });
      socket.join(passcode);
      console.log(`${name} joined game:`, passcode);
      io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
      socket.emit('gameJoined', { passcode, players: game.players, potMoney: game.potMoney, totalBets: game.totalBets });
    } else {
      socket.emit('error', 'Invalid passcode');
    }
  });

  socket.on('placeBet', ({ passcode, color, amount }) => {
    const game = games[passcode];
    const player = game.players.find(p => p.id === socket.id);
    if (player.money >= amount) {
      player.bets[color] = (player.bets[color] || 0) + amount;
      player.money -= amount;
      game.totalBets[color] += amount;
      io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
    }
  });

  socket.on('resetBets', ({ passcode }) => {
    const game = games[passcode];
    const player = game.players.find(p => p.id === socket.id);
    for (let color in player.bets) {
      player.money += player.bets[color];
      game.totalBets[color] -= player.bets[color];
    }
    player.bets = {};
    io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
  });

  socket.on('setReady', ({ passcode }) => {
    const game = games[passcode];
    const player = game.players.find(p => p.id === socket.id);
    player.ready = true;
    io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
  });

  socket.on('rollCubes', ({ passcode }) => {
    const game = games[passcode];
    if (socket.id === game.creator && !game.rolled) {
      console.log('Rolling cubes for:', passcode);
      game.cubes = rollCubes();
      game.rolled = true;
      let winners = [];
      let totalWinnings = 0;
      let totalLosses = 0;

      game.players.forEach(player => {
        let winnings = 0;
        let totalBet = 0;
        for (let color in player.bets) {
          const matches = game.cubes.filter(c => c === color).length;
          totalBet += player.bets[color];
          if (matches > 0) {
            winnings += (player.bets[color] * matches) + player.bets[color];
          }
        }
        if (winnings > 0) {
          player.money += winnings;
          totalWinnings += winnings - totalBet;
          winners.push({ name: player.name, winnings });
          console.log(`Player ${player.name} won ${winnings}`);
        } else {
          totalLosses += totalBet;
          console.log(`Player ${player.name} lost ${totalBet}`);
        }
        player.bets = {};
        player.ready = false;
      });

      const netChange = totalWinnings - totalLosses;
      if (netChange !== 0) {
        game.potMoney -= netChange;
        console.log(`Pot money adjusted by ${-netChange}, now ${game.potMoney}`);
      } else {
        console.log(`Pot money unchanged at ${game.potMoney}`);
      }

      game.totalBets = { red: 0, blue: 0, green: 0, yellow: 0, white: 0, pink: 0 };
      game.rolled = false;
      io.to(passcode).emit('rollResult', { 
        cubes: game.cubes, 
        players: game.players, 
        potMoney: game.potMoney, 
        totalBets: game.totalBets, 
        winners 
      });
      if (game.potMoney <= 0) {
        io.to(passcode).emit('gameOver');
        delete games[passcode];
      }
    } else {
      console.log('Roll failed: not creator or already rolled');
    }
  });

  socket.on('resetGame', ({ passcode }) => {
    const game = games[passcode];
    if (socket.id === game.creator) {
      console.log('Resetting game:', passcode);
      game.players.forEach(player => {
        player.money = game.initialMoney;
        player.bets = {};
        player.ready = false;
      });
      game.potMoney = game.initialPotMoney; // Use original pot money
      game.totalBets = { red: 0, blue: 0, green: 0, yellow: 0, white: 0, pink: 0 };
      game.cubes = [];
      game.rolled = false;
      io.to(passcode).emit('gameReset', { 
        players: game.players, 
        potMoney: game.potMoney, 
        totalBets: game.totalBets 
      });
    } else {
      console.log('Reset failed: not creator');
    }
  });

  socket.on('donate', ({ passcode, toPlayerId, amount }) => {
    const game = games[passcode];
    const fromPlayer = game.players.find(p => p.id === socket.id);
    const toPlayer = game.players.find(p => p.id === toPlayerId);
    if (fromPlayer.money >= amount) {
      fromPlayer.money -= amount;
      toPlayer.money += amount;
      io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    for (let passcode in games) {
      const game = games[passcode];
      game.players = game.players.filter(p => p.id !== socket.id);
      if (game.players.length === 0) delete games[passcode];
      else io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
    }
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Server running'));