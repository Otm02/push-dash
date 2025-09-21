import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    root: __dirname,
    // Allow hosting under a subpath like /push-dash on athmanebenarous.com
    base: process.env.VITE_BASE || '/',
    resolve: {
        alias: {
            '@shared': fileURLToPath(new URL('../shared', import.meta.url))
        }
    },
    server: {
        port: 5173,
        open: false,
        fs: {
            // allow importing from monorepo root (shared/)
            allow: [fileURLToPath(new URL('..', import.meta.url))]
        }
    },
    build: {
        outDir: 'dist'
    }
})
