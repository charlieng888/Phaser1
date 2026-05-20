import { cloudSave } from '../services/cloudSave.js';
import { multiplayerClient } from '../services/multiplayerClient.js';

const ARENA_WIDTH = 2200;
const ARENA_HEIGHT = 1500;
const PLAYER_SPEED = 315;
const BULLET_SPEED = 900;
const ENEMY_BASE_SPEED = 108;
const FIRE_RATE = 145;
const ENEMY_BULLET_SPEED = 430;
const BOSS_AFTER_WAVE = 5;
const BOSS_HP = 1000;
const BOSS_MINION_LIMIT = 8;
const ENEMIES_PER_WAVE = 5;
const CHARACTER_FRAME = 362;
const TILE_FRAME = 362;
const OBJECT_FRAME = 362;
const FLOOR_TILE_SIZE = 128;
const BOSS_FRAME = 512;
const COIN_STORAGE_KEY = 'polyblastCoinBank';
const UPGRADE_STORAGE_KEY = 'polyblastPermanentUpgrades';
const CHALLENGE_STORAGE_KEY = 'polyblastDailyChallenges';
const SHOP_CATALOG = {
    maxHealth: { cost: 10, powerup: true },
    rapidFire: { cost: 15, powerup: true },
    damage: { cost: 20, powerup: true },
    rifle: { cost: 25, gun: true },
    burst: { cost: 30, gun: true },
    spread: { cost: 35, gun: true },
    cannon: { cost: 45, gun: true },
    beam: { cost: 55, gun: true },
    launcher: { cost: 65, gun: true },
    rail: { cost: 80, gun: true },
    permHealth: { cost: 40, upgrade: true, maxLevel: 5 },
    permDamage: { cost: 50, upgrade: true, maxLevel: 5 },
    permFireRate: { cost: 60, upgrade: true, maxLevel: 5 }
};
const SHOP_GUNS = Object.keys(SHOP_CATALOG).filter((item) => SHOP_CATALOG[item].gun);
const SHOP_UPGRADES = Object.keys(SHOP_CATALOG).filter((item) => SHOP_CATALOG[item].upgrade);
const MAP_THEMES = {
    neon: { floorTint: 0xffffff, wallTint: 0x7cf7ff, background: 0x090c16 },
    scrapyard: { floorTint: 0xffd25a, wallTint: 0xffa84e, background: 0x16110b },
    icebase: { floorTint: 0x9edbff, wallTint: 0x72a7ff, background: 0x07111d }
};

export class Start extends Phaser.Scene {
    constructor() {
        super('Start');
    }

    preload() {
        this.load.spritesheet('characters', 'assets/arena-characters.png', {
            frameWidth: CHARACTER_FRAME,
            frameHeight: CHARACTER_FRAME
        });
        this.load.spritesheet('playerSkins', 'assets/player-skins.png', {
            frameWidth: CHARACTER_FRAME,
            frameHeight: CHARACTER_FRAME
        });
        this.load.spritesheet('arenaTiles', 'assets/arena-tiles.png', {
            frameWidth: TILE_FRAME,
            frameHeight: TILE_FRAME
        });
        this.load.spritesheet('arenaObjects', 'assets/arena-objects.png', {
            frameWidth: OBJECT_FRAME,
            frameHeight: OBJECT_FRAME
        });
        this.load.spritesheet('bananaBoss', 'assets/banana-boss.png', {
            frameWidth: BOSS_FRAME,
            frameHeight: BOSS_FRAME
        });
    }

    create() {
        this.createTextures();
        this.createCharacterAnimations();
        this.createWorld();
        this.createPlayer();
        this.createGroups();
        this.createMultiplayerState();
        this.createHud();
        this.createInput();
        this.createCollisions();
        this.setupStartupMenu();
        this.resetRun(false);
        this.showStartupMenu();
    }

    update(time, delta) {
        if (!this.started || this.gameOver) {
            this.player.setVelocity(0);
            return;
        }

        if (Phaser.Input.Keyboard.JustDown(this.cursors.pause)) {
            this.togglePause();
        }

        if (this.isPaused) {
            this.player.setVelocity(0);
            this.updateHud();
            return;
        }

        this.updatePlayer(delta);
        this.updateAim();
        if (this.multiplayerMode) {
            this.updateServerRenderables(time);
        } else {
            this.updateEnemies(time, delta);
            this.updatePickups();
        }
        this.updateHud();
        this.updateMultiplayer(time);

        if ((this.input.activePointer.isDown || this.touchFireHeld) && time > this.nextShotAt) {
            if (this.multiplayerMode) {
                this.fireMultiplayerShot(time);
            } else {
                this.fireBullet(time);
            }
        }
    }

    createTextures() {
        this.makePolyTexture('bullet', 18, 8, [
            { x: 18, y: 4 },
            { x: 4, y: 0 },
            { x: 0, y: 4 },
            { x: 4, y: 8 }
        ], 0x7cf7ff, 0xffffff);

        this.makePolyTexture('enemyBullet', 16, 8, [
            { x: 16, y: 4 },
            { x: 4, y: 0 },
            { x: 0, y: 4 },
            { x: 4, y: 8 }
        ], 0xff6161, 0xffdada);

        this.makePolyTexture('bruteBullet', 22, 12, [
            { x: 22, y: 6 },
            { x: 5, y: 0 },
            { x: 0, y: 6 },
            { x: 5, y: 12 }
        ], 0xffa84e, 0xfff0ca);

        this.makePolyTexture('minionBullet', 12, 6, [
            { x: 12, y: 3 },
            { x: 3, y: 0 },
            { x: 0, y: 3 },
            { x: 3, y: 6 }
        ], 0xffd25a, 0xffffdf);

        this.makePolyTexture('bossBullet', 26, 14, [
            { x: 26, y: 7 },
            { x: 8, y: 0 },
            { x: 0, y: 7 },
            { x: 8, y: 14 }
        ], 0xffeb5a, 0xffffff);

        const coin = this.make.graphics({ x: 0, y: 0, add: false });
        coin.fillStyle(0xffd25a, 1);
        coin.fillCircle(16, 16, 13);
        coin.fillStyle(0xfff0ca, 1);
        coin.fillCircle(12, 11, 4);
        coin.lineStyle(3, 0x9b6314, 0.9);
        coin.strokeCircle(16, 16, 13);
        coin.generateTexture('coin', 32, 32);
        coin.destroy();
    }

    createCharacterAnimations() {
        this.anims.create({
            key: 'player-run',
            frames: this.anims.generateFrameNumbers('playerSkins', { start: 0, end: 3 }),
            frameRate: 9,
            repeat: -1
        });

        for (let skin = 0; skin < 5; skin += 1) {
            this.anims.create({
                key: `player-run-${skin}`,
                frames: this.anims.generateFrameNumbers('playerSkins', { start: skin * 4, end: skin * 4 + 3 }),
                frameRate: 9,
                repeat: -1
            });
        }

        this.anims.create({
            key: 'grunt-run',
            frames: this.anims.generateFrameNumbers('characters', { start: 4, end: 7 }),
            frameRate: 9,
            repeat: -1
        });

        this.anims.create({
            key: 'brute-run',
            frames: this.anims.generateFrameNumbers('characters', { start: 8, end: 11 }),
            frameRate: 8,
            repeat: -1
        });

        this.anims.create({
            key: 'banana-boss-walk',
            frames: this.anims.generateFrameNumbers('bananaBoss', { start: 0, end: 3 }),
            frameRate: 7,
            repeat: -1
        });
    }

