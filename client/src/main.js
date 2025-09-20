import { createOrJoin, joinById } from './net.js'
import { launchGame } from './GameScene.js'

const lobbyEl = document.getElementById('lobby')
const statusEl = document.getElementById('status')

async function startFromQuery() {
    const params = new URLSearchParams(location.search)
    const roomId = params.get('roomId')
    if (roomId) {
        try {
            setStatus('Joining room...')
            const room = await joinById(roomId)
            onConnected(room)
        } catch (e) {
            setStatus('Join failed')
            console.error(e)
        }
    }
}

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
}

async function onQuickplay() {
    try {
        setStatus('Matching...')
        const room = await createOrJoin('arena', {})
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
        const room = await joinById(id)
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
    startFromQuery()
}

boot()
