// Entry file required by Vite; intentionally minimal so the page stays empty
// You can add client code here later.
//
import Phaser from 'phaser';
import GameScene from './GameScene.js';

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#000000', // fallback
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 }, // top-down view = no gravity
      debug: false
    }
  },
  scene: [GameScene]
};

new Phaser.Game(config);

