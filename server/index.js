import express from 'express'
import cors from 'cors'
import pkg from "colyseus"
const { Server } = pkg
import { createServer } from "http"
import { MyRoom } from "./my-room.js"

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
})

const PORT = process.env.PORT || 3000
const server = createServer(app)
const gameServer = new Server({ server })

gameServer.define("my_room", MyRoom)

gameServer.listen(PORT)
console.log(`Server listening on http://localhost:${PORT}`)
