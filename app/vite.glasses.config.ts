// The glasses app hosted at /glasses/, so anyone can open it in the Even Hub simulator without installing anything.
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  base: '/glasses/',
  publicDir: false,
  plugins: [nodePolyfills({ include: ['buffer'], globals: { Buffer: true } })],
  build: { target: 'esnext', outDir: '../site/glasses', emptyOutDir: true },
})
