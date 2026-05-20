const crypto = require('node:crypto');
const http = require('node:http');

const PORT = Number(process.env.PORT || 5174);
const ARENA_WIDTH = 2200;
const ARENA_HEIGHT = 1500;
const BULLET_SPEED = 900;
const ENEMY_BASE_SPEED = 108;
const ENEMY_BULLET_SPEED = 430;
const BOSS_AFTER_WAVE = 5;
const BOSS_HP = 1000;
const BOSS_MINION_LIMIT = 8;
const ENEMIES_PER_WAVE = 5;
const TICK_RATE = 30;
const SNAPSHOT_RATE = 12;
const REVIVE_SECONDS = 2.2;
const rooms = new Map();

function send(socket, data) {
    if (socket.destroyed) return;
    const payload = Buffer.from(JSON.stringify(data));
    const header = payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    socket.write(Buffer.concat([header, payload]));
}

function parseFrame(buffer) {
    if (buffer.length < 6) return null;
    const opcode = buffer[0] & 0x0f;
    if (opcode === 0x8) return { close: true };

    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
        length = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        return null;
    }

    const masked = Boolean(buffer[1] & 0x80);
    if (!masked || buffer.length < offset + 4 + length) return null;

    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = buffer.subarray(offset, offset + length);
    const decoded = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
        decoded[i] = payload[i] ^ mask[i % 4];
    }

    try {
        return JSON.parse(decoded.toString('utf8'));
    } catch {
        return null;
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function randomInt(min, max) {
    return Math.floor(randomBetween(min, max + 1));
}

function sanitizeRoom(value) {
    const cleaned = String(value || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    return cleaned || 'PUBLIC';
}

function sanitizeMap(value) {
    return ['neon', 'scrapyard', 'icebase'].includes(value) ? value : 'neon';
}

function sanitizeProfile(profile = {}) {
    const tint = profile.tint === null || profile.tint === undefined || profile.tint === ''
        ? null
        : Number(profile.tint);
    return {
        name: String(profile.name || 'Player').slice(0, 18),
        className: String(profile.className || 'Vanguard').slice(0, 18),
        skinIndex: clamp(Number(profile.skinIndex || 0), 0, 4),
        tint: Number.isFinite(tint) ? tint : null
    };
}

class Room {
    constructor(code) {
        this.code = code;
        this.map = 'neon';
        this.players = new Map();
        this.enemies = new Map();
        this.bullets = new Map();
        this.coins = new Map();
        this.wave = 0;
        this.bossActive = false;
        this.bossDefeated = false;
        this.bossPhase = 0;
        this.nextBossMinionAt = 0;
        this.nextWaveAt = 0;
        this.lastSnapshotAt = 0;
    }

    addPlayer(socket) {
        const id = crypto.randomUUID();
        this.players.set(id, {
            id,
            socket,
            profile: sanitizeProfile(),
            x: ARENA_WIDTH / 2 + randomInt(-100, 100),
            y: ARENA_HEIGHT / 2 + randomInt(-100, 100),
            rotation: 0,
            health: 100,
            maxHealth: 100,
            downed: false,
            reviveProgress: 0,
            score: 0,
            kills: 0,
            damageDone: 0,
            revives: 0,
            coinsEarned: 0,
            nextShotAt: 0,
            invulnerableUntil: Date.now() + 1000,
            updatedAt: Date.now()
        });
        send(socket, { type: 'welcome', id, room: this.code });
        this.broadcast({ type: 'playerJoined', id, room: this.code });
        return id;
    }

    removePlayer(id) {
        this.players.delete(id);
        this.broadcast({ type: 'playerLeft', id });
        if (this.players.size === 0) {
            this.enemies.clear();
            this.bullets.clear();
            this.coins.clear();
            this.wave = 0;
            this.bossActive = false;
            this.bossDefeated = false;
            this.nextWaveAt = 0;
        }
    }

    broadcast(data) {
        this.players.forEach((player) => send(player.socket, data));
    }

    distance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    getSpawnPoint() {
        const side = randomInt(0, 3);
        if (side === 0) return { x: randomBetween(80, ARENA_WIDTH - 80), y: 80 };
        if (side === 1) return { x: ARENA_WIDTH - 80, y: randomBetween(80, ARENA_HEIGHT - 80) };
        if (side === 2) return { x: randomBetween(80, ARENA_WIDTH - 80), y: ARENA_HEIGHT - 80 };
        return { x: 80, y: randomBetween(80, ARENA_HEIGHT - 80) };
    }

    createEnemy(type, x, y) {
        const id = crypto.randomUUID();
        const stats = this.getEnemyStats(type);
        this.enemies.set(id, {
            id,
            type,
            x,
            y,
            rotation: 0,
            health: stats.health,
            maxHealth: stats.health,
            speed: stats.speed,
            damage: stats.damage,
            bulletDamage: stats.bulletDamage,
            fireCooldown: stats.fireCooldown,
            nextShotAt: Date.now() + randomInt(800, 2400),
            weapon: stats.weapon,
            shootRange: stats.shootRange,
            phase: 0,
            nextHealAt: Date.now() + randomInt(900, 1700)
        });
    }

    getEnemyStats(type) {
        const wavePower = Math.max(1, this.wave);
        const stats = {
            boss: {
                health: BOSS_HP,
                speed: 72,
                damage: 28,
                bulletDamage: 18,
                fireCooldown: 1250,
                weapon: 'banana-barrage',
                shootRange: 980
            },
            'boss-minion': {
                health: 2,
                speed: ENEMY_BASE_SPEED + 48,
                damage: 9,
                bulletDamage: 5,
                fireCooldown: 1050,
                weapon: 'stinger',
                shootRange: 560
            },
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
        return stats[type] || stats.grunt;
    }

    spawnWave() {
        this.wave += 1;
        this.bossActive = false;
        const bruteEvery = Math.max(2, 5 - Math.floor(this.wave / 2));
        for (let i = 0; i < ENEMIES_PER_WAVE; i += 1) {
            const spawn = this.getSpawnPoint();
            this.createEnemy(this.getWaveEnemyType(i, bruteEvery), spawn.x, spawn.y);
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

    spawnBossEncounter(now) {
        this.wave = BOSS_AFTER_WAVE + 1;
        this.bossActive = true;
        this.bossPhase = 1;
        this.nextBossMinionAt = now + 900;
        this.createEnemy('boss', ARENA_WIDTH / 2, 190);
    }

    spawnBossMinion() {
        const boss = [...this.enemies.values()].find((enemy) => enemy.type === 'boss');
        if (!boss) return;
        const minionCount = [...this.enemies.values()].filter((enemy) => enemy.type === 'boss-minion').length;
        if (minionCount >= BOSS_MINION_LIMIT) return;
        const angle = randomBetween(0, Math.PI * 2);
        const range = randomInt(120, 210);
        this.createEnemy(
            'boss-minion',
            clamp(boss.x + Math.cos(angle) * range, 80, ARENA_WIDTH - 80),
            clamp(boss.y + Math.sin(angle) * range, 80, ARENA_HEIGHT - 80)
        );
    }

    nearestAlivePlayer(enemy) {
        let best = null;
        let bestDistance = Infinity;
        this.players.forEach((player) => {
            if (player.downed || player.health <= 0) return;
            const currentDistance = this.distance(enemy, player);
            if (currentDistance < bestDistance) {
                best = player;
                bestDistance = currentDistance;
            }
        });
        return best;
    }

    createBullet({ ownerId, source, texture, x, y, angle, speed, damage, expiresIn = 950 }) {
        const id = crypto.randomUUID();
        this.bullets.set(id, {
            id,
            ownerId,
            source,
            texture,
            x,
            y,
            rotation: angle,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            damage,
            expiresAt: Date.now() + expiresIn
        });
    }

    fireEnemyBullet(enemy, target, texture, spread, speed, damage) {
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x) + spread;
        this.createBullet({
            ownerId: enemy.id,
            source: 'enemy',
            texture,
            x: enemy.x + Math.cos(angle) * 38,
            y: enemy.y + Math.sin(angle) * 38,
            angle,
            speed,
            damage,
            expiresIn: 1700
        });
    }

    updateBossPhase(enemy) {
        if (enemy.type !== 'boss') return;
        const ratio = enemy.health / enemy.maxHealth;
        const phase = ratio <= 0.25 ? 4 : ratio <= 0.5 ? 3 : ratio <= 0.75 ? 2 : 1;
        if (phase === enemy.phase) return;
        enemy.phase = phase;
        this.bossPhase = phase;
        enemy.speed = 72 + phase * 14;
        enemy.fireCooldown = Math.max(520, 1300 - phase * 190);
        enemy.bulletDamage = 16 + phase * 5;
        enemy.weapon = phase >= 3 ? 'banana-storm' : 'banana-barrage';
    }

    tryEnemyShot(enemy, target, now) {
        if (enemy.weapon === 'exploder') return;
        if (now < enemy.nextShotAt || this.distance(enemy, target) > enemy.shootRange) return;
        enemy.nextShotAt = now + enemy.fireCooldown + randomInt(-120, 180);
        if (enemy.weapon === 'banana-storm') {
            [-0.34, -0.17, 0, 0.17, 0.34].forEach((spread) => {
                this.fireEnemyBullet(enemy, target, 'bossBullet', spread, ENEMY_BULLET_SPEED * 0.86, enemy.bulletDamage);
            });
        } else if (enemy.weapon === 'banana-barrage') {
            [-0.18, 0, 0.18].forEach((spread) => {
                this.fireEnemyBullet(enemy, target, 'bossBullet', spread, ENEMY_BULLET_SPEED * 0.8, enemy.bulletDamage);
            });
        } else if (enemy.weapon === 'cannon') {
            this.fireEnemyBullet(enemy, target, 'bruteBullet', 0, ENEMY_BULLET_SPEED * 0.78, enemy.bulletDamage);
        } else if (enemy.weapon === 'stinger') {
            this.fireEnemyBullet(enemy, target, 'minionBullet', 0, ENEMY_BULLET_SPEED * 1.2, enemy.bulletDamage);
        } else if (enemy.weapon === 'sniper') {
            this.fireEnemyBullet(enemy, target, 'bruteBullet', 0, ENEMY_BULLET_SPEED * 1.55, enemy.bulletDamage);
        } else if (enemy.weapon === 'shield-blaster') {
            this.fireEnemyBullet(enemy, target, 'enemyBullet', -0.08, ENEMY_BULLET_SPEED * 0.86, enemy.bulletDamage);
            this.fireEnemyBullet(enemy, target, 'enemyBullet', 0.08, ENEMY_BULLET_SPEED * 0.86, enemy.bulletDamage);
        } else if (enemy.weapon === 'medic') {
            this.fireEnemyBullet(enemy, target, 'minionBullet', 0, ENEMY_BULLET_SPEED * 0.92, enemy.bulletDamage);
        } else {
            this.fireEnemyBullet(enemy, target, 'enemyBullet', 0, ENEMY_BULLET_SPEED, enemy.bulletDamage);
        }
    }

    handlePlayerShoot(player, message) {
        const now = Date.now();
        if (now < player.nextShotAt || player.downed || player.health <= 0) return;
        const gun = String(message.gun || 'blaster');
        const damage = clamp(Number(message.damage || 20), 1, 160);
        const fireDelay = clamp(Number(message.fireDelay || 145), 55, 800);
        const angle = Number(message.angle || player.rotation || 0);
        const fire = (spread, speed, bulletDamage, texture) => this.createBullet({
            ownerId: player.id,
            source: 'player',
            texture,
            x: player.x + Math.cos(angle + spread) * 34,
            y: player.y + Math.sin(angle + spread) * 34,
            angle: angle + spread,
            speed,
            damage: bulletDamage
        });

        if (gun === 'spread') {
            fire(-0.18, BULLET_SPEED * 0.94, Math.max(8, damage - 5), 'bullet');
            fire(0, BULLET_SPEED, damage, 'bullet');
            fire(0.18, BULLET_SPEED * 0.94, Math.max(8, damage - 5), 'bullet');
        } else if (gun === 'burst') {
            fire(-0.07, BULLET_SPEED * 1.05, Math.max(7, damage - 7), 'enemyBullet');
            fire(0, BULLET_SPEED * 1.08, Math.max(7, damage - 7), 'enemyBullet');
            fire(0.07, BULLET_SPEED * 1.05, Math.max(7, damage - 7), 'enemyBullet');
        } else if (gun === 'cannon') {
            fire(0, BULLET_SPEED * 0.76, damage + 35, 'bruteBullet');
        } else if (gun === 'beam') {
            fire(0, BULLET_SPEED * 1.38, damage + 18, 'minionBullet');
        } else if (gun === 'launcher') {
            fire(0, BULLET_SPEED * 0.62, damage + 52, 'bossBullet');
        } else if (gun === 'rail') {
            fire(0, BULLET_SPEED * 1.62, damage + 42, 'bruteBullet');
        } else if (gun === 'rifle') {
            fire(0, BULLET_SPEED * 1.18, damage + 12, 'bullet');
        } else {
            fire(0, BULLET_SPEED, damage, 'bullet');
        }

        const multiplier = { burst: 1.08, cannon: 1.55, beam: 0.9, launcher: 1.85, rail: 1.35, rifle: 0.86, spread: 1.08 }[gun] || 1;
        player.nextShotAt = now + Math.round(fireDelay * multiplier);
    }

    dropCoins(x, y, amount, rarity = 'common') {
        for (let i = 0; i < amount; i += 1) {
            const angle = randomBetween(0, Math.PI * 2);
            const range = randomInt(10, 58);
            const id = crypto.randomUUID();
            this.coins.set(id, {
                id,
                x: x + Math.cos(angle) * range,
                y: y + Math.sin(angle) * range,
                value: rarity === 'legendary' ? 3 : rarity === 'epic' ? 2 : 1,
                rarity
            });
        }
    }

    damagePlayer(player, amount) {
        if (player.invulnerableUntil > Date.now() || player.downed) return;
        player.health = Math.max(0, player.health - amount);
        if (player.health <= 0) {
            player.downed = true;
            player.reviveProgress = 0;
        }
    }

    updateEnemySupport(enemy, now) {
        if (enemy.type !== 'medic' || now < enemy.nextHealAt) return;
        enemy.nextHealAt = now + 2200;
        this.enemies.forEach((ally) => {
            if (ally.id === enemy.id || ally.type === 'boss') return;
            if (this.distance(enemy, ally) > 185) return;
            ally.health = Math.min(ally.maxHealth, ally.health + 2);
        });
    }

    explodeEnemy(enemy, now) {
        this.players.forEach((player) => {
            if (player.downed || player.health <= 0) return;
            if (this.distance(enemy, player) <= 150) this.damagePlayer(player, enemy.damage);
        });
        this.dropCoins(enemy.x, enemy.y, 2, 'epic');
        this.enemies.delete(enemy.id);
        this.nextWaveAt = now + 900;
    }

    updateEnemies(delta, now) {
        if (this.enemies.size === 0 && now > this.nextWaveAt) {
            if (this.wave >= BOSS_AFTER_WAVE && !this.bossDefeated) {
                this.spawnBossEncounter(now);
            } else {
                this.spawnWave();
            }
        }

        if (this.bossActive && now > this.nextBossMinionAt) {
            this.spawnBossMinion();
            this.nextBossMinionAt = now + 2300;
        }

        this.enemies.forEach((enemy) => {
            this.updateBossPhase(enemy);
            this.updateEnemySupport(enemy, now);
            const target = this.nearestAlivePlayer(enemy);
            if (!target) return;
            const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
            const distance = this.distance(enemy, target);
            if (enemy.type === 'exploder' && distance < 78) {
                this.explodeEnemy(enemy, now);
                return;
            }
            const direction = enemy.type === 'sniper' && distance < 430 ? angle + Math.PI : angle;
            enemy.rotation = angle;
            enemy.x = clamp(enemy.x + Math.cos(direction) * enemy.speed * delta, 40, ARENA_WIDTH - 40);
            enemy.y = clamp(enemy.y + Math.sin(direction) * enemy.speed * delta, 40, ARENA_HEIGHT - 40);
            if (distance < (enemy.type === 'boss' ? 92 : 52)) {
                this.damagePlayer(target, enemy.damage);
            }
            this.tryEnemyShot(enemy, target, now);
        });
    }

    updateBullets(delta, now) {
        this.bullets.forEach((bullet, id) => {
            bullet.x += bullet.vx * delta;
            bullet.y += bullet.vy * delta;
            if (now > bullet.expiresAt || bullet.x < 0 || bullet.x > ARENA_WIDTH || bullet.y < 0 || bullet.y > ARENA_HEIGHT) {
                this.bullets.delete(id);
                return;
            }

            if (bullet.source === 'player') {
                for (const enemy of this.enemies.values()) {
                    const radius = enemy.type === 'boss' ? 150 : ['brute', 'shield'].includes(enemy.type) ? 56 : 42;
                    if (Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) > radius) continue;
                    const damage = bullet.damage * (enemy.type === 'shield' ? 0.48 : 1);
                    enemy.health -= damage;
                    const owner = this.players.get(bullet.ownerId);
                    if (owner) owner.damageDone += damage;
                    this.bullets.delete(id);
                    if (enemy.health <= 0) {
                        const isBoss = enemy.type === 'boss';
                        if (owner) {
                            owner.score += isBoss ? 2000 : this.getEnemyScoreValue(enemy.type);
                            owner.kills += 1;
                        }
                        this.dropCoins(enemy.x, enemy.y, isBoss ? 15 : this.getEnemyCoinValue(enemy.type), isBoss ? 'legendary' : this.getEnemyCoinRarity(enemy.type));
                        if (isBoss) {
                            this.bossActive = false;
                            this.bossDefeated = true;
                            this.nextWaveAt = now + 3600;
                        }
                        this.enemies.delete(enemy.id);
                    }
                    break;
                }
            } else {
                for (const player of this.players.values()) {
                    if (player.downed || player.health <= 0 || Math.hypot(player.x - bullet.x, player.y - bullet.y) > 36) continue;
                    this.damagePlayer(player, bullet.damage);
                    this.bullets.delete(id);
                    break;
                }
            }
        });
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

    getEnemyCoinRarity(type) {
        return {
            brute: 'rare',
            shield: 'rare',
            sniper: 'rare',
            exploder: 'epic',
            medic: 'rare'
        }[type] || 'common';
    }

    updateCoins() {
        this.coins.forEach((coin, id) => {
            for (const player of this.players.values()) {
                if (player.downed || player.health <= 0 || Math.hypot(player.x - coin.x, player.y - coin.y) > 42) continue;
                player.coinsEarned += coin.value;
                player.score += 10 * coin.value;
                this.coins.delete(id);
                break;
            }
        });
    }

    updateRevives(delta) {
        this.players.forEach((downed) => {
            if (!downed.downed) return;
            const helper = [...this.players.values()].find((player) => (
                player.id !== downed.id && !player.downed && player.health > 0 && Math.hypot(player.x - downed.x, player.y - downed.y) < 86
            ));
            if (!helper) {
                downed.reviveProgress = Math.max(0, downed.reviveProgress - delta * 0.7);
                return;
            }
            downed.reviveProgress += delta / REVIVE_SECONDS;
            if (downed.reviveProgress >= 1) {
                downed.downed = false;
                downed.health = Math.ceil(downed.maxHealth * 0.55);
                downed.reviveProgress = 0;
                downed.invulnerableUntil = Date.now() + 1000;
                helper.revives += 1;
                helper.score += 250;
            }
        });
    }

    tick(delta, now) {
        this.players.forEach((player, id) => {
            if (now - player.updatedAt > 30000) {
                player.socket.destroy();
                this.removePlayer(id);
            }
        });
        if (this.players.size === 0) return;
        this.updateEnemies(delta, now);
        this.updateBullets(delta, now);
        this.updateCoins();
        this.updateRevives(delta);
        if (now - this.lastSnapshotAt > 1000 / SNAPSHOT_RATE) {
            this.lastSnapshotAt = now;
            this.broadcast(this.snapshot());
        }
    }

    snapshot() {
        return {
            type: 'snapshot',
            room: this.code,
            map: this.map,
            wave: this.wave,
            bossActive: this.bossActive,
            bossDefeated: this.bossDefeated,
            bossPhase: this.bossPhase,
            players: [...this.players.values()].map((player) => ({
                id: player.id,
                profile: player.profile,
                x: Math.round(player.x),
                y: Math.round(player.y),
                rotation: player.rotation,
                health: player.health,
                maxHealth: player.maxHealth,
                downed: player.downed,
                reviveProgress: player.reviveProgress,
                score: player.score,
                kills: player.kills,
                damageDone: Math.round(player.damageDone),
                revives: player.revives,
                coinsEarned: player.coinsEarned,
                updatedAt: player.updatedAt
            })),
            enemies: [...this.enemies.values()].map((enemy) => ({
                id: enemy.id,
                type: enemy.type,
                phase: enemy.phase || 0,
                x: Math.round(enemy.x),
                y: Math.round(enemy.y),
                rotation: enemy.rotation,
                health: enemy.health,
                maxHealth: enemy.maxHealth
            })),
            bullets: [...this.bullets.values()].map((bullet) => ({
                id: bullet.id,
                texture: bullet.texture,
                x: Math.round(bullet.x),
                y: Math.round(bullet.y),
                rotation: bullet.rotation
            })),
            coins: [...this.coins.values()].map((coin) => ({
                id: coin.id,
                x: Math.round(coin.x),
                y: Math.round(coin.y),
                rarity: coin.rarity,
                value: coin.value
            }))
        };
    }
}

function getRoom(code) {
    const roomCode = sanitizeRoom(code);
    if (!rooms.has(roomCode)) rooms.set(roomCode, new Room(roomCode));
    return rooms.get(roomCode);
}

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Polyblast multiplayer server is running. Active rooms: ${rooms.size}`);
});

server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    const accept = crypto
        .createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

    socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
    ].join('\r\n'));

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const room = getRoom(url.searchParams.get('room'));
    const id = room.addPlayer(socket);

    socket.on('data', (buffer) => {
        const message = parseFrame(buffer);
        const player = room.players.get(id);
        if (!message || !player) return;
        if (message.close) {
            socket.destroy();
            return;
        }
        if (message.type === 'join') {
            player.profile = sanitizeProfile(message.profile);
            room.map = sanitizeMap(message.map || room.map);
        } else if (message.type === 'state') {
            if (!player.downed) {
                player.x = clamp(Number(message.x) || player.x, 0, ARENA_WIDTH);
                player.y = clamp(Number(message.y) || player.y, 0, ARENA_HEIGHT);
            }
            player.rotation = Number(message.rotation) || 0;
            player.maxHealth = clamp(Number(message.maxHealth) || player.maxHealth, 1, 500);
            if (!player.downed && player.health > player.maxHealth) player.health = player.maxHealth;
            player.updatedAt = Date.now();
        } else if (message.type === 'shoot') {
            room.handlePlayerShoot(player, message);
            player.updatedAt = Date.now();
        }
    });

    socket.on('close', () => room.removePlayer(id));
    socket.on('error', () => room.removePlayer(id));
});

setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, code) => {
        room.tick(1 / TICK_RATE, now);
        if (room.players.size === 0 && room.enemies.size === 0 && room.coins.size === 0) {
            rooms.delete(code);
        }
    });
}, 1000 / TICK_RATE);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Polyblast multiplayer server listening on ws://0.0.0.0:${PORT}`);
});
