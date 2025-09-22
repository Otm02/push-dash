import { Client } from 'colyseus.js'

// Flexible WS endpoint resolution:
// - Dev: ws(s)://localhost:PORT (VITE_WS_PORT default 3000)
// - Prod default: same-origin
// - Overrides (highest precedence first):
//   1) URL ?ws=wss://host[:port]
//   2) window.PUSH_DASH_WS_URL
//   3) import.meta.env.VITE_WS_URL
const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const host = location.hostname
const devPort = (import.meta?.env?.VITE_WS_PORT) || 3000
const urlWsParam = (() => { try { return new URLSearchParams(location.search).get('ws') } catch { return null } })()
const globalWs = (typeof window !== 'undefined' && window.PUSH_DASH_WS_URL) ? String(window.PUSH_DASH_WS_URL) : null
const envWs = (import.meta?.env?.VITE_WS_URL) || null

let WS_ENDPOINT
if (isDev) {
    WS_ENDPOINT = `${protocol}://localhost:${devPort}`
} else if (urlWsParam) {
    WS_ENDPOINT = urlWsParam
} else if (globalWs) {
    WS_ENDPOINT = globalWs
} else if (envWs) {
    WS_ENDPOINT = envWs
} else {
    const port = (location.port || '')
    WS_ENDPOINT = `${protocol}://${host}${port ? `:${port}` : ''}`
}

const client = new Client(WS_ENDPOINT)

export async function createOrJoin(roomName = 'arena', options = {}) {
    try {
        return await client.joinOrCreate(roomName, options)
    } catch (err) {
        // If joinOrCreate fails because room is full or not available, try create
        try {
            return await client.create(roomName, options)
        } catch (err2) {
            // Lastly try join any
            return await client.joinOrCreate(roomName, options)
        }
    }
}

export async function joinById(roomId) {
    return await client.joinById(roomId)
}

export function getClient() {
    return client
}
