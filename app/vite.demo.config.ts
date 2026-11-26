// Builds the browser demo of the phone page into site/app, served at /app/.
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  base: '/app/',
  publicDir: false,
  plugins: [nodePolyfills({ include: ['buffer'], globals: { Buffer: true } })],
  build: { target: 'es2020', outDir: '../site/app', emptyOutDir: true, rollupOptions: { input: 'demo.html' } },
})
