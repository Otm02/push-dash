import Phaser from 'phaser'
import { ARENA_W, ARENA_H, MAX_SPEED, PLAYER_HALF, PLAYER_SIZE, TICK_MS } from '@shared/constants.js'
import { bindHazards } from './hazards.js'

const SELF_COLOR = 0x4caf50
const OTHER_COLOR = 0x03a9f4
const BG_COLOR = 0x111111
const BOUNDS_COLOR = 0xffffff
const SQUARE_SIZE = PLAYER_SIZE

export class GameScene extends Phaser.Scene {
    constructor(room) {
        super('GameScene')
        this.room = room
        this.sprites = new Map()
        this.targets = new Map() // id -> {x,y}
        this.selfServerPos = null
        this._sendAcc = 0
        this._sendRateMs = TICK_MS
        this._otherLerp = 0.2
        this._selfCorrection = 0.08
        this.localDead = false
        this.deathText = null
    }

    preload() {
        // Hazard assets
        this.load.image('knife', 'assets/knife.png');
        this.load.image('spike-warning', 'assets/spike warning.png');
        this.load.image('spike', 'assets/spike.png');

        //sound
        this.load.audio("spike", 'assets/Spike.mp3');
        this.load.audio("laser", "assets/laser wah.mp3")
    }

    create() {
        const cam = this.cameras.main
        this.cameras.main.setBackgroundColor(BG_COLOR)

        // Overscan 10% beyond arena on all sides
        const overscan = 0.1
        const viewW = ARENA_W * (1 + overscan * 2)
        const viewH = ARENA_H * (1 + overscan * 2)
        const viewX = -ARENA_W * overscan
        const viewY = -ARENA_H * overscan
        cam.setBounds(viewX, viewY, viewW, viewH)

        // Fit camera to show overscan area
        const gameW = this.scale.width
        const gameH = this.scale.height
        const zoomX = gameW / viewW
        const zoomY = gameH / viewH
        cam.setZoom(Math.min(zoomX, zoomY))
        cam.centerOn(ARENA_W / 2, ARENA_H / 2)

        // Background and arena bounds
        const g = this.add.graphics()
        g.fillStyle(0x1e1e1e, 1)
        g.fillRect(viewX, viewY, viewW, viewH)
        g.lineStyle(2, BOUNDS_COLOR, 1)
        g.strokeRect(0, 0, ARENA_W, ARENA_H)

        // Room info
        this.add.text(viewX + 8, viewY + 8, `Room: ${this.room?.id ?? 'unknown'}`, { color: '#bbb' })

        // Hook to state changes to create/update/destroy player squares
        this._bindState()
        // Render hazards from state deterministically
        bindHazards(this, this.room.state.hazards)

        // Listen for death events to provide UX feedback and stop local control
        if (this.room && typeof this.room.onMessage === 'function') {
            this.room.onMessage('playerDied', (payload) => {
                if (!payload || !payload.id) return
                if (payload.id === this.room.sessionId) {
                    this.localDead = true
                    if (!this.deathText) {
                        this.deathText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'You Died', {
                            fontSize: '48px',
                            color: '#ff4d4d',
                            fontStyle: 'bold',
                        }).setOrigin(0.5)
                        this.deathText.setScrollFactor(0)
                        this.deathText.setDepth(1000)
                    }
                }
            })
        }

