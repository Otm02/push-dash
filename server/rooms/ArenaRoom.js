import colyseus from 'colyseus'
const { Room } = colyseus
import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema'
import { ARENA_W, ARENA_H, MAX_SPEED, PLAYER_HALF, DASH_SPEED, DASH_SHORT_DURATION_MS, DASH_LONG_DURATION_MS, DASH_COOLDOWN_MS, STUN_MS, RECOIL_MS, RECOIL_SPEED_SCALE, KNOCKBACK_SCALE, TICK_MS, WAVE_SECONDS } from '../../shared/constants.js'
import { makeHazards, stepHazards, resolvePlayerHazard, serializeHazards } from '../game/hazards.js'
import { resolveDeaths } from '../game/logic.js'

function clamp(v, min, max) { return v < min ? min : v > max ? max : v }
const EPS = 1e-6

// Ray vs AABB intersection for a segment P -> P + V (t in [0,1]) against box [min,max].
// Returns tEntry in [0,1] for first contact or null if no hit.
function rayVsAABB(px, py, vx, vy, minx, miny, maxx, maxy) {
    let tmin = -Infinity
    let tmax = Infinity

    // X slabs
    if (Math.abs(vx) < EPS) {
        if (px < minx || px > maxx) return null
    } else {
        const tx1 = (minx - px) / vx
        const tx2 = (maxx - px) / vx
        const txmin = Math.min(tx1, tx2)
        const txmax = Math.max(tx1, tx2)
        tmin = Math.max(tmin, txmin)
        tmax = Math.min(tmax, txmax)
    }

    // Y slabs
    if (Math.abs(vy) < EPS) {
        if (py < miny || py > maxy) return null
    } else {
        const ty1 = (miny - py) / vy
        const ty2 = (maxy - py) / vy
        const tymin = Math.min(ty1, ty2)
        const tymax = Math.max(ty1, ty2)
        tmin = Math.max(tmin, tymin)
        tmax = Math.min(tmax, tymax)
    }

    if (tmax < tmin) return null
    // We only care about intersections along the segment [0,1]
    const tEntry = tmin
    if (tEntry < -EPS || tEntry > 1 + EPS) return null
    return Math.max(0, Math.min(1, tEntry))
}

class Player extends Schema {
    constructor() {
        super()
        this.id = ''
        this.name = ''
        this.x = 0
        this.y = 0
        this.color = 0
        this.stunMs = 0
        this.cooldownMs = 0
        this.vx = 0
        this.vy = 0
        this.alive = true
        this.ready = false
    }
}
defineTypes(Player, {
    id: 'string',
    name: 'string',
    x: 'number',
    y: 'number',
    color: 'number',
    stunMs: 'number',
    cooldownMs: 'number',
    vx: 'number',
    vy: 'number',
    alive: 'boolean',
    ready: 'boolean',
})

class ArenaState extends Schema {
    constructor() {
        super()
        this.players = new MapSchema()
        this.hazards = new MapSchema()
        this.phase = 'lobby' // lobby | running | gameover
        this.seed = Math.floor(Math.random() * 1e9)
        this.roundTimer = 0
        this.winnerId = ''
        this.rematchYes = new MapSchema()
        this.scores = new MapSchema()
        this.wave = 1
    }
}
defineTypes(ArenaState, {
    players: { map: Player },
    hazards: { map: 'string' },
    phase: 'string',
    seed: 'number',
    roundTimer: 'number',
    winnerId: 'string',
    rematchYes: { map: 'boolean' },
    scores: { map: 'number' },
    wave: 'number',
})

