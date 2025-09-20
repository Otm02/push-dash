import Phaser from 'phaser';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    // No assets needed for this simple setup
  }

  create() {
    // Set background color to black
    this.cameras.main.setBackgroundColor('#000000');

    // Create a square player using a physics-enabled rectangle
    this.player = this.add.rectangle(400, 300, 40, 40, 0xffffff); // white square
    this.physics.add.existing(this.player); // attach physics

    this.player.body.setCollideWorldBounds(true); // prevent from leaving bounds

    // Input (arrow keys or WASD)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.WASD = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });
  }

  update() {
    const speed = 200;
    const body = this.player.body;

    body.setVelocity(0);

    // Allow arrow keys or WASD for movement
    if (this.cursors.left.isDown || this.WASD.left.isDown) {
      body.setVelocityX(-speed);
    } else if (this.cursors.right.isDown || this.WASD.right.isDown) {
      body.setVelocityX(speed);
    }

    if (this.cursors.up.isDown || this.WASD.up.isDown) {
      body.setVelocityY(-speed);
    } else if (this.cursors.down.isDown || this.WASD.down.isDown) {
      body.setVelocityY(speed);
    }
  }
}


