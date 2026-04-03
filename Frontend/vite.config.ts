import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'node:path'

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
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
})
