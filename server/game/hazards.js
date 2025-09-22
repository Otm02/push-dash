import { ARENA_W, ARENA_H, PLAYER_SIZE, DAGGER_MARGIN, TRAP_OFF_MS } from '../../shared/constants.js'

// Simple deterministic RNG (mulberry32)
function mulberry32(seed) {
    let t = seed >>> 0
    return function () {
        t += 0x6D2B79F5
        let r = Math.imul(t ^ (t >>> 15), 1 | t)
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
}

function randRange(rng, min, max) { return min + (max - min) * rng() }
function randInt(rng, min, max) { return Math.floor(randRange(rng, min, max + 1)) }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)] }

// Axis-aligned rectangle overlap test (center-based)
export function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < (aw + bw) && Math.abs(ay - by) * 2 < (ah + bh)
}

// Controller to hold hazards and deterministic scheduler
export function makeHazards(initialCount = 0, opts = {}) {
    const seed = (opts.seed ?? 12345) >>> 0
    const rng = mulberry32(seed)
    const ctrl = {
        rng,
        elapsed: 0,
        nextId: 1,
        arena: { w: ARENA_W, h: ARENA_H, ...(opts.arena || {}) },
        getPlayers: typeof opts.getPlayers === 'function' ? opts.getPlayers : () => [],
        list: [],
        // base spawn delays (seconds)
        baseDelays: {
            laser: 4.0,
            dagger: 0.9,
            trap: 3.0,
        },
        timers: {
            laser: 1.0,
            dagger: 0.2,
            trap: 1.5,
        },
    }
    for (let i = 0; i < initialCount; i++) {
        ctrl.list.push(makeRandomHazard(ctrl))
    }
    return ctrl
}

function rampMultiplier(elapsed) {
    // every 20s reduce delays by 15% (i.e., multiply by 0.85)
    const steps = Math.floor(elapsed / 20)
    return Math.pow(0.85, steps)
}

function newId(ctrl) { return String(ctrl.nextId++) }

function makeRandomHazard(ctrl) {
    const t = pick(ctrl.rng, ['laser', 'dagger', 'trap'])
    if (t === 'laser') return makeLaser(ctrl)
    if (t === 'dagger') return makeDagger(ctrl)
    return makeTrap(ctrl)
}

function makeLaser(ctrl) {
    const { w, h } = ctrl.arena
    const dir = pick(ctrl.rng, ['horizontal', 'vertical', 'cross'])
    let rects
    if (dir === 'horizontal') {
        const y = randRange(ctrl.rng, 0.15 * h, 0.85 * h)
        rects = [{ x: w / 2, y, w: w, h: 40 }]
    } else if (dir === 'vertical') {
        const x = randRange(ctrl.rng, 0.15 * w, 0.85 * w)
        rects = [{ x, y: h / 2, w: 40, h: h }]
    } else {
        rects = [
            { x: w / 2, y: randRange(ctrl.rng, 0.2 * h, 0.8 * h), w: w, h: 36 },
            { x: randRange(ctrl.rng, 0.2 * w, 0.8 * w), y: h / 2, w: 36, h: h },
        ]
    }
    return {
        id: newId(ctrl),
        type: 'laser',
        phase: 'telegraph', // telegraph -> lethal -> off -> done
        t: 0.8, // telegraph duration
        lethalFor: randRange(ctrl.rng, 1.2, 2.0),
        offFor: 0.3,
        rects,
        alive: true,
    }
}

function makeDagger(ctrl) {
    const { w, h } = ctrl.arena
    const edges = ['top', 'bottom', 'left', 'right']
    const edge = pick(ctrl.rng, edges)
    let x, y
    const m = DAGGER_MARGIN || 10
    if (edge === 'top') { x = randRange(ctrl.rng, 0, w); y = -m }
    else if (edge === 'bottom') { x = randRange(ctrl.rng, 0, w); y = h + m }
    else if (edge === 'left') { x = -m; y = randRange(ctrl.rng, 0, h) }
    else { x = w + m; y = randRange(ctrl.rng, 0, h) }
    // aim towards farthest player at spawn time (deterministic), fallback to arena center
    const players = ctrl.getPlayers() || []
    let tx = w / 2, ty = h / 2
    if (players.length > 0) {
        let bestD2 = -1
        for (const p of players) {
            const ddx = p.x - x
            const ddy = p.y - y
            const d2 = ddx * ddx + ddy * ddy
            if (d2 > bestD2) { bestD2 = d2; tx = p.x; ty = p.y }
        }
    }
    let dx = tx - x, dy = ty - y
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    const spread = 0.15
    dx += randRange(ctrl.rng, -spread, spread)
    dy += randRange(ctrl.rng, -spread, spread)
    const dl = Math.hypot(dx, dy) || 1
    dx /= dl; dy /= dl
    const speed = 380
    const r = 8
    return {
        id: newId(ctrl),
        type: 'dagger',
        phase: 'lethal',
        x, y,
        vx: dx * speed,
        vy: dy * speed,
        r,
        edge,
        alive: true,
    }
}

function makeTrap(ctrl) {
    const { w, h } = ctrl.arena
    const tw = PLAYER_SIZE, th = PLAYER_SIZE
    const x = randRange(ctrl.rng, tw / 2, w - tw / 2)
    const y = randRange(ctrl.rng, th / 2, h - th / 2)
    return {
        id: newId(ctrl),
        type: 'trap',
        phase: 'telegraph',
        t: 0.7,
        lethalFor: 1.0,
        offFor: (TRAP_OFF_MS ?? 1000) / 1000,
        x, y, w: tw, h: th,
        alive: true,
    }
}