    makePolyTexture(key, width, height, points, fill, highlight) {
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });
        graphics.fillStyle(fill, 1);
        graphics.fillPoints(points, true);
        graphics.lineStyle(3, highlight, 0.82);
        graphics.strokePoints(points, true);
        graphics.generateTexture(key, width, height);
        graphics.destroy();
    }

    createWorld() {
        this.physics.world.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
        this.cameras.main.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

        this.add.rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, ARENA_WIDTH, ARENA_HEIGHT, 0x090c16)
            .setDepth(-20);
        this.createArenaFloor();
        this.createArenaTrim();

        this.cover = this.physics.add.staticGroup();
        this.mapObjects = this.add.group();

        [
            [500, 330, 2, 315, 106],
            [990, 220, 0, 176, 150],
            [1610, 370, 2, 340, 110],
            [330, 920, 4, 175, 175],
            [880, 795, 2, 350, 108],
            [1360, 1065, 1, 150, 210],
            [1830, 920, 3, 230, 120],
            [1180, 1320, 2, 410, 96]
        ].forEach(([x, y, frame, width, height]) => {
            this.addCoverObject(x, y, frame, width, height);
        });

        this.addMapDecoration(280, 260, 7, 190, 190);
        this.addMapDecoration(1920, 1260, 7, 190, 190);
        this.addMapDecoration(1100, 620, 4, 165, 165);

        this.add.rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, ARENA_WIDTH - 28, ARENA_HEIGHT - 28)
            .setStrokeStyle(8, 0x5cd7ff, 0.35);
    }

    createArenaFloor() {
        const scale = FLOOR_TILE_SIZE / TILE_FRAME;
        const frames = [0, 1, 2, 3, 8, 11];
        const cols = Math.ceil(ARENA_WIDTH / FLOOR_TILE_SIZE) + 1;
        const rows = Math.ceil(ARENA_HEIGHT / FLOOR_TILE_SIZE) + 1;
        this.floorTiles = [];

        for (let y = 0; y < rows; y += 1) {
            for (let x = 0; x < cols; x += 1) {
                const frame = frames[(x * 5 + y * 3) % frames.length];
                const tile = this.add.image(x * FLOOR_TILE_SIZE, y * FLOOR_TILE_SIZE, 'arenaTiles', frame)
                    .setScale(scale)
                    .setDepth(-6)
                    .setAlpha(frame === 8 ? 0.72 : 1);
                this.floorTiles.push(tile);
            }
        }
    }

    createArenaTrim() {
        const scale = FLOOR_TILE_SIZE / TILE_FRAME;
        for (let x = FLOOR_TILE_SIZE / 2; x < ARENA_WIDTH; x += FLOOR_TILE_SIZE) {
            this.add.image(x, FLOOR_TILE_SIZE / 2, 'arenaTiles', 4).setScale(scale).setDepth(-5);
            this.add.image(x, ARENA_HEIGHT - FLOOR_TILE_SIZE / 2, 'arenaTiles', 5).setScale(scale).setDepth(-5);
        }

        for (let y = FLOOR_TILE_SIZE / 2; y < ARENA_HEIGHT; y += FLOOR_TILE_SIZE) {
            this.add.image(FLOOR_TILE_SIZE / 2, y, 'arenaTiles', 6).setScale(scale).setDepth(-5);
            this.add.image(ARENA_WIDTH - FLOOR_TILE_SIZE / 2, y, 'arenaTiles', 7).setScale(scale).setDepth(-5);
        }
    }

    addCoverObject(x, y, frame, width, height) {
        const art = this.add.image(x, y, 'arenaObjects', frame)
            .setDisplaySize(width * 1.12, height * 1.9)
            .setDepth(3);
        this.mapObjects.add(art);

        const body = this.add.zone(x, y, width, height);
        this.cover.add(body);
        body.body.setSize(width, height);
        body.body.updateFromGameObject();
    }

    addMapDecoration(x, y, frame, width, height) {
        const decoration = this.add.image(x, y, 'arenaObjects', frame)
            .setDisplaySize(width, height)
            .setDepth(1)
            .setAlpha(0.86);
        this.mapObjects.add(decoration);
    }

    createPlayer() {
        this.playerBaseScale = 0.18;
        this.player = this.physics.add.sprite(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 'playerSkins', 0);
        this.player.setScale(this.playerBaseScale);
        this.player.play('player-run-0');
        this.player.setDrag(1200);
        this.player.setMaxVelocity(PLAYER_SPEED);
        this.player.setCollideWorldBounds(true);
        this.setCharacterBody(this.player, 124);
        this.attachNameplate(this.player, 'Player', 78, 0x57ff78, -52);
        this.cameras.main.startFollow(this.player, true, 0.11, 0.11);
    }

    setCharacterBody(sprite, radius) {
        const offset = (CHARACTER_FRAME - radius * 2) / 2;
        sprite.body.setCircle(radius, offset, offset);
    }

    createGroups() {
        this.bullets = this.physics.add.group({
            defaultKey: 'bullet',
            maxSize: 80
        });

        this.enemyBullets = this.physics.add.group({
            maxSize: 140
        });

        this.enemies = this.physics.add.group();
        this.pickups = this.physics.add.group();
        this.coins = this.physics.add.group();
        this.hitSparks = this.add.group();
    }

    createMultiplayerState() {
        this.multiplayerMode = false;
        this.nextMultiplayerStateAt = 0;
        this.multiplayerCoinsEarned = 0;
        this.remotePlayers = new Map();
        this.serverEnemies = new Map();
        this.serverBullets = new Map();
        this.serverCoins = new Map();
        this.lastScoreboard = [];
        this.multiplayerBossChallengeRecorded = false;
    }

    attachNameplate(entity, label, width = 60, color = 0x57ff78, offsetY = -42) {
        const plate = {
            width,
            offsetY,
            label: this.add.text(entity.x, entity.y + offsetY - 14, label, {
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '12px',
                fontStyle: '700',
                color: '#ffffff',
                stroke: '#070914',
                strokeThickness: 3
            }).setOrigin(0.5).setDepth(14),
            back: this.add.rectangle(entity.x, entity.y + offsetY, width, 7, 0x070914, 0.82)
                .setOrigin(0.5)
                .setDepth(14),
            fill: this.add.rectangle(entity.x - width / 2, entity.y + offsetY, width, 5, color, 0.96)
                .setOrigin(0, 0.5)
                .setDepth(15)
        };

        entity.setData('nameplate', plate);
        this.setNameplateVisible(entity, this.started && !this.gameOver);
        entity.once('destroy', () => {
            plate.label.destroy();
            plate.back.destroy();
            plate.fill.destroy();
        });
        return plate;
    }

    updateNameplate(entity, currentHealth, maxHealth, label) {
        const plate = entity?.getData?.('nameplate');
        if (!plate) return;

        plate.label.setText(label);
        plate.label.setPosition(entity.x, entity.y + plate.offsetY - 14);
        plate.back.setPosition(entity.x, entity.y + plate.offsetY);
        plate.fill.setPosition(entity.x - plate.width / 2, entity.y + plate.offsetY);
        plate.fill.displayWidth = plate.width * Phaser.Math.Clamp(currentHealth / maxHealth, 0, 1);

        const visible = entity.active && entity.visible && this.started && !this.gameOver;
        plate.label.setVisible(visible);
        plate.back.setVisible(visible);
        plate.fill.setVisible(visible);
    }

    setNameplateVisible(entity, visible) {
        const plate = entity?.getData?.('nameplate');
        if (!plate) return;
        plate.label.setVisible(visible);
        plate.back.setVisible(visible);
        plate.fill.setVisible(visible);
    }

    createHud() {
        this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(20);
        this.healthText = this.add.text(26, 22, '', this.hudStyle(26, '#e9fff0'));
        this.scoreText = this.add.text(26, 58, '', this.hudStyle(22, '#b8c7ff'));
        this.waveText = this.add.text(26, 88, '', this.hudStyle(18, '#7cf7ff'));
        this.profileText = this.add.text(26, 116, '', this.hudStyle(15, '#ffffff'));
        this.scoreboardText = this.add.text(1000, 24, '', this.hudStyle(14, '#ffffff'))
            .setOrigin(0, 0)
            .setVisible(false);
        this.helpText = this.add.text(640, 664, 'WASD or left pad to move | Mouse/right pad to aim | Hold click/FIRE', this.hudStyle(18, '#d7defd'))
            .setOrigin(0.5);

        this.healthBar = this.add.container(1132, 654).setScrollFactor(0).setDepth(22);
        this.healthBarBack = this.add.rectangle(0, 0, 236, 34, 0x070914, 0.86)
            .setStrokeStyle(2, 0xffffff, 0.18);
        this.healthBarFill = this.add.rectangle(-112, 0, 224, 20, 0x57ff78, 0.96)
            .setOrigin(0, 0.5);
        this.healthBarText = this.add.text(0, 0, 'HP 100/100', this.hudStyle(15, '#ffffff'))
            .setOrigin(0.5);
        this.healthBar.add([this.healthBarBack, this.healthBarFill, this.healthBarText]);

        this.bossHud = this.add.container(640, 38).setScrollFactor(0).setDepth(21).setVisible(false);
        this.bossHud.add([
            this.add.rectangle(0, 0, 520, 18, 0x070914, 0.82).setStrokeStyle(2, 0xffd25a, 0.7),
            this.add.rectangle(-258, 0, 516, 12, 0xff6161, 0.95).setOrigin(0, 0.5),
            this.add.text(0, -26, 'BOSS: BANANA WARLORD', this.hudStyle(16, '#fff0ca')).setOrigin(0.5)
        ]);
        this.bossHealthFill = this.bossHud.getAt(1);

        this.pausePanel = this.add.container(640, 360).setScrollFactor(0).setDepth(39).setVisible(false);
        this.pausePanel.add([
            this.add.rectangle(0, 0, 360, 132, 0x070914, 0.78)
                .setStrokeStyle(2, 0xffd25a, 0.54),
            this.add.text(0, -18, 'PAUSED', this.hudStyle(42, '#fff0ca')).setOrigin(0.5),
            this.add.text(0, 34, 'Press UNPAUSE to keep fighting.', this.hudStyle(15, '#d7defd')).setOrigin(0.5)
        ]);

        this.crosshair = this.add.circle(0, 0, 11, 0x7cf7ff, 0.08)
            .setStrokeStyle(2, 0x7cf7ff, 0.95)
            .setScrollFactor(0)
            .setDepth(25);

        this.startPanel = this.add.container(640, 360).setScrollFactor(0).setDepth(40);
        const panel = this.add.rectangle(0, 0, 620, 330, 0x171d34, 0.94)
            .setStrokeStyle(3, 0x7cf7ff, 0.38);
        const title = this.add.text(0, -104, 'POLYBLAST ARENA', this.hudStyle(46, '#ffffff')).setOrigin(0.5);
        const subtitle = this.add.text(0, -42, 'Fast movement, clean aim, colorful arena chaos.', this.hudStyle(20, '#b8c7ff')).setOrigin(0.5);
        const start = this.add.text(0, 50, 'Click to deploy', this.hudStyle(26, '#7cf7ff')).setOrigin(0.5);
        const note = this.add.text(0, 108, 'Survive waves, grab shards, and keep moving.', this.hudStyle(17, '#e9fff0')).setOrigin(0.5);
        this.startPanel.add([panel, title, subtitle, start, note]);

        this.hud.add([this.healthText, this.scoreText, this.waveText, this.profileText, this.scoreboardText, this.helpText, this.healthBar, this.bossHud, this.pausePanel]);
    }

    hudStyle(size, color) {
        return {
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: `${size}px`,
            fontStyle: '700',
            color,
            stroke: '#070914',
            strokeThickness: 5
        };
    }

    createInput() {
        this.touchMove = new Phaser.Math.Vector2(0, 0);
        this.touchAim = new Phaser.Math.Vector2(1, 0);
        this.touchFireHeld = false;
        this.touchAiming = false;
        this.touchHealsRemaining = 7;
        this.setupTouchControls();

        this.cursors = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
            pause: Phaser.Input.Keyboard.KeyCodes.P,
            restart: Phaser.Input.Keyboard.KeyCodes.R
        }, false);

        this.input.on('pointerdown', () => {
            if (this.gameOver && !this.menuVisible) {
                this.beginRun();
            }
        });
    }

    setupTouchControls() {
        const isTouch = navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches;
        document.body.classList.toggle('touch-enabled', Boolean(isTouch));
        document.body.classList.toggle('controls-enabled', Boolean(isTouch));
        this.touchControls = document.getElementById('touch-controls');
        this.controlsToggle = document.getElementById('controls-toggle');
        this.movePad = document.getElementById('move-pad');
        this.firePad = document.getElementById('fire-pad');
        this.moveStick = document.getElementById('move-stick');
        this.fireStick = document.getElementById('fire-stick');
        this.touchFireButton = document.getElementById('touch-fire-button');
        this.touchHealButton = document.getElementById('touch-heal-button');
        this.touchHomeButton = document.getElementById('touch-home-button');
        this.pauseButton = document.getElementById('pause-button');

        this.bindTouchPad(this.movePad, this.moveStick, (vector, active) => {
            this.touchMove.copy(vector);
            if (!active) this.touchMove.set(0, 0);
        });

        this.bindTouchPad(this.firePad, this.fireStick, (vector, active) => {
            this.touchAiming = active;
            if (active && vector.lengthSq() > 0.01) {
                this.touchAim.copy(vector);
                this.touchFireHeld = true;
            } else if (!active) {
                this.touchFireHeld = false;
            }
        });

        const setFire = (value) => {
            this.touchFireHeld = value;
        };
        this.touchFireButton?.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            setFire(true);
        });
        this.touchFireButton?.addEventListener('pointerup', (event) => {
            event.preventDefault();
            setFire(false);
        });
        this.touchFireButton?.addEventListener('pointercancel', () => setFire(false));
        this.controlsToggle?.addEventListener('click', () => {
            const enabled = !document.body.classList.contains('controls-enabled');
            document.body.classList.toggle('controls-enabled', enabled);
            this.controlsToggle.textContent = enabled ? 'HIDE CONTROLS' : 'CONTROLS';
        });
        this.touchHealButton?.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            this.useTouchHeal();
        });
        this.touchHomeButton?.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            this.returnHome();
        });
        this.pauseButton?.addEventListener('click', () => this.togglePause());
        this.updateTouchHealButton();
        this.updatePauseButton();
    }

    bindTouchPad(pad, stick, onMove) {
        if (!pad || !stick) return;
        const maxDistance = 54;
        const update = (event) => {
            const rect = pad.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const dx = event.clientX - centerX;
            const dy = event.clientY - centerY;
            const distance = Math.min(maxDistance, Math.hypot(dx, dy));
            const angle = Math.atan2(dy, dx);
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;
            stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
            onMove(new Phaser.Math.Vector2(x / maxDistance, y / maxDistance), true);
        };
        const reset = () => {
            stick.style.transform = 'translate(-50%, -50%)';
            onMove(new Phaser.Math.Vector2(0, 0), false);
        };

        pad.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            pad.setPointerCapture?.(event.pointerId);
            update(event);
        });
        pad.addEventListener('pointermove', (event) => {
            if (event.buttons === 0 && event.pointerType !== 'touch') return;
            event.preventDefault();
            update(event);
        });
        pad.addEventListener('pointerup', (event) => {
            event.preventDefault();
            reset();
        });
        pad.addEventListener('pointercancel', reset);
        pad.addEventListener('lostpointercapture', reset);
    }

    setupStartupMenu() {
        this.profile = {
            name: 'Player',
            className: 'Vanguard',
            skinIndex: 0,
            tint: null,
            map: 'neon',
            roomCode: 'PUBLIC'
        };

        this.menuOverlay = document.getElementById('menu-overlay');
        this.nameInput = document.getElementById('player-name');
        this.classInput = document.getElementById('player-class');
        this.roomInput = document.getElementById('room-code');
        this.randomRoomButton = document.getElementById('random-room');
        this.startButton = document.getElementById('start-game');
        this.multiplayerButton = document.getElementById('start-multiplayer');
        this.customizeButton = document.getElementById('customize-avatar');
        this.avatarPanel = document.getElementById('avatar-panel');
        this.menuArmsButton = document.getElementById('menu-arms-room');
        this.armsButton = document.getElementById('arms-room-button');
        this.shopPanel = document.getElementById('shop-panel');
        this.shopCoins = document.getElementById('shop-coins');
        this.menuCoins = document.getElementById('menu-coins');
        this.shopButtons = document.querySelectorAll('.shop-buy');
        this.shopTabs = document.querySelectorAll('.shop-tab');
        this.shopItems = document.querySelectorAll('.shop-item');
        this.activeShopTab = 'powerups';
        this.accountBadge = document.getElementById('account-badge');
        this.accountStatus = document.getElementById('account-status');
        this.googleLoginButton = document.getElementById('google-login');
        this.googleLogoutButton = document.getElementById('google-logout');
        this.leaderboardList = document.getElementById('leaderboard-list');
        this.multiplayerStatus = document.getElementById('multiplayer-status');
        this.dailyList = document.getElementById('daily-list');

        this.coinsCollected = this.loadCoinBank();
        this.permanentUpgrades = this.loadPermanentUpgrades();
        this.basePlayerStats = {
            maxHealth: 100 + this.permanentUpgrades.health * 10,
            bulletDamage: 20 + this.permanentUpgrades.damage * 4,
            fireDelay: Math.max(80, FIRE_RATE - this.permanentUpgrades.fireRate * 7)
        };
        this.pendingRoundBoosts = this.createEmptyRoundBoosts();
        this.playerStats = {
            ...this.basePlayerStats,
            gun: 'blaster',
            ownedGuns: new Set(['blaster'])
        };

        this.customizeButton?.addEventListener('click', () => {
            this.avatarPanel.hidden = !this.avatarPanel.hidden;
        });

        this.menuArmsButton?.addEventListener('click', () => this.toggleShop());
        this.armsButton?.addEventListener('click', () => this.toggleShop());
        this.randomRoomButton?.addEventListener('click', () => {
            this.roomInput.value = this.generateRoomCode();
        });
        this.googleLoginButton?.addEventListener('click', () => this.signInWithGoogle());
        this.googleLogoutButton?.addEventListener('click', () => this.signOutOfGoogle());
        this.shopTabs.forEach((button) => {
            button.addEventListener('click', () => this.setShopTab(button.dataset.shopTab));
        });
        this.shopButtons.forEach((button) => {
            button.addEventListener('click', () => this.buyShopItem(button.dataset.buy));
        });

        document.querySelectorAll('.avatar-swatch').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.avatar-swatch').forEach((swatch) => swatch.classList.remove('is-selected'));
                button.classList.add('is-selected');
                const tint = button.dataset.tint;
                this.profile.tint = tint === 'default' ? null : Number(tint);
                this.applyPlayerTint();
            });
        });

        document.querySelectorAll('.skin-option').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.skin-option').forEach((option) => option.classList.remove('is-selected'));
                button.classList.add('is-selected');
                this.profile.skinIndex = Number(button.dataset.skin || 0);
                this.applyPlayerSkin();
            });
        });

        document.querySelectorAll('.map-option').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.map-option').forEach((option) => option.classList.remove('is-selected'));
                button.classList.add('is-selected');
                this.profile.map = button.dataset.map || 'neon';
                this.applyMapTheme(this.profile.map);
            });
        });

        this.startButton?.addEventListener('click', () => {
            this.captureProfileFromMenu();
            this.beginRun();
        });

        this.multiplayerButton?.addEventListener('click', () => {
            this.captureProfileFromMenu();
            this.beginRun(true);
        });

        [this.nameInput, this.classInput, this.roomInput].forEach((input) => {
            input?.addEventListener('focus', () => {
                this.input.keyboard.enabled = false;
            });

            input?.addEventListener('blur', () => {
                if (!this.menuVisible) {
                    this.input.keyboard.enabled = true;
                }
            });
        });

        this.updateShop();
        this.applyMapTheme(this.profile.map);
        this.renderDailyChallenges();
        this.setupCloudSave();
    }

    captureProfileFromMenu() {
        this.profile.name = this.cleanProfileValue(this.nameInput?.value, 'Player');
        this.profile.className = this.cleanProfileValue(this.classInput?.value, 'Vanguard');
        this.profile.roomCode = this.cleanRoomCode(this.roomInput?.value);
    }

    createEmptyRoundBoosts() {
        return {
            maxHealth: 0,
            bulletDamage: 0,
            fireDelayMultiplier: 1
        };
    }

    loadPermanentUpgrades() {
        try {
            return {
                health: 0,
                damage: 0,
                fireRate: 0,
                ...JSON.parse(window.localStorage?.getItem(UPGRADE_STORAGE_KEY) || '{}')
            };
        } catch {
            return { health: 0, damage: 0, fireRate: 0 };
        }
    }

    savePermanentUpgrades() {
        window.localStorage?.setItem(UPGRADE_STORAGE_KEY, JSON.stringify(this.permanentUpgrades));
    }

    refreshBaseStats() {
        this.basePlayerStats = {
            maxHealth: 100 + this.permanentUpgrades.health * 10,
            bulletDamage: 20 + this.permanentUpgrades.damage * 4,
            fireDelay: Math.max(80, FIRE_RATE - this.permanentUpgrades.fireRate * 7)
        };
    }

    loadCoinBank() {
        const saved = Number(window.localStorage?.getItem(COIN_STORAGE_KEY) || 0);
        return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
    }

    saveCoinBank() {
        window.localStorage?.setItem(COIN_STORAGE_KEY, String(this.coinsCollected));
        this.syncCloudCoins();
    }

    cleanRoomCode(value) {
        const cleaned = String(value || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        return cleaned || 'PUBLIC';
    }

    generateRoomCode() {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 5; i += 1) {
            code += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        return code;
    }

    applyMapTheme(map) {
        const theme = MAP_THEMES[map] || MAP_THEMES.neon;
        this.cameras.main.setBackgroundColor(theme.background);
        this.floorTiles?.forEach((tile) => tile.setTint(theme.floorTint));
        this.mapObjects?.children?.iterate?.((object) => object?.setTint?.(theme.wallTint));
    }

    setupCloudSave() {
        if (window.location.protocol === 'file:') {
            this.setAccountBadge(false);
            this.setAccountStatus('Open http://127.0.0.1:5173/ to use Google login.');
            if (this.googleLoginButton) this.googleLoginButton.disabled = true;
            return;
        }

        this.setAccountStatus('Connecting account services...');
        if (this.googleLoginButton) this.googleLoginButton.disabled = true;

        cloudSave.init({
            onAuthChange: ({ configured, user, player }) => this.handleAuthChange(configured, user, player),
            onLeaderboardChange: (entries) => this.renderLeaderboard(entries),
            onLoginError: (error) => this.handleLoginError(error)
        }).then(({ configured }) => {
            if (!configured) {
                this.setAccountStatus('Add Firebase keys to enable Google login.');
                this.setAccountBadge(false);
                if (this.googleLoginButton) this.googleLoginButton.disabled = true;
            }
        }).catch((error) => {
            console.warn('Cloud save unavailable', error);
            this.setAccountStatus('Cloud save is unavailable right now.');
            this.setAccountBadge(false);
            if (this.googleLoginButton) this.googleLoginButton.disabled = true;
        });
    }

    handleAuthChange(configured, user, player) {
        if (!configured) return;

        if (this.googleLoginButton) {
            this.googleLoginButton.disabled = false;
            this.googleLoginButton.hidden = Boolean(user);
        }
        if (this.googleLogoutButton) this.googleLogoutButton.hidden = !user;

        if (!user) {
            this.setAccountBadge(false);
            this.setAccountStatus('Click Google Login to save coins and scores online.');
            return;
        }

        const cloudCoins = Number(player?.coins || 0);
        if (cloudCoins > this.coinsCollected) {
            this.coinsCollected = cloudCoins;
            window.localStorage?.setItem(COIN_STORAGE_KEY, String(this.coinsCollected));
        } else if (this.coinsCollected > cloudCoins) {
            this.syncCloudCoins();
        }

        const displayName = user.displayName || 'Player';
        this.setAccountBadge(true);
        this.setAccountStatus(`Signed in as ${displayName}${user.email ? ` (${user.email})` : ''}`);
        this.updateShop();
        this.updateHud();
    }

    setAccountStatus(message) {
        if (this.accountStatus) {
            this.accountStatus.textContent = message;
        }
    }

    setAccountBadge(isSignedIn) {
        if (!this.accountBadge) return;
        this.accountBadge.textContent = isSignedIn ? 'SIGNED IN' : 'SIGNED OUT';
        this.accountBadge.classList.toggle('is-signed-in', isSignedIn);
    }

    async signInWithGoogle() {
        this.setAccountStatus('Opening Google login...');
        try {
            if (this.shouldUseRedirectLogin()) {
                this.setAccountStatus('Redirecting to Google login...');
                await cloudSave.signInWithRedirect();
                return;
            }

            await cloudSave.signIn();
        } catch (error) {
            console.error('Google login failed', error);
            const code = error?.code || '';
            if (['auth/popup-blocked', 'auth/cancelled-popup-request'].includes(code)) {
                this.setAccountStatus('Popup blocked. Click Google Login again to use redirect.');
            } else {
                this.setAccountStatus(this.getLoginErrorMessage(code));
            }
        }
    }

    handleLoginError(error) {
        console.error('Google redirect login failed', error);
        this.setAccountStatus(this.getLoginErrorMessage(error?.code || ''));
    }

    shouldUseRedirectLogin() {
        return ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    }

    getLoginErrorMessage(code) {
        const host = window.location.hostname;
        const messages = {
            'auth/popup-closed-by-user': 'Google login popup was closed before signing in.',
            'auth/unauthorized-domain': `Add ${host} to Firebase Auth authorized domains.`,
            'auth/operation-not-allowed': 'Enable Google as a Firebase sign-in provider.',
            'auth/network-request-failed': 'Network error while contacting Firebase.'
        };

        return messages[code] || `Google login failed${code ? `: ${code}` : '.'}`;
    }

    async signOutOfGoogle() {
        try {
            await cloudSave.signOut();
        } catch (error) {
            console.warn('Google sign out failed', error);
            this.setAccountStatus('Could not sign out right now.');
        }
    }

    syncCloudCoins() {
        if (!cloudSave.isSignedIn()) return;
        cloudSave.saveCoins(this.coinsCollected).catch((error) => {
            console.warn('Coin sync failed', error);
        });
    }

    submitCloudScore() {
        if (!cloudSave.isSignedIn()) return;
        cloudSave.submitScore({
            score: this.score,
            wave: this.wave,
            coins: this.coinsCollected
        }).catch((error) => {
            console.warn('Score sync failed', error);
        });
    }

    renderLeaderboard(entries = []) {
        if (!this.leaderboardList) return;

        if (!entries.length) {
            this.leaderboardList.innerHTML = '<li><span>-</span><span>No scores yet</span><span>0</span></li>';
            return;
        }

        this.leaderboardList.innerHTML = entries.map((entry, index) => {
            const name = this.escapeHtml(entry.displayName || 'Player');
            const score = Number(entry.bestScore || 0).toLocaleString();
            return `<li><span>${index + 1}</span><span>${name}</span><span>${score}</span></li>`;
        }).join('');
    }

    getDailyChallengeState() {
        const today = new Date().toISOString().slice(0, 10);
        try {
            const saved = JSON.parse(window.localStorage?.getItem(CHALLENGE_STORAGE_KEY) || '{}');
            if (saved.date === today) return saved;
        } catch {
            // Fall through to a fresh daily state.
        }
        return {
            date: today,
            coins: 0,
            wave: 0,
            boss: 0
        };
    }

    saveDailyChallengeState(state) {
        window.localStorage?.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(state));
    }

    recordChallengeProgress(type, amount) {
        const state = this.getDailyChallengeState();
        if (type === 'wave') {
            state.wave = Math.max(state.wave || 0, amount);
        } else {
            state[type] = (state[type] || 0) + amount;
        }
        this.saveDailyChallengeState(state);
        this.renderDailyChallenges();
    }

    renderDailyChallenges() {
        if (!this.dailyList) return;
        const state = this.getDailyChallengeState();
        const items = [
            ['Collect 50 coins', state.coins || 0, 50],
            ['Reach wave 5', state.wave || 0, 5],
            ['Defeat 1 boss', state.boss || 0, 1]
        ];
        this.dailyList.innerHTML = items.map(([label, current, target]) => {
            const done = current >= target;
            return `<li>${done ? 'DONE' : `${Math.min(current, target)}/${target}`} - ${label}</li>`;
        }).join('');
    }

    escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    cleanProfileValue(value, fallback) {
        const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
        return cleaned || fallback;
    }

    showStartupMenu() {
        this.menuVisible = true;
        this.multiplayerMode = false;
        document.body.classList.add('menu-open');
        this.menuOverlay.hidden = false;
        this.input.keyboard.enabled = false;
        this.hud.setVisible(false);
        this.armsButton.hidden = true;
        if (this.controlsToggle) this.controlsToggle.hidden = true;
        if (this.pauseButton) this.pauseButton.hidden = true;
        this.setPaused(false);
        this.startPanel.setVisible(false);
        this.updateShop();
    }

    returnHome() {
        this.started = false;
        this.gameOver = false;
        this.touchFireHeld = false;
        this.touchAiming = false;
        this.touchMove?.set(0, 0);
        this.setPaused(false);
        this.disconnectMultiplayer();
        this.player.setVelocity(0);
        this.player.setActive(true).setVisible(true).setAlpha(1);
        this.applyPlayerTint();
        this.setNameplateVisible(this.player, false);
        this.enemies.clear(true, true);
        this.bullets.clear(true, true);
        this.enemyBullets.clear(true, true);
        this.pickups.clear(true, true);
        this.coins.clear(true, true);
        this.bossHud.setVisible(false);
        this.pausePanel?.setVisible(false);
        this.startPanel.setVisible(false);
        this.showStartupMenu();
    }

    useTouchHeal() {
        if (!this.started || this.gameOver || this.touchHealsRemaining <= 0) return;
        if (this.health >= this.playerStats.maxHealth) return;
        this.touchHealsRemaining -= 1;
        this.health = Math.min(this.playerStats.maxHealth, this.health + 35);
        this.spawnSpark(this.player.x, this.player.y, 0x74ffb3);
        this.updateTouchHealButton();
        this.updateHud();
    }

    updateTouchHealButton() {
        if (!this.touchHealButton) return;
        const remaining = Math.max(0, this.touchHealsRemaining || 0);
        this.touchHealButton.textContent = `HEAL ${remaining}`;
        this.touchHealButton.disabled = remaining <= 0;
    }

    hideStartupMenu() {
        this.menuVisible = false;
        document.body.classList.remove('menu-open');
        this.menuOverlay.hidden = true;
        this.input.keyboard.enabled = true;
        this.hud.setVisible(true);
        this.armsButton.hidden = false;
        if (this.controlsToggle) this.controlsToggle.hidden = false;
        if (this.pauseButton) this.pauseButton.hidden = false;
        this.updatePauseButton();
    }

    beginRun(multiplayer = false) {
        this.multiplayerMode = multiplayer;
        this.hideStartupMenu();
        this.closeShop();
        this.resetRun(false);
        this.setPaused(false);
        this.started = true;
        this.startPanel.setVisible(false);
        this.updatePauseButton();
        if (multiplayer) {
            this.connectMultiplayer();
        } else {
            this.disconnectMultiplayer();
        }
    }

    togglePause() {
        if (!this.started || this.gameOver || this.menuVisible) return;
        this.setPaused(!this.isPaused);
    }

    setPaused(value) {
        this.isPaused = Boolean(value);
        if (this.isPaused) {
            this.touchFireHeld = false;
            this.touchAiming = false;
            this.touchMove?.set(0, 0);
            this.player?.setVelocity(0);
            this.physics?.world?.pause();
        } else {
            this.physics?.world?.resume();
        }
        this.pausePanel?.setVisible(this.isPaused);
        this.updatePauseButton();
    }

    updatePauseButton() {
        if (!this.pauseButton) return;
        this.pauseButton.textContent = this.isPaused ? 'UNPAUSE' : 'PAUSE';
        this.pauseButton.hidden = !this.started || this.gameOver || this.menuVisible;
    }

    connectMultiplayer() {
        this.setMultiplayerStatus(`Connecting to room ${this.profile.roomCode}...`);
        multiplayerClient.connect({
            profile: this.profile,
            roomCode: this.profile.roomCode,
            map: this.profile.map,
            onOpen: () => this.setMultiplayerStatus(`Connected to room ${this.profile.roomCode}.`),
            onClose: () => this.setMultiplayerStatus('Multiplayer disconnected. Single-player still works.'),
            onError: () => this.setMultiplayerStatus('Start the multiplayer server on port 5174.'),
            onMessage: (message) => this.handleMultiplayerMessage(message)
        });
    }

    disconnectMultiplayer() {
        multiplayerClient.disconnect();
        this.clearServerRenderables();
        this.setMultiplayerStatus('Multiplayer ready.');
    }

    handleMultiplayerMessage(message) {
        if (message.type === 'snapshot') {
            this.syncServerArena(message);
            this.syncRemotePlayers(message.players || []);
        } else if (message.type === 'playerLeft') {
            this.removeRemotePlayer(message.id);
        }
    }

    updateMultiplayer(time) {
        if (!this.multiplayerMode || !multiplayerClient.connected || time < this.nextMultiplayerStateAt) return;
        this.nextMultiplayerStateAt = time + 80;
        multiplayerClient.sendState({
            x: Math.round(this.player.x),
            y: Math.round(this.player.y),
            rotation: this.player.rotation,
            maxHealth: this.playerStats.maxHealth
        });
    }

    fireMultiplayerShot(time) {
        const angle = this.getFireAngle();
        multiplayerClient.sendShoot({
            angle,
            gun: this.playerStats.gun,
            damage: this.playerStats.bulletDamage,
            fireDelay: this.playerStats.fireDelay
        });

        const delayMultiplier = {
            burst: 1.08,
            cannon: 1.55,
            beam: 0.9,
            launcher: 1.85,
            rail: 1.35,
            rifle: 0.86,
            spread: 1.08
        }[this.playerStats.gun] || 1;
        this.nextShotAt = time + Math.round(this.playerStats.fireDelay * delayMultiplier);
    }

    syncServerArena(snapshot) {
        this.wave = snapshot.wave || this.wave;
        if (snapshot.map) {
            this.applyMapTheme(snapshot.map);
        }
        const me = (snapshot.players || []).find((player) => player.id === multiplayerClient.id);
        if (me) {
            this.health = me.health;
            this.score = me.score || 0;
            this.playerStats.maxHealth = me.maxHealth || this.playerStats.maxHealth;
            this.player.setAlpha(me.downed ? 0.42 : 1);
            this.player.setTint(me.downed ? 0xffd25a : this.profile.tint || 0xffffff);
            const earned = me.coinsEarned || 0;
            if (earned > this.multiplayerCoinsEarned) {
                this.coinsCollected += earned - this.multiplayerCoinsEarned;
                this.recordChallengeProgress('coins', earned - this.multiplayerCoinsEarned);
                this.multiplayerCoinsEarned = earned;
                this.saveCoinBank();
                this.updateShop();
            }
        }
        this.lastScoreboard = snapshot.players || [];
        if (this.wave >= 5) this.recordChallengeProgress('wave', this.wave);
        if (snapshot.bossDefeated && !this.multiplayerBossChallengeRecorded) {
            this.multiplayerBossChallengeRecorded = true;
            this.recordChallengeProgress('boss', 1);
        }
        if (snapshot.bossPhase) this.bossHud.getAt(2).setText(`BOSS: BANANA WARLORD - PHASE ${snapshot.bossPhase}`);

        this.syncServerEnemies(snapshot.enemies || []);
        this.syncServerBullets(snapshot.bullets || []);
        this.syncServerCoins(snapshot.coins || []);
    }

    syncServerEnemies(enemies) {
        const seen = new Set();
        let bossSprite = null;
        enemies.forEach((enemy) => {
            seen.add(enemy.id);
            let rendered = this.serverEnemies.get(enemy.id);
            if (!rendered) {
                rendered = this.createServerEnemy(enemy);
                this.serverEnemies.set(enemy.id, rendered);
            }
            rendered.sprite.setPosition(enemy.x, enemy.y);
            rendered.sprite.rotation = enemy.rotation || 0;
            rendered.sprite.setData('health', enemy.health);
            rendered.sprite.setData('maxHealth', enemy.maxHealth);
            this.updateNameplate(
                rendered.sprite,
                enemy.health,
                enemy.maxHealth,
                this.getEnemyLabel(rendered.sprite)
            );
            if (enemy.type === 'boss') {
                bossSprite = rendered.sprite;
            }
        });

        this.serverEnemies.forEach((rendered, id) => {
            if (!seen.has(id)) {
                rendered.sprite.destroy();
                this.serverEnemies.delete(id);
            }
        });

        this.boss = bossSprite;
        this.bossHud.setVisible(Boolean(bossSprite));
    }

    createServerEnemy(enemy) {
        const isBoss = enemy.type === 'boss';
        const visual = this.getEnemyVisualConfig(enemy.type);
        const texture = isBoss ? 'bananaBoss' : 'characters';
        const frame = isBoss ? 0 : visual.frame;
        const sprite = this.add.sprite(enemy.x, enemy.y, texture, frame)
            .setScale(isBoss ? 0.42 : visual.scale)
            .setDepth(8);
        if (isBoss) {
            sprite.play('banana-boss-walk');
        } else {
            sprite.play(visual.animation);
            if (visual.tint) sprite.setTint(visual.tint);
        }
        sprite.setData('type', enemy.type);
        sprite.setData('health', enemy.health);
        sprite.setData('maxHealth', enemy.maxHealth);
        this.attachNameplate(
            sprite,
            this.getEnemyLabel(sprite),
            isBoss ? 140 : visual.plateWidth,
            isBoss ? 0xffd25a : visual.color,
            isBoss ? -110 : visual.offsetY
        );
        return { sprite };
    }

    syncServerBullets(bullets) {
        const seen = new Set();
        bullets.forEach((bullet) => {
            seen.add(bullet.id);
            let sprite = this.serverBullets.get(bullet.id);
            if (!sprite) {
                sprite = this.add.image(bullet.x, bullet.y, bullet.texture).setDepth(10);
                this.serverBullets.set(bullet.id, sprite);
            }
            sprite.setTexture(bullet.texture);
            sprite.setPosition(bullet.x, bullet.y);
            sprite.rotation = bullet.rotation || 0;
        });
        this.serverBullets.forEach((sprite, id) => {
            if (!seen.has(id)) {
                sprite.destroy();
                this.serverBullets.delete(id);
            }
        });
    }

    syncServerCoins(coins) {
        const seen = new Set();
        coins.forEach((coin) => {
            seen.add(coin.id);
            let sprite = this.serverCoins.get(coin.id);
            if (!sprite) {
                sprite = this.add.image(coin.x, coin.y, 'coin').setDepth(8);
                this.serverCoins.set(coin.id, sprite);
            }
            sprite.setPosition(coin.x, coin.y);
        });
        this.serverCoins.forEach((sprite, id) => {
            if (!seen.has(id)) {
                sprite.destroy();
                this.serverCoins.delete(id);
            }
        });
    }

    updateServerRenderables(time) {
        this.serverCoins.forEach((coin) => {
            coin.rotation += 0.04;
            coin.setScale(1 + Math.sin(time / 150) * 0.08);
        });
    }

    syncRemotePlayers(players) {
        const seen = new Set();
        players.forEach((player) => {
            if (!player?.id || player.id === multiplayerClient.id) return;
            seen.add(player.id);
            this.updateRemotePlayer(player);
        });

        this.remotePlayers.forEach((_, id) => {
            if (!seen.has(id)) {
                this.removeRemotePlayer(id);
            }
        });
    }

    updateRemotePlayer(playerState) {
        let remote = this.remotePlayers.get(playerState.id);
        if (!remote) {
            remote = this.createRemotePlayer(playerState);
            this.remotePlayers.set(playerState.id, remote);
        }

        remote.sprite.setPosition(playerState.x, playerState.y);
        remote.sprite.rotation = playerState.rotation || 0;
        remote.sprite.setAlpha(playerState.downed ? 0.42 : 0.92);
        const skinIndex = Phaser.Math.Clamp(playerState.profile?.skinIndex || 0, 0, 4);
        remote.sprite.play(`player-run-${skinIndex}`, true);
        remote.sprite.setTexture('playerSkins', skinIndex * 4);
        if (playerState.profile?.tint) {
            remote.sprite.setTint(playerState.profile.tint);
        } else {
            remote.sprite.clearTint();
        }

        const name = playerState.profile?.name || 'Player';
        const className = playerState.profile?.className || 'Vanguard';
        const status = playerState.downed
            ? `DOWN ${Math.round((playerState.reviveProgress || 0) * 100)}%`
            : className;
        this.updateNameplate(
            remote.sprite,
            playerState.health || 0,
            playerState.maxHealth || 100,
            `${name} | ${status}`
        );
    }

    createRemotePlayer(playerState) {
        const skinIndex = Phaser.Math.Clamp(playerState.profile?.skinIndex || 0, 0, 4);
        const sprite = this.add.sprite(playerState.x, playerState.y, 'playerSkins', skinIndex * 4)
            .setScale(this.playerBaseScale)
            .setDepth(9)
            .setAlpha(0.92);
        sprite.play(`player-run-${skinIndex}`, true);
        this.attachNameplate(sprite, playerState.profile?.name || 'Player', 78, 0x7cf7ff, -52);
        return { sprite };
    }

    removeRemotePlayer(id) {
        const remote = this.remotePlayers.get(id);
        if (!remote) return;
        remote.sprite.destroy();
        this.remotePlayers.delete(id);
    }

    clearRemotePlayers() {
        this.remotePlayers.forEach((_, id) => this.removeRemotePlayer(id));
    }

    clearServerRenderables() {
        this.clearRemotePlayers();
        this.serverEnemies?.forEach((rendered) => rendered.sprite.destroy());
        this.serverBullets?.forEach((sprite) => sprite.destroy());
        this.serverCoins?.forEach((sprite) => sprite.destroy());
        this.serverEnemies?.clear();
        this.serverBullets?.clear();
        this.serverCoins?.clear();
    }

    setMultiplayerStatus(message) {
        if (this.multiplayerStatus) {
            this.multiplayerStatus.textContent = message;
        }
    }

    toggleShop() {
        if (this.shopPanel.hidden) {
            this.openShop();
        } else {
            this.closeShop();
        }
    }

    openShop() {
        this.shopPanel.hidden = false;
        document.body.classList.add('shop-open');
        this.updateShop();
    }

    closeShop() {
        this.shopPanel.hidden = true;
        document.body.classList.remove('shop-open');
    }

    setShopTab(tab) {
        if (!['powerups', 'guns', 'upgrades'].includes(tab)) return;
        this.activeShopTab = tab;
        this.updateShop();
    }

    buyShopItem(item) {
        const entry = SHOP_CATALOG[item];
        if (!entry) return;

        if (entry.gun && this.playerStats.ownedGuns.has(item)) {
            this.playerStats.gun = item;
            this.updateShop();
            return;
        }

        if (entry.upgrade && this.getUpgradeLevel(item) >= entry.maxLevel) return;
        if (this.coinsCollected < entry.cost) return;

        this.coinsCollected -= entry.cost;
        this.saveCoinBank();
        if (entry.gun) {
            this.playerStats.ownedGuns.add(item);
            this.playerStats.gun = item;
        } else if (entry.upgrade) {
            this.buyPermanentUpgrade(item);
        } else if (entry.powerup) {
            this.addRoundPowerup(item);
        }

        this.updateHud();
        this.updateShop();
    }

    getUpgradeLevel(item) {
        const key = item === 'permHealth' ? 'health' : item === 'permDamage' ? 'damage' : 'fireRate';
        return this.permanentUpgrades[key] || 0;
    }

    buyPermanentUpgrade(item) {
        const key = item === 'permHealth' ? 'health' : item === 'permDamage' ? 'damage' : 'fireRate';
        this.permanentUpgrades[key] = Math.min(5, (this.permanentUpgrades[key] || 0) + 1);
        this.savePermanentUpgrades();
        this.refreshBaseStats();
        this.resetRoundStats();
        this.health = Math.min(this.playerStats.maxHealth, this.health + (item === 'permHealth' ? 10 : 0));
    }

    addRoundPowerup(item) {
        if (this.started && !this.gameOver) {
            this.applyRoundPowerup(item);
            return;
        }

        if (item === 'maxHealth') {
            this.pendingRoundBoosts.maxHealth += 25;
        } else if (item === 'rapidFire') {
            this.pendingRoundBoosts.fireDelayMultiplier *= 0.82;
        } else if (item === 'damage') {
            this.pendingRoundBoosts.bulletDamage += 10;
        }
    }

    applyRoundPowerup(item) {
        if (item === 'maxHealth') {
            this.playerStats.maxHealth += 25;
            this.health = Math.min(this.playerStats.maxHealth, this.health + 25);
        } else if (item === 'rapidFire') {
            this.playerStats.fireDelay = Math.max(65, Math.round(this.playerStats.fireDelay * 0.82));
        } else if (item === 'damage') {
            this.playerStats.bulletDamage += 10;
        }
    }

    resetRoundStats() {
        const ownedGuns = this.playerStats.ownedGuns;
        const gun = this.playerStats.gun;
        this.playerStats = {
            maxHealth: this.basePlayerStats.maxHealth + this.pendingRoundBoosts.maxHealth,
            bulletDamage: this.basePlayerStats.bulletDamage + this.pendingRoundBoosts.bulletDamage,
            fireDelay: Math.max(65, Math.round(this.basePlayerStats.fireDelay * this.pendingRoundBoosts.fireDelayMultiplier)),
            gun,
            ownedGuns
        };
        this.pendingRoundBoosts = this.createEmptyRoundBoosts();
    }

    updateShop() {
        if (!this.playerStats) return;
        if (this.shopCoins) this.shopCoins.textContent = `Coins ${this.coinsCollected}`;
        if (this.menuCoins) this.menuCoins.textContent = `Coins ${this.coinsCollected}`;

        this.shopTabs?.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.shopTab === this.activeShopTab);
        });
        this.shopItems?.forEach((item) => {
            item.hidden = item.dataset.category !== this.activeShopTab;
        });

        this.shopButtons.forEach((button) => {
            const item = button.dataset.buy;
            const entry = SHOP_CATALOG[item];
            if (!entry) return;
            const isGun = SHOP_GUNS.includes(item);
            const isUpgrade = SHOP_UPGRADES.includes(item);
            const owned = isGun && this.playerStats.ownedGuns.has(item);
            const equipped = isGun && this.playerStats.gun === item;
            const level = isUpgrade ? this.getUpgradeLevel(item) : 0;
            const maxed = isUpgrade && level >= entry.maxLevel;
            button.classList.toggle('is-equipped', equipped);
            button.disabled = maxed || (!owned && this.coinsCollected < entry.cost);
            button.textContent = maxed ? 'Max' : equipped ? 'Equipped' : owned ? 'Equip' : isUpgrade ? `${entry.cost} L${level}` : String(entry.cost);
        });
    }

    createCollisions() {
        this.physics.add.collider(this.player, this.cover);
        this.physics.add.collider(this.enemies, this.cover);
        this.physics.add.collider(this.enemies, this.enemies);
        this.physics.add.collider(this.bullets, this.cover, this.killBullet, null, this);
        this.physics.add.collider(this.enemyBullets, this.cover, this.killBullet, null, this);
        this.physics.add.overlap(this.bullets, this.enemies, this.hitEnemy, null, this);
        this.physics.add.overlap(this.player, this.enemyBullets, this.hitPlayerWithEnemyBullet, null, this);
        this.physics.add.overlap(this.player, this.enemies, this.touchEnemy, null, this);
        this.physics.add.overlap(this.player, this.pickups, this.collectPickup, null, this);
        this.physics.add.overlap(this.player, this.coins, this.collectCoin, null, this);
    }

    resetRun(showPanel = false) {
        this.started = false;
        this.gameOver = false;
        this.setPaused(false);
        this.resetRoundStats();
        this.health = this.playerStats.maxHealth;
        this.score = 0;
        this.wave = 0;
        this.bossActive = false;
        this.bossDefeated = false;
        this.boss = null;
        this.nextBossMinionAt = 0;
        this.nextShotAt = 0;
        this.nextWaveAt = 0;
        this.invulnerableUntil = 0;
        this.touchHealsRemaining = 7;
        this.updateTouchHealButton();
        this.applyMapTheme(this.profile.map);
        this.player.setPosition(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
        this.player.setActive(true).setVisible(true);
        this.applyPlayerSkin();
        this.applyPlayerTint();
        this.setNameplateVisible(this.player, false);
        this.enemies.clear(true, true);
        this.bullets.clear(true, true);
        this.enemyBullets.clear(true, true);
        this.pickups.clear(true, true);
        this.coins.clear(true, true);
        this.bossHud.setVisible(false);
        this.clearServerRenderables();
        this.multiplayerCoinsEarned = 0;
        this.multiplayerBossChallengeRecorded = false;
        if (!this.multiplayerMode) {
            this.spawnWave();
        }
        this.updateHud();
        this.startPanel.getAt(1).setText('POLYBLAST ARENA');
        this.startPanel.getAt(2).setText(`${this.profile.name} | ${this.profile.className}`);
        this.startPanel.getAt(3).setText('Click to redeploy');
        this.startPanel.getAt(4).setText('Survive waves, grab shards, and keep moving.');
        this.startPanel.setVisible(showPanel);
    }

    applyPlayerTint() {
        if (!this.player) return;
        if (this.profile?.tint) {
            this.player.setTint(this.profile.tint);
        } else {
            this.player.clearTint();
        }
    }

    applyPlayerSkin() {
        if (!this.player) return;
        const skinIndex = Phaser.Math.Clamp(this.profile?.skinIndex || 0, 0, 4);
        this.player.setTexture('playerSkins', skinIndex * 4);
        this.player.play(`player-run-${skinIndex}`, true);
        this.setCharacterBody(this.player, 124);
        this.applyPlayerTint();
    }

    updatePlayer(delta) {
        const direction = new Phaser.Math.Vector2(
            Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown),
            Number(this.cursors.down.isDown) - Number(this.cursors.up.isDown)
        );
        if (this.touchMove.lengthSq() > 0.01) {
            direction.add(this.touchMove);
        }

        if (direction.lengthSq() > 0) {
            direction.normalize().scale(PLAYER_SPEED);
            this.player.setVelocity(direction.x, direction.y);
        } else {
            this.player.setVelocity(0);
        }

        const pulse = 1 + Math.sin(this.time.now / 100) * 0.025;
        this.player.setScale(this.playerBaseScale * pulse);

        if (Phaser.Input.Keyboard.JustDown(this.cursors.restart)) {
            this.beginRun();
        }

    }

    updateAim() {
        if (this.touchAiming || this.touchFireHeld) {
            const angle = Math.atan2(this.touchAim.y, this.touchAim.x);
            this.player.rotation = angle;
            const screenX = this.cameras.main.width / 2 + Math.cos(angle) * 88;
            const screenY = this.cameras.main.height / 2 + Math.sin(angle) * 88;
            this.crosshair.setPosition(screenX, screenY);
            return;
        }

        const pointer = this.input.activePointer;
        const worldPoint = pointer.positionToCamera(this.cameras.main);
        this.player.rotation = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y);
        this.crosshair.setPosition(pointer.x, pointer.y);
    }

    getFireAngle() {
        if (this.touchAiming || this.touchFireHeld) {
            return Math.atan2(this.touchAim.y, this.touchAim.x);
        }
        const pointer = this.input.activePointer.positionToCamera(this.cameras.main);
        return Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.x, pointer.y);
    }

    updateEnemies(time) {
        if (this.enemies.countActive(true) === 0 && time > this.nextWaveAt) {
            if (this.wave >= BOSS_AFTER_WAVE && !this.bossDefeated) {
                this.spawnBossEncounter(time);
            } else {
                this.spawnWave();
            }
        }

        if (this.bossActive && time > this.nextBossMinionAt) {
            this.spawnBossMinion();
            this.nextBossMinionAt = time + 2300;
        }

        this.enemies.children.iterate((enemy) => {
            if (!enemy || !enemy.active) return;
            this.updateEnemySupport(enemy, time);
            const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
            const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
            if (enemy.getData('type') === 'exploder' && distance < 78) {
                this.explodeEnemy(enemy);
                return;
            }
            const speed = enemy.getData('speed');
            const direction = enemy.getData('type') === 'sniper' && distance < 430 ? angle + Math.PI : angle;
            enemy.setVelocity(Math.cos(direction) * speed, Math.sin(direction) * speed);
            enemy.rotation = angle;
            this.tryEnemyShot(enemy, time);
            this.updateNameplate(
                enemy,
                enemy.getData('health'),
                enemy.getData('maxHealth'),
                this.getEnemyLabel(enemy)
            );
        });
    }

    updateEnemySupport(enemy, time) {
        if (enemy.getData('type') !== 'medic' || time < enemy.getData('nextHealAt')) return;
        enemy.setData('nextHealAt', time + 2200);
        let healed = false;
        this.enemies.children.iterate((ally) => {
            if (!ally || !ally.active || ally === enemy || ally.getData('type') === 'boss') return;
            if (Phaser.Math.Distance.Between(enemy.x, enemy.y, ally.x, ally.y) > 185) return;
            const maxHealth = ally.getData('maxHealth') || 1;
            const health = ally.getData('health') || 0;
            if (health >= maxHealth) return;
            ally.setData('health', Math.min(maxHealth, health + 2));
            healed = true;
        });
        if (healed) this.spawnSpark(enemy.x, enemy.y, 0x74ffb3);
    }

    updatePickups() {
        this.pickups.children.iterate((pickup) => {
            if (!pickup || !pickup.active) return;
            pickup.rotation += 0.035;
            pickup.setScale(1 + Math.sin(this.time.now / 150) * 0.08);
        });
    }

    fireBullet(time) {
        const angle = this.getFireAngle();
        const gun = this.playerStats.gun;

        if (gun === 'spread') {
            this.firePlayerBullet(angle - 0.18, BULLET_SPEED * 0.94, Math.max(8, this.playerStats.bulletDamage - 5), 'bullet');
            this.firePlayerBullet(angle, BULLET_SPEED, this.playerStats.bulletDamage, 'bullet');
            this.firePlayerBullet(angle + 0.18, BULLET_SPEED * 0.94, Math.max(8, this.playerStats.bulletDamage - 5), 'bullet');
        } else if (gun === 'burst') {
            this.firePlayerBullet(angle - 0.07, BULLET_SPEED * 1.05, Math.max(7, this.playerStats.bulletDamage - 7), 'enemyBullet');
            this.firePlayerBullet(angle, BULLET_SPEED * 1.08, Math.max(7, this.playerStats.bulletDamage - 7), 'enemyBullet');
            this.firePlayerBullet(angle + 0.07, BULLET_SPEED * 1.05, Math.max(7, this.playerStats.bulletDamage - 7), 'enemyBullet');
        } else if (gun === 'cannon') {
            this.firePlayerBullet(angle, BULLET_SPEED * 0.76, this.playerStats.bulletDamage + 35, 'bruteBullet');
        } else if (gun === 'beam') {
            this.firePlayerBullet(angle, BULLET_SPEED * 1.38, this.playerStats.bulletDamage + 18, 'minionBullet');
        } else if (gun === 'launcher') {
            this.firePlayerBullet(angle, BULLET_SPEED * 0.62, this.playerStats.bulletDamage + 52, 'bossBullet');
        } else if (gun === 'rail') {
            this.firePlayerBullet(angle, BULLET_SPEED * 1.62, this.playerStats.bulletDamage + 42, 'bruteBullet');
        } else if (gun === 'rifle') {
            this.firePlayerBullet(angle, BULLET_SPEED * 1.18, this.playerStats.bulletDamage + 12, 'bullet');
        } else {
            this.firePlayerBullet(angle, BULLET_SPEED, this.playerStats.bulletDamage, 'bullet');
        }

        const gunDelayMultiplier = {
            burst: 1.08,
            cannon: 1.55,
            beam: 0.9,
            launcher: 1.85,
            rail: 1.35,
            rifle: 0.86,
            spread: 1.08
        };
        this.nextShotAt = time + Math.round(this.playerStats.fireDelay * (gunDelayMultiplier[gun] || 1));
    }

    firePlayerBullet(angle, speed, damage, texture) {
        const bullet = this.bullets.get(this.player.x, this.player.y, texture);
        if (!bullet) return;

        bullet.setTexture(texture);
        bullet.setActive(true).setVisible(true);
        bullet.setPosition(
            this.player.x + Math.cos(angle) * 34,
            this.player.y + Math.sin(angle) * 34
        );
        bullet.rotation = angle;
        bullet.body.reset(bullet.x, bullet.y);
        bullet.body.setSize(bullet.displayWidth, bullet.displayHeight);
        bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
        bullet.setData('damage', damage);
        bullet.setData('expiresAt', this.time.now + 760);

        this.time.delayedCall(780, () => {
            if (bullet.active && bullet.getData('expiresAt') <= this.time.now) {
                this.killBullet(bullet);
            }
        });
    }

    spawnWave() {
        this.wave += 1;
        this.bossActive = false;
        this.bossHud.setVisible(false);
        const total = ENEMIES_PER_WAVE;
        const bruteEvery = Math.max(2, 5 - Math.floor(this.wave / 2));
        const wavePower = this.getWavePower();

        for (let i = 0; i < total; i += 1) {
            const type = this.getWaveEnemyType(i, bruteEvery);
            const visual = this.getEnemyVisualConfig(type);
            const spawn = this.getSpawnPoint();
            const enemy = this.enemies.create(spawn.x, spawn.y, 'characters', visual.frame);
            enemy.setScale(visual.scale);
            enemy.play(visual.animation);
            if (visual.tint) enemy.setTint(visual.tint);
            this.setCharacterBody(enemy, visual.bodyRadius);
            enemy.setData('type', type);
            enemy.setData('baseTint', visual.tint);
            const stats = this.getEnemyStats(type, wavePower);
            const health = stats.health;
            enemy.setData('health', health);
            enemy.setData('maxHealth', health);
            enemy.setData('speed', stats.speed);
            enemy.setData('damage', stats.damage);
            enemy.setData('bulletDamage', stats.bulletDamage);
            enemy.setData('fireCooldown', stats.fireCooldown);
            enemy.setData('nextShotAt', this.time.now + Phaser.Math.Between(1400, 2800));
            enemy.setData('weapon', stats.weapon);
            enemy.setData('shootRange', stats.shootRange);
            enemy.setData('nextHealAt', this.time.now + Phaser.Math.Between(900, 1700));
            enemy.setCollideWorldBounds(true);
            this.attachNameplate(enemy, this.getEnemyLabel(enemy), visual.plateWidth, visual.color, visual.offsetY);
        }
    }

    getWaveEnemyType(index, bruteEvery) {
        if (this.wave >= 5 && index === 4) return 'exploder';
        if (this.wave >= 4 && index === 3) return 'medic';
        if (this.wave >= 3 && index === 2) return 'sniper';
        if (this.wave >= 2 && index === 1) return 'shield';
        if (index > 0 && index % bruteEvery === 0) return 'brute';
        return 'grunt';
    }

    getEnemyVisualConfig(type) {
        const configs = {
            grunt: { frame: 4, scale: 0.18, bodyRadius: 118, animation: 'grunt-run', color: 0xff6161, plateWidth: 58, offsetY: -42, tint: null },
            brute: { frame: 8, scale: 0.23, bodyRadius: 133, animation: 'brute-run', color: 0xffa84e, plateWidth: 70, offsetY: -42, tint: null },
            shield: { frame: 8, scale: 0.24, bodyRadius: 136, animation: 'brute-run', color: 0x72a7ff, plateWidth: 72, offsetY: -44, tint: 0x72a7ff },
            sniper: { frame: 4, scale: 0.16, bodyRadius: 108, animation: 'grunt-run', color: 0xff8de3, plateWidth: 68, offsetY: -40, tint: 0xff8de3 },
            exploder: { frame: 4, scale: 0.19, bodyRadius: 124, animation: 'grunt-run', color: 0xffd25a, plateWidth: 78, offsetY: -42, tint: 0xffd25a },
            medic: { frame: 4, scale: 0.18, bodyRadius: 118, animation: 'grunt-run', color: 0x74ffb3, plateWidth: 64, offsetY: -42, tint: 0x74ffb3 },
            'boss-minion': { frame: 4, scale: 0.15, bodyRadius: 112, animation: 'grunt-run', color: 0xffd25a, plateWidth: 54, offsetY: -38, tint: null }
        };
        return configs[type] || configs.grunt;
    }

    getEnemyStats(type, wavePower) {
        const base = {
            grunt: {
                health: 1 + Math.floor(this.wave * 0.8),
                speed: ENEMY_BASE_SPEED + this.wave * 8,
                damage: 9 + Math.floor(this.wave * 1.6),
                bulletDamage: 3 + Math.floor(wavePower * 1.4),
                fireCooldown: Math.max(780, 1900 - this.wave * 95),
                weapon: 'blaster',
                shootRange: 620
            },
            brute: {
                health: 4 + Math.floor(this.wave * 1.8),
                speed: ENEMY_BASE_SPEED * 0.72 + this.wave * 8,
                damage: 18 + Math.floor(this.wave * 2.4),
                bulletDamage: 8 + Math.floor(wavePower * 2.2),
                fireCooldown: Math.max(950, 2300 - this.wave * 110),
                weapon: 'cannon',
                shootRange: 780
            },
            shield: {
                health: 8 + Math.floor(this.wave * 2.4),
                speed: ENEMY_BASE_SPEED * 0.58 + this.wave * 6,
                damage: 14 + Math.floor(this.wave * 1.8),
                bulletDamage: 5 + Math.floor(wavePower * 1.5),
                fireCooldown: Math.max(950, 2100 - this.wave * 90),
                weapon: 'shield-blaster',
                shootRange: 560
            },
            sniper: {
                health: 2 + Math.floor(this.wave * 0.7),
                speed: ENEMY_BASE_SPEED * 0.86 + this.wave * 5,
                damage: 8 + Math.floor(this.wave * 1.1),
                bulletDamage: 14 + Math.floor(wavePower * 2.8),
                fireCooldown: Math.max(1200, 2600 - this.wave * 90),
                weapon: 'sniper',
                shootRange: 1020
            },
            exploder: {
                health: 3 + Math.floor(this.wave * 1.1),
                speed: ENEMY_BASE_SPEED * 1.28 + this.wave * 10,
                damage: 32 + Math.floor(this.wave * 3.2),
                bulletDamage: 0,
                fireCooldown: 999999,
                weapon: 'exploder',
                shootRange: 0
            },
            medic: {
                health: 4 + Math.floor(this.wave * 1.2),
                speed: ENEMY_BASE_SPEED * 0.9 + this.wave * 6,
                damage: 7 + Math.floor(this.wave * 1.2),
                bulletDamage: 3 + Math.floor(wavePower * 1.1),
                fireCooldown: Math.max(900, 2100 - this.wave * 80),
                weapon: 'medic',
                shootRange: 600
            }
        };
        return base[type] || base.grunt;
    }

    getWavePower() {
        return Math.max(1, this.wave);
    }

    spawnBossEncounter(time) {
        this.bossActive = true;
        this.wave = BOSS_AFTER_WAVE + 1;
        this.nextBossMinionAt = time + 900;
        this.bossHud.setVisible(true);

        const boss = this.enemies.create(ARENA_WIDTH / 2, 190, 'bananaBoss', 0);
        boss.setScale(0.42);
        boss.play('banana-boss-walk');
        boss.body.setCircle(170, 86, 190);
        boss.setData('type', 'boss');
        boss.setData('health', BOSS_HP);
        boss.setData('maxHealth', BOSS_HP);
        boss.setData('speed', 72);
        boss.setData('damage', 28);
        boss.setData('bulletDamage', 18);
        boss.setData('fireCooldown', 1250);
        boss.setData('nextShotAt', time + 900);
        boss.setData('weapon', 'banana-barrage');
        boss.setData('shootRange', 980);
        boss.setCollideWorldBounds(true);
        this.attachNameplate(boss, 'Banana Warlord', 140, 0xffd25a, -110);
        this.boss = boss;
        this.updateBossHud();
        this.cameras.main.shake(260, 0.005);
    }

    spawnBossMinion() {
        if (!this.boss?.active) return;

        const minionCount = this.enemies.children.entries.filter((enemy) => (
            enemy.active && enemy.getData('type') === 'boss-minion'
        )).length;
        if (minionCount >= BOSS_MINION_LIMIT) return;

        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const distance = Phaser.Math.Between(120, 210);
        const x = Phaser.Math.Clamp(this.boss.x + Math.cos(angle) * distance, 80, ARENA_WIDTH - 80);
        const y = Phaser.Math.Clamp(this.boss.y + Math.sin(angle) * distance, 80, ARENA_HEIGHT - 80);
        const minion = this.enemies.create(x, y, 'characters', 4);
        minion.setScale(0.15);
        minion.play('grunt-run');
        this.setCharacterBody(minion, 112);
        minion.setData('type', 'boss-minion');
        minion.setData('health', 2);
        minion.setData('maxHealth', 2);
        minion.setData('speed', ENEMY_BASE_SPEED + 48);
        minion.setData('damage', 9);
        minion.setData('bulletDamage', 6 + Math.floor(this.getWavePower() * 1.5));
        minion.setData('fireCooldown', 900);
        minion.setData('nextShotAt', this.time.now + Phaser.Math.Between(400, 1100));
        minion.setData('weapon', 'stinger');
        minion.setData('shootRange', 560);
        minion.setCollideWorldBounds(true);
        this.attachNameplate(minion, 'Minion', 54, 0xffd25a, -38);
        this.spawnSpark(x, y, 0xffd25a);
    }

    getEnemyLabel(enemy) {
        const type = enemy.getData('type');
        if (type === 'boss') return 'Banana Warlord';
        if (type === 'boss-minion') return 'Minion';
        if (type === 'brute') return 'Brute';
        if (type === 'shield') return 'Shield';
        if (type === 'sniper') return 'Sniper';
        if (type === 'exploder') return 'Exploder';
        if (type === 'medic') return 'Medic';
        return 'Grunt';
    }

    tryEnemyShot(enemy, time) {
        if (time < enemy.getData('nextShotAt')) return;
        if (enemy.getData('weapon') === 'exploder') return;

        const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
        const range = enemy.getData('shootRange') || 560;
        if (distance > range) return;

        const weapon = enemy.getData('weapon');
        const cooldown = enemy.getData('fireCooldown') || 1400;
        enemy.setData('nextShotAt', time + cooldown + Phaser.Math.Between(-120, 180));

        if (weapon === 'cannon') {
            this.fireEnemyBullet(enemy, 'bruteBullet', 0, ENEMY_BULLET_SPEED * 0.78, enemy.getData('bulletDamage'));
        } else if (weapon === 'banana-barrage') {
            this.fireEnemyBullet(enemy, 'bossBullet', -0.18, ENEMY_BULLET_SPEED * 0.76, enemy.getData('bulletDamage'));
            this.fireEnemyBullet(enemy, 'bossBullet', 0, ENEMY_BULLET_SPEED * 0.82, enemy.getData('bulletDamage'));
            this.fireEnemyBullet(enemy, 'bossBullet', 0.18, ENEMY_BULLET_SPEED * 0.76, enemy.getData('bulletDamage'));
        } else if (weapon === 'stinger') {
            this.fireEnemyBullet(enemy, 'minionBullet', 0, ENEMY_BULLET_SPEED * 1.2, enemy.getData('bulletDamage'));
        } else if (weapon === 'sniper') {
            this.fireEnemyBullet(enemy, 'bruteBullet', 0, ENEMY_BULLET_SPEED * 1.55, enemy.getData('bulletDamage'));
        } else if (weapon === 'shield-blaster') {
            this.fireEnemyBullet(enemy, 'enemyBullet', -0.08, ENEMY_BULLET_SPEED * 0.86, enemy.getData('bulletDamage'));
            this.fireEnemyBullet(enemy, 'enemyBullet', 0.08, ENEMY_BULLET_SPEED * 0.86, enemy.getData('bulletDamage'));
        } else if (weapon === 'medic') {
            this.fireEnemyBullet(enemy, 'minionBullet', 0, ENEMY_BULLET_SPEED * 0.92, enemy.getData('bulletDamage'));
        } else {
            this.fireEnemyBullet(enemy, 'enemyBullet', 0, ENEMY_BULLET_SPEED, enemy.getData('bulletDamage'));
        }
    }

    fireEnemyBullet(enemy, texture, spread, speed, damage) {
        const bullet = this.enemyBullets.get(enemy.x, enemy.y, texture);
        if (!bullet) return;

        const baseAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
        const angle = baseAngle + spread;
        bullet.setTexture(texture);
        bullet.setActive(true).setVisible(true);
        bullet.setPosition(enemy.x + Math.cos(angle) * 38, enemy.y + Math.sin(angle) * 38);
        bullet.rotation = angle;
        bullet.body.reset(bullet.x, bullet.y);
        bullet.body.setSize(bullet.displayWidth, bullet.displayHeight);
        bullet.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
        bullet.setData('damage', damage);
        bullet.setData('expiresAt', this.time.now + 1700);

        this.time.delayedCall(1720, () => {
            if (bullet.active && bullet.getData('expiresAt') <= this.time.now) {
                this.killBullet(bullet);
            }
        });
    }

    getSpawnPoint() {
        const side = Phaser.Math.Between(0, 3);
        const padding = 72;
        if (side === 0) return { x: Phaser.Math.Between(padding, ARENA_WIDTH - padding), y: padding };
        if (side === 1) return { x: ARENA_WIDTH - padding, y: Phaser.Math.Between(padding, ARENA_HEIGHT - padding) };
        if (side === 2) return { x: Phaser.Math.Between(padding, ARENA_WIDTH - padding), y: ARENA_HEIGHT - padding };
        return { x: padding, y: Phaser.Math.Between(padding, ARENA_HEIGHT - padding) };
    }

    hitEnemy(bullet, enemy) {
        this.killBullet(bullet);
        const isBoss = enemy.getData('type') === 'boss';
        const type = enemy.getData('type');
        const damageMultiplier = type === 'shield' ? 0.48 : 1;
        const damage = (bullet.getData('damage') || (isBoss ? 20 : 1)) * damageMultiplier;
        const health = enemy.getData('health') - damage;
        enemy.setData('health', health);
        enemy.setTintFill(0xffffff);
        this.time.delayedCall(55, () => {
            if (!enemy.active) return;
            if (isBoss) {
                enemy.setTint(0xfff0ca);
            } else if (enemy.getData('baseTint')) {
                enemy.setTint(enemy.getData('baseTint'));
            } else {
                enemy.clearTint();
            }
        });
        this.spawnSpark(enemy.x, enemy.y, 0xfff0ca);
        if (isBoss) {
            enemy.setTint(0xfff0ca);
            this.updateBossHud();
        }

        if (health <= 0) {
            if (isBoss) {
                this.score += 2000;
                this.recordChallengeProgress('boss', 1);
                this.bossActive = false;
                this.bossDefeated = true;
                this.bossHud.setVisible(false);
                this.cameras.main.shake(420, 0.011);
            } else {
                this.score += this.getEnemyScoreValue(type);
            }
            if (Phaser.Math.Between(0, 100) < 22) {
                this.spawnPickup(enemy.x, enemy.y);
            }
            this.dropCoins(enemy.x, enemy.y, isBoss ? 15 : this.getEnemyCoinValue(type));
            enemy.destroy();
            this.nextWaveAt = this.time.now + 900;
        }
    }

    getEnemyScoreValue(type) {
        return {
            brute: 220,
            shield: 260,
            sniper: 240,
            exploder: 180,
            medic: 260,
            'boss-minion': 120
        }[type] || 95;
    }

    getEnemyCoinValue(type) {
        return {
            brute: 4,
            shield: 4,
            sniper: 3,
            exploder: 3,
            medic: 4,
            'boss-minion': 2
        }[type] || 2;
    }

    explodeEnemy(enemy) {
        if (!enemy.active) return;
        const damage = enemy.getData('damage') || 32;
        this.spawnSpark(enemy.x, enemy.y, 0xffd25a);
        this.cameras.main.shake(150, 0.006);
        if (Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) < 150) {
            this.damagePlayer(damage, enemy.x, enemy.y);
        }
        this.dropCoins(enemy.x, enemy.y, 2);
        enemy.destroy();
        this.nextWaveAt = this.time.now + 900;
    }

    touchEnemy(player, enemy) {
        if (this.time.now < this.invulnerableUntil) return;

        this.damagePlayer(enemy.getData('damage'), enemy.x, enemy.y);
    }

    hitPlayerWithEnemyBullet(player, bullet) {
        this.killBullet(bullet);
        this.damagePlayer(bullet.getData('damage') || 8, bullet.x, bullet.y);
    }

    damagePlayer(amount, sourceX, sourceY) {
        if (this.time.now < this.invulnerableUntil) return;

        this.health -= amount;
        this.invulnerableUntil = this.time.now + 520;
        this.cameras.main.shake(120, 0.006);
        this.player.setTint(0xff7272);
        this.time.delayedCall(130, () => this.player.active && this.applyPlayerTint());

        const pushAngle = Phaser.Math.Angle.Between(sourceX, sourceY, this.player.x, this.player.y);
        this.player.setVelocity(Math.cos(pushAngle) * 480, Math.sin(pushAngle) * 480);

        if (this.health <= 0) {
            this.endRun();
        }
    }

    spawnPickup(x, y) {
        const type = Phaser.Math.Between(0, 100) < 58 ? 'health' : 'ammo';
        const pickup = this.pickups.create(x, y, 'arenaObjects', type === 'health' ? 5 : 6);
        pickup.setDisplaySize(58, 58);
        pickup.setData('type', type);
        pickup.body.setCircle(100, 81, 81);
    }

    collectPickup(player, pickup) {
        if (pickup.getData('type') === 'health') {
            this.health = Math.min(100, this.health + 22);
            this.score += 30;
        } else {
            this.nextShotAt = Math.max(0, this.nextShotAt - 260);
            this.score += 55;
        }
        this.spawnSpark(pickup.x, pickup.y, 0x7cf7ff);
        pickup.destroy();
    }

    dropCoins(x, y, amount) {
        for (let i = 0; i < amount; i += 1) {
            const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
            const distance = Phaser.Math.Between(10, 58);
            const coin = this.coins.create(
                x + Math.cos(angle) * distance,
                y + Math.sin(angle) * distance,
                'coin'
            );
            coin.setData('value', 1);
            coin.body.setCircle(14, 2, 2);
            coin.setVelocity(Math.cos(angle) * 70, Math.sin(angle) * 70);
            coin.setDrag(450);
            coin.setDepth(8);
        }
    }

    collectCoin(player, coin) {
        this.coinsCollected += coin.getData('value') || 1;
        this.recordChallengeProgress('coins', coin.getData('value') || 1);
        this.saveCoinBank();
        this.score += 10;
        this.updateShop();
        this.spawnSpark(coin.x, coin.y, 0xffd25a);
        coin.destroy();
    }

    spawnSpark(x, y, color) {
        for (let i = 0; i < 7; i += 1) {
            const spark = this.add.circle(x, y, Phaser.Math.Between(3, 7), color, 0.8);
            const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
            const distance = Phaser.Math.Between(26, 58);
            this.tweens.add({
                targets: spark,
                x: x + Math.cos(angle) * distance,
                y: y + Math.sin(angle) * distance,
                alpha: 0,
                scale: 0.2,
                duration: 260,
                ease: 'Quad.out',
                onComplete: () => spark.destroy()
            });
        }
    }

    killBullet(bullet) {
        bullet.setActive(false).setVisible(false);
        bullet.body.stop();
    }

    endRun() {
        this.setPaused(false);
        this.gameOver = true;
        this.started = false;
        this.player.setActive(false).setVisible(false);
        this.setNameplateVisible(this.player, false);
        this.enemies.children.iterate((enemy) => {
            if (!enemy) return;
            enemy.setVelocity(0);
            this.setNameplateVisible(enemy, false);
        });
        this.enemyBullets.clear(true, true);
        this.submitCloudScore();
        this.recordChallengeProgress('wave', this.wave);
        this.startPanel.setVisible(true);
        this.startPanel.getAt(1).setText('RUN ENDED');
        this.startPanel.getAt(2).setText(`Score ${this.score} | Wave ${this.wave}`);
        this.startPanel.getAt(3).setText('Click to redeploy');
        this.startPanel.getAt(4).setText('Press R anytime to reset the arena.');
        if (this.multiplayerMode) {
            this.disconnectMultiplayer();
        }
    }

    updateHud() {
        this.healthText.setText(`HP ${Math.max(0, this.health)}/${this.playerStats.maxHealth}`);
        this.scoreText.setText(`Score ${this.score} | Coins ${this.coinsCollected}`);
        this.waveText.setText(`Wave ${this.wave}`);
        const roomText = this.multiplayerMode ? ` | ROOM ${this.profile.roomCode}` : '';
        this.profileText.setText(`${this.profile.name} | ${this.profile.className}${this.multiplayerMode ? ' | MULTIPLAYER' : ''}${roomText}`);
        const me = this.lastScoreboard?.find?.((player) => player.id === multiplayerClient.id);
        const status = me?.downed ? `DOWN ${Math.round((me.reviveProgress || 0) * 100)}%` : this.profile.className;
        this.updateNameplate(this.player, Math.max(0, this.health), this.playerStats.maxHealth, `${this.profile.name} | ${status}`);
        this.updateHealthBar();
        this.updateScoreboardText();
        this.updateBossHud();
    }

    updateHealthBar() {
        if (!this.healthBarFill || !this.healthBarText) return;
        const maxHealth = this.playerStats.maxHealth || 100;
        const currentHealth = Phaser.Math.Clamp(Math.ceil(this.health), 0, maxHealth);
        const ratio = currentHealth / maxHealth;
        const fillColor = ratio <= 0.3 ? 0xff6161 : ratio <= 0.6 ? 0xffd25a : 0x57ff78;

        this.healthBarFill.displayWidth = 224 * ratio;
        this.healthBarFill.setFillStyle(fillColor, 0.96);
        this.healthBarText.setText(`HP ${currentHealth}/${maxHealth}`);
        this.healthBar.setVisible(this.started && !this.gameOver);
    }

    updateScoreboardText() {
        if (!this.scoreboardText) return;
        if (!this.multiplayerMode || !this.lastScoreboard?.length) {
            this.scoreboardText.setVisible(false);
            return;
        }
        const lines = this.lastScoreboard
            .slice()
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 5)
            .map((player, index) => {
                const name = player.profile?.name || 'Player';
                const state = player.downed ? 'DOWN' : `${player.kills || 0}K`;
                return `${index + 1}. ${name} ${player.score || 0} ${state}`;
            });
        this.scoreboardText.setText(['SCOREBOARD', ...lines].join('\n'));
        this.scoreboardText.setVisible(true);
    }

    updateBossHud() {
        if (!this.bossHealthFill || !this.bossHud.visible || !this.boss?.active) return;
        const maxHealth = this.boss.getData('maxHealth') || BOSS_HP;
        const health = Phaser.Math.Clamp(this.boss.getData('health') || 0, 0, maxHealth);
        this.bossHealthFill.displayWidth = 516 * (health / maxHealth);
    }
}
