import pkg from "colyseus";
const { Room } = pkg;
import { GameScene } from "./gamescene.js";

export class MyRoom extends Room {
    onCreate(options) {
        this.maxClients = 2; // Use Colyseus built-in property
        this.players = [];
        this.gameScene = null;
        this.setMetadata({ started: false }); // Mark as lobby

        this.onMessage("room-event", (client, message) => {
            this.broadcast("room-event", { clientId: client.sessionId, ...message });
        });

        // Respond to player list requests
        this.onMessage("get-player-list", (client) => {
            client.send("player-list", this.players.map(p => p.username));
        });
    }

    async onAuth(client, options, req) {
        // Prevent joining if game already started
        if (this.metadata?.started) {
            throw new Error("Game already started");
        }
        return true;
    }

    onJoin(client, options) {
        client.username = options.username || "Anonymous";
        this.players.push({ sessionId: client.sessionId, username: client.username });

        if (this.gameScene) {
            this.broadcast("game-status", `Player ${client.username} joined the game.`);
        } else {
            this.broadcast("status", `Player ${client.username} joined.`);
        }
        this.broadcastPlayerList();

        // If lobby is full, start the game scene
        if (this.clients.length === this.maxClients && !this.gameScene) {
            this.setMetadata({ started: true }); // Mark as started
            this.gameScene = new GameScene(this);
            this.gameScene.start();
        }
    }

    onLeave(client, consented) {
        this.players = this.players.filter(p => p.sessionId !== client.sessionId);

        if (this.gameScene) {
            this.broadcast("game-status", `Player ${client.username || client.sessionId} left the game.`);
            this.gameScene.onPlayerLeft(client);
        } else {
            this.broadcast("status", `Player ${client.username || client.sessionId} left.`);
        }
        this.broadcastPlayerList();
    }

    broadcastPlayerList() {
        this.broadcast("player-list", this.players.map(p => p.username));
    }
}