export function stepHazards(ctrl, dt) {
    ctrl.elapsed += dt
    const mult = rampMultiplier(ctrl.elapsed)
    // Spawn cadence
    for (const k of Object.keys(ctrl.timers)) {
        ctrl.timers[k] -= dt
    }
    const schedule = (kind) => {
        const base = ctrl.baseDelays[kind]
        ctrl.timers[kind] += base * mult * (0.8 + 0.4 * ctrl.rng())
        ctrl.list.push(kind === 'laser' ? makeLaser(ctrl) : kind === 'dagger' ? makeDagger(ctrl) : makeTrap(ctrl))
    }
    if (ctrl.timers.laser <= 0) schedule('laser')
    if (ctrl.timers.dagger <= 0) schedule('dagger')
    if (ctrl.timers.trap <= 0) schedule('trap')

    // Update
    for (const hz of ctrl.list) {
        if (!hz.alive) continue
        if (hz.type === 'laser') {
            if (hz.phase === 'telegraph') {
                hz.t -= dt
                if (hz.t <= 0) { hz.phase = 'lethal'; hz.t = hz.lethalFor }
            } else if (hz.phase === 'lethal') {
                hz.t -= dt
                if (hz.t <= 0) { hz.phase = 'off'; hz.t = hz.offFor }
            } else if (hz.phase === 'off') {
                hz.t -= dt
                if (hz.t <= 0) { hz.alive = false }
            }
        } else if (hz.type === 'dagger') {
            hz.x += hz.vx * dt
            hz.y += hz.vy * dt
            // despawn once it fully crosses the arena to the opposite margin
            const m = DAGGER_MARGIN || 10
            if (hz.edge === 'top' && hz.y > ctrl.arena.h + m) hz.alive = false
            else if (hz.edge === 'bottom' && hz.y < -m) hz.alive = false
            else if (hz.edge === 'left' && hz.x > ctrl.arena.w + m) hz.alive = false
            else if (hz.edge === 'right' && hz.x < -m) hz.alive = false
        } else if (hz.type === 'trap') {
            if (hz.phase === 'telegraph') {
                hz.t -= dt
                if (hz.t <= 0) { hz.phase = 'lethal'; hz.t = hz.lethalFor }
            } else if (hz.phase === 'lethal') {
                hz.t -= dt
                if (hz.t <= 0) { hz.phase = 'off'; hz.t = hz.offFor }
            } else if (hz.phase === 'off') {
                hz.t -= dt
                if (hz.t <= 0) { hz.alive = false }
            }
        }
    }
    // cull
    ctrl.list = ctrl.list.filter(h => h.alive)
}

// Push player out of a lethal hazard using AABB separation; 'clamp' keeps player in arena bounds
export function resolvePlayerHazard(player, hz, clamp) {
    // Only affect during lethal phase (daggers are always lethal)
    const lethal = hz.type === 'dagger' || hz.phase === 'lethal'
    if (!lethal) return false

    const pw = PLAYER_SIZE, ph = PLAYER_SIZE
    if (hz.type === 'laser') {
        for (const r of hz.rects) {
            if (aabbOverlap(player.x, player.y, pw, ph, r.x, r.y, r.w, r.h)) {
                // separate along least penetration axis
                separate(player, r, clamp)
                return true
            }
        }
        return false
    } else {
        const rx = hz.x, ry = hz.y, rw = hz.w, rh = hz.h
        if (aabbOverlap(player.x, player.y, pw, ph, rx, ry, rw, rh)) {
            separate(player, { x: rx, y: ry, w: rw, h: rh }, clamp)
            return true
        }
        return false
    }
}

function separate(player, rect, clamp) {
    const dx = rect.x - player.x
    const dy = rect.y - player.y
    const overlapX = (PLAYER_SIZE + rect.w) / 2 - Math.abs(dx)
    const overlapY = (PLAYER_SIZE + rect.h) / 2 - Math.abs(dy)
    if (overlapX > 0 && overlapY > 0) {
        if (overlapX < overlapY) {
            const push = overlapX * Math.sign(dx || 1)
            player.x = clamp(player.x - push, PLAYER_SIZE / 2, ARENA_W - PLAYER_SIZE / 2)
        } else {
            const push = overlapY * Math.sign(dy || 1)
            player.y = clamp(player.y - push, PLAYER_SIZE / 2, ARENA_H - PLAYER_SIZE / 2)
        }
    }
}

// Serialize hazards for state (id -> JSON string)
export function serializeHazards(ctrl) {
    const out = new Map()
    for (const hz of ctrl.list) {
        if (hz.type === 'laser') {
            out.set(hz.id, JSON.stringify({ id: hz.id, type: hz.type, phase: hz.phase, rects: hz.rects }))
        } else if (hz.type === 'dagger') {
            out.set(hz.id, JSON.stringify({ id: hz.id, type: hz.type, x: hz.x, y: hz.y, r: hz.r, vx: hz.vx, vy: hz.vy }))
        } else if (hz.type === 'trap') {
            out.set(hz.id, JSON.stringify({ id: hz.id, type: hz.type, phase: hz.phase, x: hz.x, y: hz.y, w: hz.w, h: hz.h }))
        }
    }
    return out
}
