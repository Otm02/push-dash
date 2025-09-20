import colyseus from 'colyseus'
const { Room } = colyseus
import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema'
import { ARENA_W, ARENA_H, MAX_SPEED, PLAYER_HALF, DASH_SPEED, DASH_DURATION_MS, DASH_COOLDOWN_MS, STUN_MS, RECOIL_MS, RECOIL_SPEED_SCALE, KNOCKBACK_SCALE } from '../../shared/constants.js'

function clamp(v, min, max) { return v < min ? min : v > max ? max : v }
const EPS = 1e-6

// Returns u (0..step) of first intersection between segment P->P+dir*step and circle(center, r), or null
function segmentCircleHit(px, py, dirx, diry, step, cx, cy, r) {
    // dir assumed normalized
    const mx = px - cx
    const my = py - cy
    // Quadratic: u^2 + 2(m·dir)u + (m·m - r^2) = 0
    const b = 2 * (mx * dirx + my * diry)
    const c = mx * mx + my * my - r * r
    const disc = b * b - 4 * c
    if (disc < 0) return null
    const sq = Math.sqrt(disc)
    const t1 = (-b - sq) / 2
    const t2 = (-b + sq) / 2
    // pick the earliest non-negative within segment length
    if (t1 >= -EPS && t1 <= step + EPS) return Math.max(0, Math.min(step, t1))
    if (t2 >= -EPS && t2 <= step + EPS) return Math.max(0, Math.min(step, t2))
    return null
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
})

class ArenaState extends Schema {
    constructor() {
        super()
        this.players = new MapSchema()
        this.hazards = new ArraySchema()
        this.phase = 'lobby' // lobby | running | gameover
        this.seed = Math.floor(Math.random() * 1e9)
        this.roundTimer = 0
    }
}
defineTypes(ArenaState, {
    players: { map: Player },
    hazards: ['string'],
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

        // simulation tick: 20 Hz movement integration
        const tickMs = 50
        this.clock.setInterval(() => {
            const dt = tickMs / 1000
            const now = Date.now()
            this.state.players.forEach((p, id) => {
                const inp = this.inputs.get(id) || { dx: 0, dy: 0, dashPressed: false }

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
                    // Edge-only collision test: segment vs circle (other player's radius = 2*PLAYER_HALF because centers distance must be >= 2*half)
                    let hitInfo = null
                    let hitTarget = null
                    this.state.players.forEach((op, oid) => {
                        if (oid === id) return
                        const u = segmentCircleHit(p.x, p.y, dstate.dir.x, dstate.dir.y, step, op.x, op.y, PLAYER_HALF * 2)
                        if (u !== null && (hitInfo === null || u < hitInfo.u)) {
                            hitInfo = { u }
                            hitTarget = op
                        }
                    })

                    if (hitTarget && hitInfo) {
                        // move attacker to contact point
                        p.x = clamp(p.x + dstate.dir.x * hitInfo.u, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        p.y = clamp(p.y + dstate.dir.y * hitInfo.u, PLAYER_HALF, ARENA_H - PLAYER_HALF)
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
                        p.x = clamp(p.x + dstate.dir.x * step, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        p.y = clamp(p.y + dstate.dir.y * step, PLAYER_HALF, ARENA_H - PLAYER_HALF)
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
                        p.x = clamp(p.x + inp.dx * speed * dt, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        p.y = clamp(p.y + inp.dy * speed * dt, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                    }
                }
            })
            // Post-move separation: prevent overlapping edges between players
            // Resolve minimal push apart along the line connecting centers if centers are closer than 2*PLAYER_HALF
            const ids = Array.from(this.state.players.keys())
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = this.state.players.get(ids[i])
                    const b = this.state.players.get(ids[j])
                    const dx = b.x - a.x
                    const dy = b.y - a.y
                    const dist = Math.hypot(dx, dy)
                    const minDist = PLAYER_HALF * 2
                    if (dist > 0 && dist < minDist - EPS) {
                        const overlap = minDist - dist
                        const nx = dx / dist
                        const ny = dy / dist
                        const half = overlap / 2
                        a.x = clamp(a.x - nx * half, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        a.y = clamp(a.y - ny * half, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                        b.x = clamp(b.x + nx * half, PLAYER_HALF, ARENA_W - PLAYER_HALF)
                        b.y = clamp(b.y + ny * half, PLAYER_HALF, ARENA_H - PLAYER_HALF)
                    }
                }
            }
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
}
