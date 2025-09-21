// Minimal Electron shell for the client, with configurable WS endpoint.
// Use env PUSH_DASH_WS_URL to point to your live server (wss://...)
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: false,
            preload: resolve(__dirname, 'preload.cjs')
        }
    })

    // Serve built client files; assumes you ran `npm run build` (client)
    const indexPath = resolve(__dirname, '../client/dist/index.html')
    win.loadFile(indexPath)
}

app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})