export class ArenaRoom extends Room {
    constructor() {
        super()
        // Fixed palette: green, blue, yellow, red
        this.PALETTE = [0x00ff00, 0x0000ff, 0xffff00, 0xff0000]
    }
    onCreate(options) {
        this.maxClients = 4
        this.setState(new ArenaState())
        this.setMetadata({ createdAt: Date.now() })
        // ephemeral input states: sessionId -> {dx,dy,dashPressed}
        this.inputs = new Map()
        // dash/recoil ephemeral state
        this.dash = new Map() // id -> { active, dir:{x,y}, endAt:number }
        this.recoilUntil = new Map() // id -> timestamp
        // Hazards controller (server-authoritative)
        this.haz = makeHazards(0, {
            seed: this.state.seed,
            arena: { w: ARENA_W, h: ARENA_H },
            getPlayers: () => Array.from(this.state.players.values())
        })
        this.clock.setInterval(() => {
            if (this.state.phase === 'running') {
                this.state.roundTimer += 1
                const w = Math.floor(this.state.roundTimer / (WAVE_SECONDS || 20)) + 1
                if (w !== this.state.wave) this.state.wave = w
            }
        }, 1000)

        // handle input messages
        this.onMessage('input', (client, data) => {
            let dx = Number(data?.dx) || 0
            let dy = Number(data?.dy) || 0
            const mag = Math.hypot(dx, dy)
            if (mag > 0) { dx /= mag; dy /= mag }
            const dashPressed = !!(data?.dashPressed ?? data?.dash)
            const dashType = (data?.dashType === 'short' || data?.dashType === 'long') ? data.dashType : undefined
            this.inputs.set(client.sessionId, { dx, dy, dashPressed, dashType })
        })

        // simulation tick: movement integration (only when running)
        const tickMs = TICK_MS
        this.clock.setInterval(() => {
            if (this.state.phase !== 'running') {
                return
            }
            const dt = tickMs / 1000
            const now = Date.now()
            // Step hazards and sync into state
            stepHazards(this.haz, dt)
            this._syncHazardsToState()
            this.state.players.forEach((p, id) => {
                const inp = this.inputs.get(id) || { dx: 0, dy: 0, dashPressed: false }

                if (!p.alive) {
                    // Ensure they remain frozen
                    p.vx = 0; p.vy = 0
                    return
                }

                // decrement timers
                if (p.stunMs > 0) p.stunMs = Math.max(0, p.stunMs - tickMs)
                if (p.cooldownMs > 0) p.cooldownMs = Math.max(0, p.cooldownMs - tickMs)

                // dash start
                let dstate = this.dash.get(id)
                if (inp.dashPressed && (!dstate || !dstate.active) && p.cooldownMs === 0) {
                    const dirMag = Math.hypot(inp.dx, inp.dy)
                    if (dirMag > 0) {
                        const dir = { x: inp.dx / dirMag, y: inp.dy / dirMag }
                        const dur = (inp.dashType === 'short') ? DASH_SHORT_DURATION_MS : DASH_LONG_DURATION_MS
                        dstate = { active: true, dir, endAt: now + dur, type: (inp.dashType || 'long') }
                        this.dash.set(id, dstate)
                        p.cooldownMs = DASH_COOLDOWN_MS
                    }
                }

                let movedByDash = false
                if (dstate && dstate.active) {
                    const step = DASH_SPEED * dt
                    const vx = dstate.dir.x * step
                    const vy = dstate.dir.y * step
                    // Swept AABB using Minkowski sum (expand target by attacker's half size)
                    let bestT = null
                    let hitTarget = null
                    this.state.players.forEach((op, oid) => {
                        if (oid === id) return
                        const minx = op.x - (PLAYER_HALF + PLAYER_HALF)
                        const maxx = op.x + (PLAYER_HALF + PLAYER_HALF)
                        const miny = op.y - (PLAYER_HALF + PLAYER_HALF)
                        const maxy = op.y + (PLAYER_HALF + PLAYER_HALF)
                        const t = rayVsAABB(p.x, p.y, vx, vy, minx, miny, maxx, maxy)
                        if (t !== null && (bestT === null || t < bestT)) {
                            bestT = t
                            hitTarget = op
                        }
                    })

                    if (hitTarget !== null && bestT !== null) {
                        // Move attacker to contact point (edge-to-edge)
                        p.x = clamp(p.x + vx * bestT, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        p.y = clamp(p.y + vy * bestT, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                        dstate.active = false
                        const remainTime = Math.max(0, dstate.endAt - now) / 1000
                        const remainDist = remainTime * DASH_SPEED
                        const kb = remainDist * KNOCKBACK_SCALE
                        const nx = dstate.dir.x, ny = dstate.dir.y
                        hitTarget.x = clamp(hitTarget.x + nx * kb, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        hitTarget.y = clamp(hitTarget.y + ny * kb, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                        hitTarget.stunMs = Math.max(hitTarget.stunMs, STUN_MS)
                        this.recoilUntil.set(id, now + RECOIL_MS)
                    } else {
                        // continue dash full step
                        p.x = clamp(p.x + vx, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        p.y = clamp(p.y + vy, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                    }
                    if (now >= dstate.endAt) {
                        dstate.active = false
                    }
                    movedByDash = true
                }

                if (!movedByDash) {
                    // normal movement if not stunned
                    if (p.stunMs === 0) {
                        let speed = MAX_SPEED
                        const recoilUntil = this.recoilUntil.get(id) || 0
                        if (now < recoilUntil) speed *= RECOIL_SPEED_SCALE
                        const mvx = inp.dx * speed
                        const mvy = inp.dy * speed
                        p.vx = mvx
                        p.vy = mvy
                        p.x = clamp(p.x + mvx * dt, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        p.y = clamp(p.y + mvy * dt, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                    }
                }
            })
            // Post-move separation: axis-aligned resolution for overlapping AABBs (squares)
            const ids = Array.from(this.state.players.keys())
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = this.state.players.get(ids[i])
                    const b = this.state.players.get(ids[j])
                    if (!a.alive || !b.alive) continue
                    const dx = b.x - a.x
                    const dy = b.y - a.y
                    const minDist = PLAYER_HALF * 2
                    const overlapX = minDist - Math.abs(dx)
                    const overlapY = minDist - Math.abs(dy)
                    if (overlapX > 0 && overlapY > 0) {
                        // push along the axis of least penetration
                        if (overlapX < overlapY) {
                            const push = overlapX / 2 * Math.sign(dx || 1)
                            a.x = clamp(a.x - push, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                            b.x = clamp(b.x + push, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        } else {
                            const push = overlapY / 2 * Math.sign(dy || 1)
                            a.y = clamp(a.y - push, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                            b.y = clamp(b.y + push, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                        }
                    }
                }
            }

            // Allow overlaps: no pushback resolution vs hazards; death logic will handle kills

            // Death resolution (OOB, lasers, daggers, traps)
            const killedNow = resolveDeaths(this, this.haz)
            // If everyone is dead, determine winner (last to die among this round)
            let aliveCount = 0
            this.state.players.forEach(p => { if (p.alive) aliveCount++ })
            if (aliveCount === 0) {
                // winner is the last ID in killedNow, if present; else fallback to previous alive
                const lastKilled = Array.isArray(killedNow) && killedNow.length > 0 ? killedNow[killedNow.length - 1] : ''
                this.state.winnerId = lastKilled
                // increment winner score
                if (this.state.winnerId) {
                    const prev = Number(this.state.scores.get(this.state.winnerId) || 0)
                    this.state.scores.set(this.state.winnerId, prev + 1)
                }
                this.state.phase = 'gameover'
                // Include snapshot of scores for immediate client display
                const scoreSnapshot = {}
                this.state.scores.forEach((v, k) => { scoreSnapshot[k] = v })
                try { this.broadcast('gameOver', { winnerId: this.state.winnerId, scores: scoreSnapshot, wave: this.state.wave, time: this.state.roundTimer }) } catch { }
            }
        }, tickMs)
        console.log(`[ArenaRoom] created with options`, options)

        // Ready toggle from clients (only in lobby)
        this.onMessage('ready', (client, data) => {
            if (this.state.phase !== 'lobby') return
            const p = this.state.players.get(client.sessionId)
            if (!p) return
            const val = typeof data?.ready === 'boolean' ? !!data.ready : !p.ready
            p.ready = val
            this._startIfReady()
        })

        // Rematch voting: consent required by all current players
        this.onMessage('rematch', (client) => {
            if (this.state.phase !== 'gameover') return
            // record vote
            this.state.rematchYes.set(client.sessionId, true)
            this._broadcastRematchStatus()
            this._maybeStartRematch()
        })

        // Return to main menu (client will leave room). Optionally update name before leaving.
        this.onMessage('setName', (client, data) => {
            const name = String(data?.name || '').trim()
            if (!name) return
            const p = this.state.players.get(client.sessionId)
            if (p) p.name = name
        })
    }

    onJoin(client, options) {
        // Prevent joining mid-game (only allow joins during lobby phase)
        if (this.state.phase !== 'lobby') {
            try { client.error(4000, 'Game already started') } catch { }
            try { client.leave(4000, 'Game already started') } catch { }
            return
        }
        const p = new Player()
        p.id = client.sessionId
        p.name = options?.name || `Player-${client.sessionId.slice(0, 4)}`
        // random spawn inside arena
        p.x = Math.floor(Math.random() * ARENA_W)
        p.y = Math.floor(Math.random() * ARENA_H)
        // assign unique color from palette
        const used = new Set()
        this.state.players.forEach((pl) => {
            if (typeof pl.color === 'number') used.add(pl.color)
        })
        const available = this.PALETTE.find((c) => !used.has(c))
        p.color = available ?? this.PALETTE[0]
        this.state.players.set(client.sessionId, p)
        // initialize score for new player if not present
        if (!this.state.scores.has(client.sessionId)) this.state.scores.set(client.sessionId, 0)
        console.log(`[ArenaRoom] join ${client.sessionId}`)
        // check autostart conditions each join (in case others already ready)
        if (this.state.phase === 'lobby') this._startIfReady()
    }

    onLeave(client, consented) {
        this.state.players.delete(client.sessionId)
        this.inputs?.delete(client.sessionId)
        console.log(`[ArenaRoom] leave ${client.sessionId} consented=${consented}`)
        if (this.state.phase === 'lobby') this._startIfReady()
        // cleanup vote and re-evaluate during gameover
        if (this.state.phase === 'gameover') {
            if (this.state.rematchYes.has(client.sessionId)) this.state.rematchYes.delete(client.sessionId)
            this._broadcastRematchStatus()
            this._maybeStartRematch()
        }
    }

    onDispose() {
        console.log(`[ArenaRoom] disposed`)
    }

    _syncHazardsToState() {
        // Mirror server hazards into schema map as strings for deterministic client display
        const ser = serializeHazards(this.haz)
        // Remove stale
        const toDelete = []
        this.state.hazards.forEach((_v, k) => { if (!ser.has(k)) toDelete.push(k) })
        for (const k of toDelete) this.state.hazards.delete(k)
        // Upsert current
        for (const [k, v] of ser) {
            this.state.hazards.set(k, v)
        }
    }

    _startIfReady() {
        if (this.state.phase !== 'lobby') return
        const players = Array.from(this.state.players.values())
        const n = players.length
        if (n < 2 || n > 4) return
        const allReady = players.every(p => !!p.ready)
        if (!allReady) return
        this._startGame()
    }

    _startGame() {
        // reset seed/hazards
        this.state.seed = Math.floor(Math.random() * 1e9)
        this.haz = makeHazards(0, {
            seed: this.state.seed,
            arena: { w: ARENA_W, h: ARENA_H },
            getPlayers: () => Array.from(this.state.players.values())
        })
        // clear existing hazards in state map
        const keys = []
        this.state.hazards.forEach((_v, k) => keys.push(k))
        for (const k of keys) this.state.hazards.delete(k)
        this._syncHazardsToState()
        // Reset players to fresh round state
        this.state.players.forEach((p, id) => {
            p.alive = true
            p.stunMs = 0
            p.cooldownMs = 0
            p.vx = 0
            p.vy = 0
            // random spawn
            p.x = Math.floor(Math.random() * ARENA_W)
            p.y = Math.floor(Math.random() * ARENA_H)
        })
        // clear ephemeral input/dash/recoil
        this.inputs = new Map()
        this.dash = new Map()
        this.recoilUntil = new Map()
        this.state.roundTimer = 0
        this.state.wave = 1
        this.state.winnerId = ''
        // clear rematch votes
        const toClear = []
        this.state.rematchYes.forEach((_v, k) => toClear.push(k))
        for (const k of toClear) this.state.rematchYes.delete(k)
        this.state.phase = 'running'
        // Build spawn snapshot for clients to snap immediately
        const spawns = {}
        this.state.players.forEach((p, id) => { spawns[id] = { x: p.x, y: p.y } })
        try { this.broadcast('gameStart', { t: Date.now(), spawns }) } catch { }
    }

    _broadcastRematchStatus() {
        try {
            const voters = []
            this.state.rematchYes.forEach((_v, k) => voters.push(k))
            this.broadcast('rematchStatus', { yes: voters, total: this.state.players.size })
        } catch { }
    }

    _maybeStartRematch() {
        if (this.state.phase !== 'gameover') return
        const total = this.state.players.size
        if (total < 2 || total > 4) return
        // if every current player has voted yes
        let yesCount = 0
        this.state.players.forEach((_p, id) => { if (this.state.rematchYes.get(id)) yesCount++ })
        if (yesCount === total) {
            // immediate new round
            this._startGame()
        }
    }
}
