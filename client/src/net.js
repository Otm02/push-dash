import { Client } from 'colyseus.js'

// Use the Express/Colyseus server in dev (port 3000),
// and same-origin in production (server also serves client build).
const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const host = location.hostname
const devPort = (import.meta?.env?.VITE_WS_PORT) || 3000
const port = isDev ? devPort : (location.port || '')
const WS_ENDPOINT = `${protocol}://${host}${port ? `:${port}` : ''}`
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
