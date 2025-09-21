import { ARENA_W, ARENA_H, PLAYER_SIZE, PLAYER_HALF } from '../../shared/constants.js'

const EPS = 1e-6

function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < (aw + bw) && Math.abs(ay - by) * 2 < (ah + bh)
}

function circleRectOverlap(cx, cy, r, rx, ry, rw, rh) {
    // clamp circle center to rect bounds and test distance
    const halfW = rw / 2, halfH = rh / 2
    const nx = Math.max(rx - halfW, Math.min(cx, rx + halfW))
    const ny = Math.max(ry - halfH, Math.min(cy, ry + halfH))
    const dx = cx - nx, dy = cy - ny
    return (dx * dx + dy * dy) <= (r + EPS) * (r + EPS)
}

export function resolveDeaths(room, hazCtrl) {
    const players = room.state.players
    players.forEach((p, id) => {
        if (!p.alive) return
        // OOB
        if (p.x < 0 || p.x > ARENA_W || p.y < 0 || p.y > ARENA_H) {
            kill(room, p, id, 'oob')
            return
        }
        // Hazards
        for (const hz of hazCtrl.list) {
            if (hz.type === 'laser') {
                const lethal = hz.phase === 'lethal'
                if (!lethal) continue
                for (const r of hz.rects) {
                    if (aabbOverlap(p.x, p.y, PLAYER_SIZE, PLAYER_SIZE, r.x, r.y, r.w, r.h)) {
                        kill(room, p, id, 'laser')
                        return
                    }
                }
            } else if (hz.type === 'dagger') {
                const r = (hz.r ?? (Math.max(hz.w || 0, hz.h || 0) / 2)) || 8
                if (circleRectOverlap(hz.x, hz.y, r, p.x, p.y, PLAYER_SIZE, PLAYER_SIZE)) {
                    kill(room, p, id, 'dagger')
                    return
                }
            } else if (hz.type === 'trap') {
                const lethal = hz.phase === 'lethal'
                if (!lethal) continue
                if (aabbOverlap(p.x, p.y, PLAYER_SIZE, PLAYER_SIZE, hz.x, hz.y, hz.w, hz.h)) {
                    kill(room, p, id, 'trap')
                    return
                }
            }
        }
    })
}

function kill(room, player, id, cause) {
    player.alive = false
    player.vx = 0
    player.vy = 0
    player.stunMs = 0
    player.cooldownMs = 0
    // stop dash for this player if any
    const d = room.dash?.get(id)
    if (d) d.active = false
    // emit event for UI
    try { room.broadcast('playerDied', { id, cause }) } catch { }
}
