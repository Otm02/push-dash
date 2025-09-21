import colyseus from 'colyseus'
const { Room } = colyseus
import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema'
import { ARENA_W, ARENA_H, MAX_SPEED, PLAYER_HALF, DASH_SPEED, DASH_DURATION_MS, DASH_COOLDOWN_MS, STUN_MS, RECOIL_MS, RECOIL_SPEED_SCALE, KNOCKBACK_SCALE, TICK_MS } from '../../shared/constants.js'
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
})

class ArenaState extends Schema {
    constructor() {
        super()
        this.players = new MapSchema()
        this.hazards = new MapSchema()
        this.phase = 'lobby' // lobby | running | gameover
        this.seed = Math.floor(Math.random() * 1e9)
        this.roundTimer = 0
    }
}
defineTypes(ArenaState, {
    players: { map: Player },
    hazards: { map: 'string' },
    phase: 'string',
    seed: 'number',
    roundTimer: 'number',
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
            this.state.roundTimer += 1
        }, 1000)

        // handle input messages
        this.onMessage('input', (client, data) => {
            let dx = Number(data?.dx) || 0
            let dy = Number(data?.dy) || 0
            const mag = Math.hypot(dx, dy)
            if (mag > 0) { dx /= mag; dy /= mag }
            const dashPressed = !!(data?.dashPressed ?? data?.dash)
            this.inputs.set(client.sessionId, { dx, dy, dashPressed })
        })

        // simulation tick: movement integration
        const tickMs = TICK_MS
        this.clock.setInterval(() => {
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
                        dstate = { active: true, dir, endAt: now + DASH_DURATION_MS }
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
            resolveDeaths(this, this.haz)
        }, tickMs)
        console.log(`[ArenaRoom] created with options`, options)
    }

    onJoin(client, options) {
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
        console.log(`[ArenaRoom] join ${client.sessionId}`)
    }

    onLeave(client, consented) {
        this.state.players.delete(client.sessionId)
        this.inputs?.delete(client.sessionId)
        console.log(`[ArenaRoom] leave ${client.sessionId} consented=${consented}`)
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
}