        // Input keys
        this.keys = this.input.keyboard.addKeys({
            w: Phaser.Input.Keyboard.KeyCodes.W,
            a: Phaser.Input.Keyboard.KeyCodes.A,
            s: Phaser.Input.Keyboard.KeyCodes.S,
            d: Phaser.Input.Keyboard.KeyCodes.D,
            shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
            space: Phaser.Input.Keyboard.KeyCodes.SPACE,
        })
    }

    _bindState() {
        const state = this.room.state
        // existing players
        state.players.forEach((p, id) => this._ensureSprite(id, p))

        // Subscribe using MapSchema event methods
        state.players.onAdd((p, id) => {
            this._ensureSprite(id, p)
        })
        state.players.onChange((p, id) => {
            this._updateSprite(id, p)
        })
        state.players.onRemove((_, id) => {
            this._removeSprite(id)
        })
    }

    _ensureSprite(id, player) {
        if (this.sprites.has(id)) {
            this._updateSprite(id, player)
            return
        }
        const color = (typeof player.color === 'number') ? player.color : (id === this.room.sessionId ? SELF_COLOR : OTHER_COLOR)
        const rect = this.add.rectangle(player.x, player.y, SQUARE_SIZE, SQUARE_SIZE, color)
        rect.setOrigin(0.5)
        this.sprites.set(id, rect)

        // Ensure sprite depth
        rect.setDepth(1)

        this.targets.set(id, { x: player.x, y: player.y })
        if (id === this.room.sessionId) {
            this.selfServerPos = { x: player.x, y: player.y }
        }

        // Also react to per-player changes
        if (typeof player.onChange === 'function') {
            player.onChange(() => this._updateSprite(id, player))
        }
    }

    _updateSprite(id, player) {
        const rect = this.sprites.get(id)
        if (!rect) return
        // Store latest server positions as targets
        this.targets.set(id, { x: player.x, y: player.y })
        if (id === this.room.sessionId) {
            this.selfServerPos = { x: player.x, y: player.y }
        }
        if (typeof player.color === 'number' && rect.fillColor !== player.color) {
            rect.fillColor = player.color
            rect.isFilled = true
        }
    }

    update(_time, delta) {
        const dt = delta / 1000
        const selfId = this.room.sessionId
        const selfRect = this.sprites.get(selfId)
        if (selfRect && !this.localDead) {
            // Immediate local movement (prediction)
            let dx = 0, dy = 0
            if (this.keys.w.isDown) dy -= 1
            if (this.keys.s.isDown) dy += 1
            if (this.keys.a.isDown) dx -= 1
            if (this.keys.d.isDown) dx += 1
            // One-shot dash press detection
            if (!this._dashPrev) this._dashPrev = { shift: false, space: false }
            const nowShift = this.keys.shift.isDown
            const nowSpace = this.keys.space.isDown
            const dashPressed = (!this._dashPrev.shift && nowShift) || (!this._dashPrev.space && nowSpace)
            this._dashPrev.shift = nowShift
            this._dashPrev.space = nowSpace
            if (dashPressed) {
                // queue and also send immediately to reduce latency
                this._dashPending = true
                this.room.send('input', { dx, dy, dashPressed: true, t: Date.now() })
            }
            if (dx !== 0 || dy !== 0) {
                const len = Math.hypot(dx, dy)
                dx /= len
                dy /= len
                selfRect.x += dx * MAX_SPEED * dt
                selfRect.y += dy * MAX_SPEED * dt
            }
            // Clamp to arena bounds
            selfRect.x = Phaser.Math.Clamp(selfRect.x, PLAYER_HALF, ARENA_W - PLAYER_HALF)
            selfRect.y = Phaser.Math.Clamp(selfRect.y, PLAYER_HALF, ARENA_H - PLAYER_HALF)
            // Smooth correction towards server position
            if (this.selfServerPos) {
                selfRect.x += (this.selfServerPos.x - selfRect.x) * this._selfCorrection
                selfRect.y += (this.selfServerPos.y - selfRect.y) * this._selfCorrection
            }
            // No separate hitbox graphic; sprite position is authoritative
            // Throttled input send
            this._sendAcc += delta
            if (this._sendAcc >= this._sendRateMs) {
                this._sendAcc = 0
                const oneShot = this._dashPending === true
                this.room.send('input', { dx, dy, dashPressed: oneShot, t: Date.now() })
                this._dashPending = false
            }
        }

        // Lerp others towards server targets
        this.sprites.forEach((rect, id) => {
            if (id === selfId) return
            const t = this.targets.get(id)
            if (!t) return
            rect.x += (t.x - rect.x) * this._otherLerp
            rect.y += (t.y - rect.y) * this._otherLerp
            // No separate hitbox graphic
        })
    }

    _removeSprite(id) {
        const rect = this.sprites.get(id)
        if (rect) {
            rect.destroy()
            this.sprites.delete(id)
        }
        // No separate hitbox graphic to remove
    }
}

export function launchGame(room) {
    const config = {
        type: Phaser.AUTO,
        parent: 'game',
        width: 800,
        height: 600,
        scene: [new GameScene(room)],
        backgroundColor: '#111',
    }
    return new Phaser.Game(config)
}
