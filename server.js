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

function generatePlayerId() {
  return Math.random().toString(36).substr(2, 10); // Unique player ID
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

  socket.on('createGame', ({ name, potMoney, initialMoney, playerId }) => {
    const passcode = generatePasscode();
    const newPlayerId = playerId || generatePlayerId();
    games[passcode] = {
      creator: newPlayerId,
      players: [{ id: newPlayerId, socketId: socket.id, name, money: parseInt(initialMoney), bets: {}, ready: false }],
      potMoney: parseInt(potMoney),
      initialPotMoney: parseInt(potMoney),
      initialMoney: parseInt(initialMoney),
      rolled: false,
      cubes: [],
      totalBets: { red: 0, blue: 0, green: 0, yellow: 0, white: 0, pink: 0 }
    };
    socket.join(passcode);
    console.log('Game created:', passcode);
    socket.emit('gameCreated', { 
      passcode, 
      playerId: newPlayerId, 
      players: games[passcode].players, 
      potMoney: games[passcode].potMoney, 
      totalBets: games[passcode].totalBets 
    });
  });

  socket.on('joinGame', ({ name, passcode, playerId }) => {
    const game = games[passcode];
    if (game) {
      const existingPlayer = game.players.find(p => p.id === playerId);
      if (existingPlayer) {
        // Reconnect existing player
        existingPlayer.socketId = socket.id;
        socket.join(passcode);
        console.log(`${name} rejoined game:`, passcode);
        io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
        socket.emit('gameJoined', { 
          passcode, 
          playerId, 
          players: game.players, 
          potMoney: game.potMoney, 
          totalBets: game.totalBets 
        });
      } else {
        // New player
        const newPlayerId = playerId || generatePlayerId();
        game.players.push({ id: newPlayerId, socketId: socket.id, name, money: game.initialMoney, bets: {}, ready: false });
        socket.join(passcode);
        console.log(`${name} joined game:`, passcode);
        io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
        socket.emit('gameJoined', { 
          passcode, 
          playerId: newPlayerId, 
          players: game.players, 
          potMoney: game.potMoney, 
          totalBets: game.totalBets 
        });
      }
    } else {
      socket.emit('error', 'Invalid passcode');
    }
  });

  socket.on('placeBet', ({ passcode, color, amount }) => {
    const game = games[passcode];
    const player = game.players.find(p => p.socketId === socket.id);
    if (player && player.money >= amount) {
      player.bets[color] = (player.bets[color] || 0) + amount;
      player.money -= amount;
      game.totalBets[color] += amount;
      io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
    }
  });

  socket.on('resetBets', ({ passcode }) => {
    const game = games[passcode];
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) {
      for (let color in player.bets) {
        player.money += player.bets[color];
        game.totalBets[color] -= player.bets[color];
      }
      player.bets = {};
      io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
    }
  });

  socket.on('toggleReady', ({ passcode }) => {
    const game = games[passcode];
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) {
      player.ready = !player.ready;
      console.log(`${player.name} toggled ready to ${player.ready}`);
      io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
    }
  });

  socket.on('rollCubes', ({ passcode }) => {
    const game = games[passcode];
    const player = game.players.find(p => p.socketId === socket.id);
    if (player && player.id === game.creator && !game.rolled) {
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
    const player = game.players.find(p => p.socketId === socket.id);
    if (player && player.id === game.creator) {
      console.log('Resetting game:', passcode);
      game.players.forEach(player => {
        player.money = game.initialMoney;
        player.bets = {};
        player.ready = false;
      });
      game.potMoney = game.initialPotMoney;
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
    const fromPlayer = game.players.find(p => p.socketId === socket.id);
    const toPlayer = game.players.find(p => p.id === toPlayerId);
    if (fromPlayer && toPlayer && fromPlayer.money >= amount) {
      fromPlayer.money -= amount;
      toPlayer.money += amount;
      io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    for (let passcode in games) {
      const game = games[passcode];
      const player = game.players.find(p => p.socketId === socket.id);
      if (player) {
        if (player.id === game.creator) {
          console.log(`Creator left, deleting game: ${passcode}`);
          io.to(passcode).emit('creatorLeft');
          delete games[passcode];
        } else {
          player.socketId = null; // Mark as disconnected, keep player data
          io.to(passcode).emit('playerUpdate', { players: game.players, totalBets: game.totalBets });
        }
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Server running'));