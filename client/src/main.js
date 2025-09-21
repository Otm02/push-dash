import { createOrJoin, joinById } from './net.js'
import { launchGame } from './GameScene.js'

const lobbyEl = document.getElementById('lobby')
const statusEl = document.getElementById('status')
const nameInput = document.getElementById('nameInput')
const readyBtn = document.getElementById('readyBtn')
const readyInfo = document.getElementById('readyInfo')
const hud = document.getElementById('hud')
const gameoverEl = document.getElementById('gameover')
const winnerText = document.getElementById('winnerText')
const rematchBtn = document.getElementById('rematchBtn')
const menuBtn = document.getElementById('menuBtn')
const rematchInfo = document.getElementById('rematchInfo')
const scoreInfo = document.getElementById('scoreInfo')
const scoreBoard = document.getElementById('scoreBoard')

// Note: We intentionally ignore any roomId in the URL on page load.
// Only the explicit "Join by ID" action should consider a room ID.

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || ''
}

function onConnected(room) {
    lobbyEl.style.display = 'none'
    setStatus('')
    launchGame(room)
    // log join/leave
    room.onStateChange.once(() => console.log('[client] first state'))
    room.onLeave(() => console.log('[client] left room'))

    // Show ready HUD
    if (hud) hud.style.display = 'block'
    if (readyBtn) {
        readyBtn.disabled = false
        readyBtn.textContent = 'Ready'
        readyBtn.onclick = () => {
            room.send('ready', {})
        }
    }
    if (readyInfo) readyInfo.textContent = 'Waiting in lobby...'

    // Reflect ready state and phase from server
    const updateReadyText = () => {
        if (!readyInfo) return
        const pmap = room.state.players
        const players = []
        let selfReady = false
        pmap.forEach((p, id) => {
            const you = id === room.sessionId ? ' (you)' : ''
            const rdy = p.ready ? '✅' : '⏳'
            players.push(`${p.name || 'Player'}${you}: ${rdy}`)
            if (id === room.sessionId) selfReady = !!p.ready
        })
        const n = players.length
        const allReady = players.length > 0 && players.every(line => line.includes('✅'))
        readyInfo.textContent = `Players ${n}/4 — ${allReady ? 'all ready' : 'waiting'} | ` + players.join(' | ')
        if (readyBtn) readyBtn.textContent = selfReady ? 'Unready' : 'Ready'
    }

    // HUD scores: build compact list from state.scores using player names (do not touch modal scoreboard)
    const updateScoreHUD = () => {
        try {
            const lines = []
            const byId = new Map()
            room.state.players.forEach((p, id) => byId.set(id, p.name || 'Player'))
            room.state.scores?.forEach((v, id) => {
                const nm = byId.get(id) || 'Player'
                lines.push(`${nm}: ${v}`)
            })
            const txt = lines.length ? lines.join(' | ') : ''
            if (scoreInfo) scoreInfo.textContent = txt
        } catch { }
    }

    // existing players
    room.state.players.forEach((p, _id) => {
        if (typeof p.onChange === 'function') p.onChange(() => updateReadyText())
    })
    room.state.players.onAdd((p, _id) => {
        if (typeof p.onChange === 'function') p.onChange(() => updateReadyText())
        updateReadyText()
        updateScoreHUD()
    })
    room.state.players.onChange((_p, _id) => { updateReadyText(); updateScoreHUD() })
    room.state.players.onRemove((_p, _id) => { updateReadyText(); updateScoreHUD() })
    updateReadyText()
    updateScoreHUD()

    // Keep HUD scores in sync with server state changes
    try {
        room.state.scores?.onAdd?.(() => updateScoreHUD())
        room.state.scores?.onChange?.(() => updateScoreHUD())
        room.state.scores?.onRemove?.(() => updateScoreHUD())
    } catch { }

    // Phase changes hide ready UI when running
    const handlePhase = () => {
        const phase = room.state.phase
        if (phase === 'running' || phase === 'starting') {
            if (hud) hud.style.display = 'none'
            if (readyInfo) readyInfo.textContent = phase === 'starting' ? 'Starting...' : 'Match started!'
            if (gameoverEl) gameoverEl.style.display = 'none'
        } else if (phase === 'lobby') {
            if (hud) hud.style.display = 'block'
            if (gameoverEl) gameoverEl.style.display = 'none'
        }
    }
    // Room state is a Schema; listen to changes with onChange where available
    if (typeof room.state.onChange === 'function') room.state.onChange(handlePhase)
    handlePhase()

    // Game over events and UI
    const showGameOver = (winnerId, scores) => {
        if (!gameoverEl || !winnerText) return
        let winnerName = '—'
        const p = room.state.players.get(winnerId)
        if (p) winnerName = p.name || winnerName
        winnerText.textContent = `Winner: ${winnerName}`
        gameoverEl.style.display = 'flex'
        if (rematchBtn) { rematchBtn.disabled = false }
        if (rematchInfo) rematchInfo.textContent = `Rematch: 0 / ${room.state.players.size}`
        const byId = new Map()
        room.state.players.forEach((pl, id) => byId.set(id, pl.name || 'Player'))
        if (scoreBoard) {
            const lines = []
            if (scores) {
                // Prefer server-provided snapshot for immediate accuracy
                Object.entries(scores).forEach(([id, val]) => {
                    const nm = byId.get(id) || 'Player'
                    lines.push(`${nm}: ${val}`)
                })
            } else {
                // Fallback to current state if snapshot is missing (e.g., reconnect during gameover)
                try {
                    room.state.scores?.forEach((v, id) => {
                        const nm = byId.get(id) || 'Player'
                        lines.push(`${nm}: ${v}`)
                    })
                } catch { }
            }
            scoreBoard.textContent = lines.join('\n')
        }
    }
    room.onMessage?.('gameOver', (payload) => {
        showGameOver(payload?.winnerId, payload?.scores)
        // Update only the HUD; don't overwrite the modal scoreboard which uses the accurate snapshot
        updateScoreHUD()
    })
    room.onMessage?.('gameStart', () => { updateScoreHUD() })
    // In case client loads after gameover, poll phase
    if (room.state.phase === 'gameover') showGameOver(room.state.winnerId)

    if (rematchBtn) rematchBtn.onclick = () => {
        room.send('rematch')
        rematchBtn.disabled = true
    }
    room.onMessage?.('rematchStatus', (payload) => {
        const yesList = payload?.yes || []
        const total = payload?.total || room.state.players.size
        if (rematchInfo) rematchInfo.textContent = `Rematch: ${yesList.length} / ${total}`
    })
    if (menuBtn) menuBtn.onclick = async () => {
        try {
            // optionally send chosen name to server before leaving
            const name = nameInput?.value?.trim()
            if (name) room.send('setName', { name })
        } catch { }
        try { await room.leave(true) } catch { }
        // Return to main menu UI
        lobbyEl.style.display = 'flex'
        if (gameoverEl) gameoverEl.style.display = 'none'
        if (hud) hud.style.display = 'none'
    }
}

