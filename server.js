const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Game state: rooms as an object with passcodes as keys
const rooms = {};

const colors = ["red", "yellow", "green", "blue", "white", "pink"];
const colorMap = {
    red: "#ff9999",
    yellow: "#ffff99",
    green: "#99ff99",
    blue: "#99ccff",
    white: "#f0f0f0",
    pink: "#ffccff"
};

// Generate a 6-character random passcode
function generatePasscode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let passcode = '';
    for (let i = 0; i < 6; i++) {
        passcode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return passcode;
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Create a new room with custom initial coins
    socket.on('createRoom', ({ name, initialCoins }) => {
        const passcode = generatePasscode();
        const startingCoins = Math.max(1, initialCoins || 1000); // Ensure at least 1 coin, default to 1000
        rooms[passcode] = {
            players: [{ id: socket.id, name, coins: startingCoins, bets: { red: 0, yellow: 0, green: 0, blue: 0, white: 0, pink: 0 } }],
            diceResults: [],
            roomOwner: socket.id,
            initialCoins: startingCoins // Store for joiners
        };
        socket.join(passcode);
        socket.emit('roomCreated', { passcode, players: rooms[passcode].players, roomOwner: socket.id, initialCoins: startingCoins });
        console.log(`${name} created room ${passcode} with initial coins ${startingCoins}`);
    });

    // Join an existing room with room's initial coins
    socket.on('joinRoom', ({ name, passcode }) => {
        if (rooms[passcode]) {
            const startingCoins = rooms[passcode].initialCoins;
            const player = { id: socket.id, name: name || `Player${rooms[passcode].players.length + 1}`, coins: startingCoins, bets: { red: 0, yellow: 0, green: 0, blue: 0, white: 0, pink: 0 } };
            rooms[passcode].players.push(player);
            socket.join(passcode);
            io.to(passcode).emit('updatePlayers', { players: rooms[passcode].players, roomOwner: rooms[passcode].roomOwner });
            socket.emit('roomJoined', { passcode, players: rooms[passcode].players, roomOwner: rooms[passcode].roomOwner });
            console.log(`${name} joined room ${passcode}`);
        } else {
            socket.emit('error', 'Invalid passcode!');
        }
    });

    // Player places a bet
    socket.on('placeBet', ({ roomCode, color, amount }) => {
        const room = rooms[roomCode];
        const player = room?.players.find(p => p.id === socket.id);
        if (player && player.coins >= amount) {
            player.bets[color] += amount;
            player.coins -= amount;
            io.to(roomCode).emit('updatePlayers', { players: room.players, roomOwner: room.roomOwner });
            console.log(`${player.name} bet ${amount} on ${color} in room ${roomCode}`);
        }
    });

    // Player resets bets
    socket.on('resetBets', (roomCode) => {
        const room = rooms[roomCode];
        const player = room?.players.find(p => p.id === socket.id);
        if (player) {
            colors.forEach(color => {
                player.coins += player.bets[color];
                player.bets[color] = 0;
            });
            io.to(roomCode).emit('updatePlayers', { players: room.players, roomOwner: room.roomOwner });
            console.log(`${player.name} reset their bets in room ${roomCode}`);
        }
    });

    // Player rolls dice (only room owner)
    socket.on('rollDice', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.roomOwner) {
            socket.emit('error', 'Only the room owner can roll the dice!');
            return;
        }
        room.diceResults = [
            colors[Math.floor(Math.random() * 6)],
            colors[Math.floor(Math.random() * 6)],
            colors[Math.floor(Math.random() * 6)]
        ];
        io.to(roomCode).emit('diceRolled', room.diceResults);
        console.log('Dice rolled by owner in room', roomCode, ':', room.diceResults);
        calculatePayout(roomCode);
    });

    // Player gives coins
    socket.on('giveCoins', ({ roomCode, targetId, amount }) => {
        const room = rooms[roomCode];
        const giver = room?.players.find(p => p.id === socket.id);
        const receiver = room?.players.find(p => p.id === targetId);
        if (giver && receiver && giver.coins >= amount && amount > 0 && giver.id !== receiver.id) {
            giver.coins -= amount;
            receiver.coins += amount;
            io.to(roomCode).emit('updatePlayers', { players: room.players, roomOwner: room.roomOwner });
            console.log(`${giver.name} gave ${amount} coins to ${receiver.name} in room ${roomCode}`);
        }
    });

    // Owner resets game
    socket.on('resetGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.roomOwner) {
            socket.emit('error', 'Only the room owner can reset the game!');
            return;
        }
        room.players.forEach(player => {
            player.coins = room.initialCoins; // Reset to room's initial coins
            player.bets = { red: 0, yellow: 0, green: 0, blue: 0, white: 0, pink: 0 };
        });
        room.diceResults = [];
        io.to(roomCode).emit('updatePlayers', { players: room.players, roomOwner: room.roomOwner });
        io.to(roomCode).emit('gameReset', 'The game has been reset by the room owner.');
        console.log(`Room ${roomCode} reset by owner`);
    });

    // Calculate and broadcast payouts
    function calculatePayout(roomCode) {
        const room = rooms[roomCode];
        const payoutMessage = [];
        room.players.forEach(player => {
            let winnings = 0;
            colors.forEach(color => {
                const matches = room.diceResults.filter(result => result === color).length;
                if (matches > 0 && player.bets[color] > 0) {
                    winnings += player.bets[color] * matches * 2;
                }
            });
            player.coins += winnings;
            if (winnings > 0) {
                payoutMessage.push({ name: player.name, amount: winnings });
            }
            player.bets = { red: 0, yellow: 0, green: 0, blue: 0, white: 0, pink: 0 };
        });
        io.to(roomCode).emit('updatePlayers', { players: room.players, roomOwner: room.roomOwner });
        io.to(roomCode).emit('payoutMessage', { dice: room.diceResults, message: payoutMessage });
    }

    // Handle disconnection
    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                if (socket.id === room.roomOwner) {
                    io.to(roomCode).emit('roomClosed', 'Room owner left, room closed.');
                    delete rooms[roomCode];
                    console.log(`Room ${roomCode} deleted due to owner disconnect`);
                } else if (room.players.length > 0) {
                    io.to(roomCode).emit('updatePlayers', { players: room.players, roomOwner: room.roomOwner });
                }
                console.log('Player disconnected from room', roomCode, ':', socket.id);
                break;
            }
        }
    });
});

// Handle server shutdown
server.on('close', () => {
    for (const roomCode in rooms) {
        io.to(roomCode).emit('serverClosed', 'Server has shut down, all rooms closed.');
        delete rooms[roomCode];
    }
    console.log('Server closed, all rooms terminated');
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown on process termination
process.on('SIGINT', () => {
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});