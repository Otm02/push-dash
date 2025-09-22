import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import colyseus from 'colyseus'
import { ArenaRoom } from './rooms/ArenaRoom.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json())

// Health check
app.get('/health', (_req, res) => {
    res.json({ ok: true })
})

// Serve built client in production
if (process.env.NODE_ENV === 'production') {
    const clientDist = resolve(__dirname, '../client/dist')
    app.use(express.static(clientDist))
    app.get('*', (_req, res) => {
        res.sendFile(join(clientDist, 'index.html'))
    })
}

// Create HTTP server and attach Colyseus
const server = createServer(app)
const { Server } = colyseus
const gameServer = new Server({ server })

// Define rooms
gameServer.define('arena', ArenaRoom)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`)
})
