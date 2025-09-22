import Phaser from 'phaser'
import { ARENA_W, ARENA_H, MAX_SPEED, PLAYER_HALF, PLAYER_SIZE, TICK_MS, DASH_HOLD_THRESHOLD_MS } from '@shared/constants.js'
import { bindHazards } from './hazards.js'
// Vite asset imports ensure files are bundled to dist
import knifePng from '../assets/knife.png'
import spikeWarnPng from '../assets/spike warning.png'
import spikePng from '../assets/spike.png'
import sfxKnife from '../assets/Knife.mp3'
import sfxLaserDeath from '../assets/laser death.mp3'
import sfxLaserWah from '../assets/laser wah.mp3'
import sfxSpike from '../assets/Spike.mp3'

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
        this.phaseText = null
        this._localDash = { active: false, dir: { x: 0, y: 0 }, until: 0 }
        this.timerText = null
        this.waveText = null
        this.hazardBinding = null
        this.countdownText = null
    }

    preload() {
        // Hazard assets (use imported URLs so Vite includes them in dist)
        this.load.image('knife', knifePng)
        this.load.image('spike-warning', spikeWarnPng)
        this.load.image('spike', spikePng)
        // Audio assets
        this.load.audio('sfx-knife', sfxKnife)
        this.load.audio('sfx-laser-death', sfxLaserDeath)
        this.load.audio('sfx-laser-wah', sfxLaserWah)
        this.load.audio('sfx-spike', sfxSpike)
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
        this.hazardBinding = bindHazards(this, this.room.state.hazards)

        // Listen for death events to provide UX feedback and stop local control
        if (this.room && typeof this.room.onMessage === 'function') {
            // Countdown before game start
            this.room.onMessage('preStart', (payload) => {
                // snap spawns so players appear before countdown
                const spawns = payload?.spawns || {}
                this.room.state.players.forEach((p, id) => {
                    this._ensureSprite(id, p)
                    const s = spawns[id] || { x: p.x, y: p.y }
                    const rect = this.sprites.get(id)
                    if (rect) { rect.x = s.x; rect.y = s.y }
                    this.targets.set(id, { x: s.x, y: s.y })
                    if (id === this.room.sessionId) this.selfServerPos = { x: s.x, y: s.y }
                })
                // Show 3-2-1 center overlay with glow
                const centerX = this.scale.width / 2, centerY = this.scale.height / 2
                if (this.countdownText) { this.countdownText.destroy(); this.countdownText = null }
                this.countdownText = this.add.text(centerX, centerY, '3', {
                    fontFamily: 'Orbitron, sans-serif', fontSize: '96px', color: '#ff2d55', fontStyle: 'bold'
                }).setOrigin(0.5)
                this.countdownText.setScrollFactor(0)
                this.countdownText.setDepth(2000)
                // sequence N..1 based on server payload.count (default 3)
                const n = Math.max(1, Math.min(9, Number(payload?.count) || 3))
                const seq = Array.from({ length: n }, (_, k) => String(n - k))
                let i = 0
                const tick = () => {
                    if (!this.countdownText) return
                    this.countdownText.setText(seq[i])
                    this.countdownText.setScale(1)
                    this.tweens.add({ targets: this.countdownText, scale: 1.25, alpha: 0.8, duration: 250, yoyo: true })
                    i++
                    if (i < seq.length) this.time.delayedCall(1000, tick)
                }
                tick()
            })
            this.room.onMessage('playerDied', (payload) => {
                if (!payload || !payload.id) return
                // Play death SFX based on cause
                try {
                    if (payload.cause === 'dagger') {
                        this.sound?.play('sfx-knife', { volume: 0.8 })
                    } else if (payload.cause === 'laser') {
                        this.sound?.play('sfx-laser-death', { volume: 0.8 })
                    }
                } catch { }
                // Remove sprite immediately for responsiveness
                const rect = this.sprites.get(payload.id)
                if (rect) { rect.destroy(); this.sprites.delete(payload.id); this.targets.delete(payload.id) }
                if (payload.id === this.room.sessionId) {
                    this.localDead = true
                    if (!this.deathText) {
                        this.deathText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'YOU DIED', {
                            fontFamily: 'Orbitron, sans-serif', fontSize: '64px', color: '#ff1744', fontStyle: 'bold'
                        }).setOrigin(0.5)
                        this.deathText.setScrollFactor(0)
                        this.deathText.setDepth(2000)
                        this.deathText.alpha = 0
                        this.tweens.add({ targets: this.deathText, alpha: 1, y: this.deathText.y - 8, duration: 280, ease: 'sine.out' })
                    }
                }
            })
            // On new game start, clear death UI, clear hazards, and snap sprites to server spawns
            this.room.onMessage('gameStart', (payload) => {
                this.localDead = false
                if (this.deathText) { this.deathText.destroy(); this.deathText = null }
                if (this.countdownText) {
                    this.tweens.add({ targets: this.countdownText, alpha: 0, duration: 200, onComplete: () => { this.countdownText?.destroy(); this.countdownText = null } })
                }
                // clear client-predicted dash state
                this._localDash.active = false
                // clear hazard visuals immediately; new hazards will stream in via state
                try { this.hazardBinding?.clear?.() } catch { }
                // ensure sprites exist for all players
                this.room.state.players.forEach((p, id) => {
                    this._ensureSprite(id, p)
                    const spawn = payload?.spawns?.[id] || { x: p.x, y: p.y }
                    // snap sprite to server-provided spawn to avoid interpolation from prior round
                    const rect = this.sprites.get(id)
                    if (rect) {
                        rect.x = spawn.x
                        rect.y = spawn.y
                    }
                    this.targets.set(id, { x: spawn.x, y: spawn.y })
                    if (id === this.room.sessionId) {
                        this.selfServerPos = { x: spawn.x, y: spawn.y }
                    }
                })
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
        // Track dash hold timing
        this._dashHold = { isDown: false, startedAt: 0 }

        // Phase overlay
        const updatePhaseOverlay = () => {
            const phase = this.room.state.phase
            if (phase !== 'running') {
                if (!this.phaseText) {
                    this.phaseText = this.add.text(this.scale.width / 2, 40, 'Lobby: get ready...', {
                        fontSize: '20px', color: '#ddd', fontStyle: 'bold'
                    }).setOrigin(0.5)
                    this.phaseText.setScrollFactor(0)
                    this.phaseText.setDepth(1000)
                }
                this.phaseText.setText(phase === 'starting' ? 'Get ready...' : 'Lobby: get ready...')
                this.localDead = false
                if (this.timerText) { this.timerText.destroy(); this.timerText = null }
                if (this.waveText) { this.waveText.destroy(); this.waveText = null }
            } else {
                if (this.phaseText) { this.phaseText.destroy(); this.phaseText = null }
                if (!this.timerText) {
                    this.timerText = this.add.text(8, 8, 'Time: 0s', { fontFamily: 'Orbitron, sans-serif', fontSize: '18px', color: '#64ffda' })
                    this.timerText.setScrollFactor(0)
                    this.timerText.setDepth(1000)
                }
                if (!this.waveText) {
                    this.waveText = this.add.text(8, 28, 'Wave: 1', { fontFamily: 'Orbitron, sans-serif', fontSize: '18px', color: '#64ffda' })
                    this.waveText.setScrollFactor(0)
                    this.waveText.setDepth(1000)
                }
            }
        }
        if (typeof this.room.state.onChange === 'function') {
            this.room.state.onChange(updatePhaseOverlay)
        }
        updatePhaseOverlay()
        // Keep timer/wave text updated each frame
        this.events.on('update', () => {
            if (this.room.state.phase === 'running') {
                if (this.timerText) this.timerText.setText(`Time: ${Math.max(0, this.room.state.roundTimer) | 0}s`)
                if (this.waveText) this.waveText.setText(`Wave: ${this.room.state.wave | 0}`)
            }
        })
    }

    _bindState() {
        const state = this.room.state
        // existing players
        state.players.forEach((p, id) => this._ensureSprite(id, p))

        // Subscribe using MapSchema event methods
        state.players.onAdd((p, id) => { this._ensureSprite(id, p) })
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
        if (player.alive === false) {
            rect.destroy()
            this.sprites.delete(id)
            this.targets.delete(id)
            return
        }
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
        const phaseRunning = this.room.state.phase === 'running'
        if (selfRect && !this.localDead && phaseRunning) {
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
            // hold timing: start on key down, trigger long during hold, short on release if long not fired
            const dashWentDown = (!this._dashPrev.shift && nowShift) || (!this._dashPrev.space && nowSpace)
            const dashWentUp = (this._dashPrev.shift && !nowShift) || (this._dashPrev.space && !nowSpace)
            if (dashWentDown) {
                this._dashHold.isDown = true
                this._dashHold.startedAt = performance.now()
                this._dashHold.longFired = false
            }
            let dashPressed = false
            let dashType = undefined
            // Fire long dash once when threshold exceeded while still holding
            if (this._dashHold.isDown && !this._dashHold.longFired) {
                const held = performance.now() - this._dashHold.startedAt
                if (held >= DASH_HOLD_THRESHOLD_MS) {
                    dashType = 'long'
                    dashPressed = true
                    this._dashHold.longFired = true
                    // start local dash prediction immediately
                    const len = Math.hypot(dx, dy) || 1
                    const dirx = dx / len, diry = dy / len
                    this._localDash.active = true
                    this._localDash.dir.x = dirx
                    this._localDash.dir.y = diry
                    // assume long duration locally (ms)
                    this._localDash.until = performance.now() + 1000
                }
            }
            // On release: if long didn't fire, trigger short
            if (!dashPressed && dashWentUp && this._dashHold.isDown) {
                if (!this._dashHold.longFired) {
                    dashType = 'short'
                    dashPressed = true
                    const len = Math.hypot(dx, dy) || 1
                    const dirx = dx / len, diry = dy / len
                    this._localDash.active = true
                    this._localDash.dir.x = dirx
                    this._localDash.dir.y = diry
                    // assume short duration locally (ms)
                    this._localDash.until = performance.now() + 250
                }
                this._dashHold.isDown = false
                this._dashHold.longFired = false
            }
            this._dashPrev.shift = nowShift
            this._dashPrev.space = nowSpace
            if (dashPressed) {
                // queue and also send immediately to reduce latency
                this._dashPending = true
                this._pendingDashType = dashType
                this.room.send('input', { dx, dy, dashPressed: true, dashType, t: Date.now() })
            }
            if (dx !== 0 || dy !== 0) {
                const len = Math.hypot(dx, dy)
                dx /= len
                dy /= len
                // If not dashing locally, apply normal movement prediction
                if (!this._localDash.active) {
                    selfRect.x += dx * MAX_SPEED * dt
                    selfRect.y += dy * MAX_SPEED * dt
                }
            }
            // Apply local dash prediction
            if (this._localDash.active) {
                const nowt = performance.now()
                const step = 400 * dt
                selfRect.x += this._localDash.dir.x * step
                selfRect.y += this._localDash.dir.y * step
                if (nowt >= this._localDash.until) this._localDash.active = false
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
                const dashTypeSend = oneShot ? (this._pendingDashType || undefined) : undefined
                this.room.send('input', { dx, dy, dashPressed: oneShot, dashType: dashTypeSend, t: Date.now() })
                this._dashPending = false
                this._pendingDashType = undefined
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
        scale: {
            mode: Phaser.Scale.RESIZE,
            parent: 'game',
            autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        width: '100%',
        height: '100%',
        scene: [new GameScene(room)],
        backgroundColor: '#111',
    }
    return new Phaser.Game(config)
}
