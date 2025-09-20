export class GameScene {
    constructor(room) {
        this.room = room;
    }

    start() {
        this.room.broadcast("instance-started", { message: "Instance started" });
    }

    onPlayerLeft(client) {
        this.room.broadcast("game-status", `Player ${client.username || client.sessionId} left the game.`);
    }
}