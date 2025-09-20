import { Client } from "colyseus.js"

const client = new Client("ws://localhost:3000")
const quickplayBtn = document.getElementById('quickplayBtn')
const statusDiv = document.getElementById('status')
const lobbyInfoDiv = document.getElementById('lobbyInfo') 
const playerListDiv = document.getElementById('playerList')
const lobbyContainer = document.getElementById('lobbyContainer')
const gameSceneDiv = document.getElementById('gameScene')
const gameStatusDiv = document.getElementById('gameStatus')
const gamePlayersDiv = document.getElementById('gamePlayers')
const roomIdInput = document.getElementById('roomIdInput');
const joinBtn = document.getElementById('joinBtn');

let room
let username
let currentPlayers = []; // Track the latest player list

quickplayBtn.addEventListener('click', async () => {
    username = prompt("Enter your username:")
    if (!username) {
        statusDiv.textContent = "Username is required."
        lobbyInfoDiv.textContent = ""
        return
    }
    statusDiv.textContent = "Searching for a room..."
    lobbyInfoDiv.textContent = ""
    try {
        // Find a lobby that hasn't started and isn't full
        const rooms = await client.getAvailableRooms("my_room");
        let roomToJoin = rooms.find(r =>
            r.metadata && r.metadata.started === false &&
            r.clients < r.maxClients
        );

        if (roomToJoin) {
            room = await client.joinById(roomToJoin.roomId, { username });
        } else {
            room = await client.create("my_room", { username });
        }

        // Show lobby info (does not get overwritten by status updates)
        lobbyInfoDiv.innerHTML = `Joined lobby: <b>${room.id}</b><br>Your username: <b>${username}</b><br><small>Share this Lobby ID for others to join:</small><br><b>${room.id}</b>`;

        // Request the current player list
        room.send("get-player-list");

        room.onMessage("status", (msg) => {
            if (gameSceneDiv.style.display === "none") {
                statusDiv.textContent = msg
            }
        })

        room.onMessage("game-status", (msg) => {
            if (gameSceneDiv.style.display !== "none") {
                gameStatusDiv.textContent = msg
            }
        })

        // Listen for player list updates
        room.onMessage("player-list", (usernames) => {
            currentPlayers = usernames; // Save for later use
            if (gameSceneDiv.style.display === "none") {
                playerListDiv.innerHTML = "<b>Players in lobby:</b><br>" + usernames.map(u => `• ${u}`).join("<br>")
            } else {
                gamePlayersDiv.innerHTML = "<b>Players in game:</b><br>" + usernames.map(u => `• ${u}`).join("<br>")
            }
        })

        // Listen for instance started
        room.onMessage("instance-started", (data) => {
            // Hide lobby, show game scene
            lobbyContainer.style.display = "none"
            playerListDiv.style.display = "none"
            gameSceneDiv.style.display = "block"
            gameStatusDiv.innerHTML = `<b>${data.message}</b><br>Lobby: <b>${room.id}</b><br>Your username: <b>${username}</b>`
            // Immediately display the current player list in the game scene
            gamePlayersDiv.innerHTML = "<b>Players in game:</b><br>" + currentPlayers.map(u => `• ${u}`).join("<br>")
        })

        // Example: handle room events
        room.onMessage("room-event", (data) => {
            // handle room event
        })
    } catch (e) {
        statusDiv.textContent = "Failed to join room."
        lobbyInfoDiv.textContent = ""
    }
})

// Join Room by ID when Enter is pressed in the input
roomIdInput.addEventListener('keydown', async (e) => {
    if (e.key === "Enter") {
        joinRoomById();
    }
});

// Or when the Join Room button is clicked
joinBtn.addEventListener('click', joinRoomById);

async function joinRoomById() {
    const roomId = roomIdInput.value.trim();
    if (!roomId) {
        statusDiv.textContent = "Please enter a Lobby ID.";
        return;
    }
    username = prompt("Enter your username:");
    if (!username) {
        statusDiv.textContent = "Username is required.";
        lobbyInfoDiv.textContent = "";
        return;
    }
    statusDiv.textContent = "Joining room...";
    lobbyInfoDiv.textContent = "";
    try {
        room = await client.joinById(roomId, { username });

        // Show lobby info
        lobbyInfoDiv.innerHTML = `Joined lobby: <b>${room.id}</b><br>Your username: <b>${username}</b><br><small>Share this Lobby ID for others to join:</small><br><b>${room.id}</b>`;

        // Request the current player list
        room.send("get-player-list");

        room.onMessage("status", (msg) => {
            if (gameSceneDiv.style.display === "none") {
                statusDiv.textContent = msg
            }
        })

        room.onMessage("game-status", (msg) => {
            if (gameSceneDiv.style.display !== "none") {
                gameStatusDiv.textContent = msg
            }
        })

        room.onMessage("player-list", (usernames) => {
            currentPlayers = usernames;
            if (gameSceneDiv.style.display === "none") {
                playerListDiv.innerHTML = "<b>Players in lobby:</b><br>" + usernames.map(u => `• ${u}`).join("<br>")
            } else {
                gamePlayersDiv.innerHTML = "<b>Players in game:</b><br>" + usernames.map(u => `• ${u}`).join("<br>")
            }
        })

        room.onMessage("instance-started", (data) => {
            lobbyContainer.style.display = "none"
            playerListDiv.style.display = "none"
            gameSceneDiv.style.display = "block"
            gameStatusDiv.innerHTML = `<b>${data.message}</b><br>Lobby: <b>${room.id}</b><br>Your username: <b>${username}</b>`
            gamePlayersDiv.innerHTML = "<b>Players in game:</b><br>" + currentPlayers.map(u => `• ${u}`).join("<br>")
        })

        room.onMessage("room-event", (data) => {
            // handle room event
        })
    } catch (e) {
        statusDiv.textContent = "Failed to join room. It may not exist or is already full/started.";
        lobbyInfoDiv.textContent = "";
    }
}