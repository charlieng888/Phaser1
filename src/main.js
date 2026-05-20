import { Start } from './scenes/Start.js';

const config = {
    type: Phaser.AUTO,
    title: 'Polyblast Arena',
    description: 'A compact low-poly arena shooter prototype built in Phaser.',
    parent: 'game-container',
    width: 1280,
    height: 720,
    backgroundColor: '#121629',
    pixelArt: false,
    physics: {
        default: 'arcade',
        arcade: {
            debug: false,
            gravity: { y: 0 }
        }
    },
    scene: [
        Start
    ],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

window.game = new Phaser.Game(config);
