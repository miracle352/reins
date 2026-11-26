import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [nodePolyfills({ include: ['buffer'], globals: { Buffer: true } })],
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
  build: { target: 'esnext' },
})
