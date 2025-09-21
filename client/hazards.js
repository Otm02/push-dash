//import phaser

import Phaser from "phaser";

class BulletHell extends Phaser.Scene {


  preload() {
    //images
    this.load.image("knife", "assets/knife.png");
    this.load.image("spike warning", "assets/spike warning.png");
    this.load.image("spike", "assets/spike.png");

    //sounds
    this.load.audio("clank", "assets/metal-pipe.mp3");

    //this.load.audio("spike", "assets/spike.mp3");

  }

  create() {

    //player, a green square
    this.player = this.add.rectangle(400, 300, 32, 32, 0x69f50c);
    this.physics.add.existing(this.player);

    //keyboard arrows (phaser calls these cursor)
    this.cursors = this.input.keyboard.createCursorKeys();

    //bullets (projectiles knives) we are gonna have many knives, so we are adding them as a group, not like laser and trap
    this.bullets = this.physics.add.group();

    // Spawn projectiles every second
    this.time.addEvent({
      delay: 1000,
      callback: () => this.spawnProjectile(),
      loop: true,
    });

    //spawn laser
    this.time.addEvent({
    delay: 3000,
    callback: () => this.spawnLaser(),
    loop: true});

    //spawn circle

    this.time.addEvent({
        delay:6000,
        callback: () => this.spawnTraps(),
        loop:true
    });
  }

  update() {
    //player speed
    const speed = 200;
    this.player.body.setVelocity(0);

    if (this.cursors.left.isDown) {
      this.player.body.setVelocityX(-speed);
    } else if (this.cursors.right.isDown) {
      this.player.body.setVelocityX(speed);
    }

    if (this.cursors.up.isDown) {
      this.player.body.setVelocityY(-speed);
    } else if (this.cursors.down.isDown) {
      this.player.body.setVelocityY(speed);
    }
  }

  //knives
  spawnProjectile() {

    //define edges of canvas
    const edges = ["top", "bottom", "left", "right"];
    const edge = Phaser.Utils.Array.GetRandom(edges);

    //spawn randomly at edges defined below
    let x, y;
    if (edge === "top") {
      x = Phaser.Math.Between(0, 800);
      y = 0;
    } else if (edge === "bottom") {
      x = Phaser.Math.Between(0, 800);
      y = 600;
    } else if (edge === "left") {
      x = 0;
      y = Phaser.Math.Between(0, 600);
    } else {
      x = 800;
      y = Phaser.Math.Between(0, 600);
    }

    //create red square bullet
    //const bullet = this.add.rectangle(x, y, 8, 20, 0xf50c0c);

    //knife asset
    const bullet = this.physics.add.image(x,y,"knife");    
    this.physics.add.existing(bullet);
    this.bullets.add(bullet);

    //aim at player's position at shooting. (aka opposite of "vector")
    const dx = this.player.x - x; //difference in x position between bullet and player.
    const dy = this.player.y - y;
    const len = Math.sqrt(dx * dx + dy * dy); //trigo length

    //bullet speed
    const speed = 150;
    bullet.body.setVelocity((dx / len) * speed, (dy / len) * speed); //we divide to normalize it to have a unit vector
    
    //rotate bullet (knife) to player (+pi/2 cause phaser start on y axis, not x axis)
    bullet.rotation = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y) + Math.PI / 2;
   
    //collisions for bullet
    this.physics.add.overlap(this.player, this.bullets, () => {
      this.sound.play("clank");
      this.scene.restart(); // reset scene
    });
}

//laser
spawnLaser(){
    //2 directions, whole map. Straight axis
    const directions = ["horizontal", "vertical"];
    const dir = Phaser.Utils.Array.GetRandom(directions);

    let x, y, width, height; //x & y are the center of the background (800 width, 600 height.)

    if (dir === "horizontal") {
        // horizontal laser across the width
        x = 400; //half of 800
        y = Phaser.Math.Between(25, 575); //random vertical position, laser counts from middle of rect. so half laser
        width = 800;
        height = 50; //size of laser
    } else {
        // vertical laser across the height
        x = Phaser.Math.Between(25, 775); //random hor
        y = 300; //half of 600
        width = 50; //size of laser
        height = 600;
    }

    //telegraph laser, with less opacity (transparency) 0.25
    const telegraph = this.add.rectangle(x, y, width, height, 0xe6d87, 0.25);

    //delay before firing
    this.time.delayedCall(1000, () => { //after 1000 ms, destroy and whole other methods too.
        //destroy the telegraph
        telegraph.destroy();

        //actual laser
        const laser = this.add.rectangle(x, y, width, height, 0x02c4fa);
        this.physics.add.existing(laser, true);

        //collision
        this.physics.add.overlap(this.player, laser, () => {
            this.sound.play("clank");
            this.scene.restart();
        });

        //Destroy laser after some time, leave it on screen a while
        this.time.delayedCall(500, () => laser.destroy());
    });
    }


    //traps
    spawnTraps(){
        const radius = 50;
        
        //initially did a circle. now spike images
        //random position on the map, without being out of bounds. x+ = radius distance, max of edge-rad
        const x = Phaser.Math.Between(radius,800-radius);
        const y = Phaser.Math.Between(radius,600-radius);

        //telegraph
        //const telegraph = this.add.circle(x,y,radius, 0x45164f,0.25);

        //spike image
        const telegraph = this.physics.add.image(x,y,"spike warning");

        this.time.delayedCall(1000, () =>{
            telegraph.destroy();

            //trap
            //const trap = this.add.circle(x,y,radius,0x9f11bf);

            //spike image
            const trap = this.physics.add.image(x,y,"spike");
            this.physics.add.existing(trap,true);

            //collision
            this.physics.add.overlap(this.player,trap, ()=>{
                this.sound.play("clank");
                this.scene.restart();
            });


            //del trap
            this.time.delayedCall(4000, ()=> trap.destroy());

        })


    }
}


const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "0x4a4848", //grey background
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: BulletHell,
};

new Phaser.Game(config);
