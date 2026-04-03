import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'node:path'

const devProxyTarget = process.env.VITE_DEV_BACKEND_TARGET || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
    plugins: [svelte()],
    build: {
        outDir: path.resolve(__dirname, '../Backend/dist'),
        emptyOutDir: true
    },
    server: {
        host: '127.0.0.1',
        proxy: {
            '/api': {
                target: devProxyTarget,
                changeOrigin: true,
            },
        },
    },
})
