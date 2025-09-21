// Inject configurable WS endpoint to the client via a global.
// Example: set PUSH_DASH_WS_URL=wss://your-domain.com before launching.
const { contextBridge } = require('electron')

try {
    const url = process.env.PUSH_DASH_WS_URL
    if (url) {
        // Expose to page
        Object.defineProperty(global, 'PUSH_DASH_WS_URL', {
            value: url,
            writable: false,
            enumerable: false,
            configurable: false
        })
        // Also attach on window when DOM loads
        window.addEventListener('DOMContentLoaded', () => {
            try { window.PUSH_DASH_WS_URL = url } catch { }
        })
    }
} catch { }
