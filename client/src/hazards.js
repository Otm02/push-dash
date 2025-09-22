// Client-side hazard renderer: bind to state.hazards (MapSchema<string>)
// and draw simple Phaser Graphics for lasers, daggers, and traps deterministically.
// Textures are preloaded in GameScene via Vite-imported assets.

export function bindHazards(scene, hazardMap) {
    const nodesById = new Map() // id -> display object
    const prevById = new Map()  // id -> previous state for interpolation

    const draw = (node, hz) => {
        if (!node) return
        if (!hz) return
        if (hz.type === 'laser') {
            const gfx = node
            gfx.clear()
            const colorTele = 0xff8a80 // soft red telegraph
            const colorLethal = 0xff1744 // bright red lethal
            const targetAlpha = hz.phase === 'telegraph' ? 0.3 : hz.phase === 'lethal' ? 0.9 : 0.15
            // Use node alpha to control opacity so we can animate spawn
            gfx.setAlpha(1)
            gfx.fillStyle(hz.phase === 'lethal' ? colorLethal : colorTele, 1)
            const rects = hz.rects || []
            for (const r of rects) {
                gfx.fillRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h)
            }
            // If alpha differs significantly, tween towards it for a brief pulse/spawn
            if (typeof targetAlpha === 'number') {
                const cur = node.alpha ?? 1
                if (Math.abs((cur || 0) - targetAlpha) > 0.05) {
                    try {
                        scene.tweens.killTweensOf(node)
                        scene.tweens.add({ targets: node, alpha: targetAlpha, duration: 220, ease: 'sine.out' })
                    } catch { node.alpha = targetAlpha }
                } else {
                    node.alpha = targetAlpha
                }
            }
        } else if (hz.type === 'dagger') {
            const sprite = node
            sprite.setTexture('knife')
            sprite.setPosition(hz.x, hz.y)
            // rotate to velocity if provided
            if (typeof hz.vx === 'number' && typeof hz.vy === 'number') {
                sprite.rotation = Math.atan2(hz.vy, hz.vx) + Math.PI / 2
            }
        } else if (hz.type === 'trap') {
            const sprite = node
            const key = hz.phase === 'telegraph' ? 'spike-warning' : 'spike'
            sprite.setTexture(key)
            sprite.setPosition(hz.x, hz.y)
        }
    }

    const upsert = (id, json) => {
        let hz
        try { hz = JSON.parse(json) } catch { return }
        // retrieve previous for transitions
        const prev = prevById.get(id)

        let node = nodesById.get(id)
        const isNew = !nodesById.has(id)
        if (!node) {
            if (hz.type === 'laser') {
                node = scene.add.graphics()
            } else {
                node = scene.add.image(hz.x || 0, hz.y || 0, 'spike')
                node.setOrigin(0.5)
            }
            node.setDepth(0)
            nodesById.set(id, node)
        }
        if (hz.type === 'laser' && isNew) {
            node.alpha = 0
            // Laser appears
            try { scene.sound?.play('sfx-laser-wah', { volume: 0.7 }) } catch { }
        }
        // Spike appears (trap goes lethal)
        if (hz.type === 'trap') {
            if (prev && prev.phase !== 'lethal' && hz.phase === 'lethal') {
                try { scene.sound?.play('sfx-spike', { volume: 0.8 }) } catch { }
            }
        }
        draw(node, hz)
        // store current as previous for next update
        prevById.set(id, { ...hz })
    }

    const remove = (id) => {
        const g = nodesById.get(id)
        if (g) { g.destroy(); nodesById.delete(id) }
        prevById.delete(id)
    }

    // existing hazards
    hazardMap.forEach((v, id) => upsert(id, v))
    // subscribe
    hazardMap.onAdd((v, id) => upsert(id, v))
    hazardMap.onChange((v, id) => upsert(id, v))
    hazardMap.onRemove((_, id) => remove(id))

    const dispose = () => {
        hazardMap?.onAdd?.(null)
        hazardMap?.onChange?.(null)
        hazardMap?.onRemove?.(null)
        nodesById.forEach(g => g.destroy())
        nodesById.clear()
        prevById.clear()
        if (onUpdate) scene.events.off('update', onUpdate)
    }
    scene.events.once('shutdown', dispose)

    // simple interpolation step per frame for daggers
    const onUpdate = (_time, _delta) => {
        const lerp = scene._otherLerp ?? 0.2
        nodesById.forEach((node, id) => {
            const v = hazardMap.get(id)
            if (!v) return
            let hz
            try { hz = JSON.parse(v) } catch { return }
            if (hz.type === 'dagger') {
                // approach target position smoothly
                node.x += (hz.x - node.x) * lerp
                node.y += (hz.y - node.y) * lerp
            }
        })
    }
    scene.events.on('update', onUpdate)

    // Clear all current hazard visuals but keep listeners active for future updates
    const clear = () => {
        nodesById.forEach(g => g.destroy())
        nodesById.clear()
        prevById.clear()
    }

    return { dispose, clear }
}
