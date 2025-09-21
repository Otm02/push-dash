// Client-side hazard renderer: bind to state.hazards (MapSchema<string>)
// and draw simple Phaser Graphics for lasers, daggers, and traps deterministically.

export function bindHazards(scene, hazardMap) {
    const nodesById = new Map() // id -> display object
    const prevById = new Map()  // id -> previous state for interpolation

    const draw = (node, hz) => {
        if (!node) return
        if (!hz) return
        if (hz.type === 'laser') {
            const gfx = node
            gfx.clear()
            const colorTele = 0xffe082 // amber telegraph
            const colorLethal = 0x02c4fa // cyan lethal
            const alpha = hz.phase === 'telegraph' ? 0.25 : hz.phase === 'lethal' ? 0.9 : 0.15
            gfx.fillStyle(hz.phase === 'lethal' ? colorLethal : colorTele, alpha)
            const rects = hz.rects || []
            for (const r of rects) {
                gfx.fillRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h)
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
        // store previous for interp
        const prev = prevById.get(id)
        prevById.set(id, { ...(prev || hz) })

        let node = nodesById.get(id)
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
        draw(node, hz)
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

    return { dispose }
}