async function onQuickplay() {
    try {
        setStatus('Matching...')
        const chosen = nameInput?.value?.trim()
        const options = chosen ? { name: chosen } : {}
        const room = await createOrJoin('arena', options)
        // Update URL with roomId for shareability
        const url = new URL(location.href)
        url.searchParams.set('roomId', room.id)
        history.replaceState({}, '', url.toString())
        onConnected(room)
    } catch (e) {
        setStatus(`Quickplay failed: ${e?.message || 'unknown error'}`)
        console.error(e)
    }
}

async function onJoinById() {
    const input = document.getElementById('roomIdInput')
    const id = input?.value?.trim()
    if (!id) return setStatus('Enter a Room ID')
    try {
        setStatus('Joining...')
        const chosen = nameInput?.value?.trim()
        const room = await joinById(id, chosen ? { name: chosen } : {})
        const url = new URL(location.href)
        url.searchParams.set('roomId', room.id)
        history.replaceState({}, '', url.toString())
        onConnected(room)
    } catch (e) {
        setStatus(`Join failed: ${e?.message || 'unknown error'}`)
        console.error(e)
    }
}

function boot() {
    document.getElementById('quickplay')?.addEventListener('click', onQuickplay)
    document.getElementById('joinById')?.addEventListener('click', onJoinById)
    // No auto-join from URL to avoid stale IDs breaking Quickplay
}

boot()
