import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const apiTarget = process.env.VITE_DEV_API_TARGET || process.env.VITE_API_BASE || 'http://127.0.0.1:3100'

export default defineConfig({
  plugins: [
    {
      name: 'homesense-moonlight-trailing-slash',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if ((req.method === 'GET' || req.method === 'HEAD') && req.url?.match(/^\/moonlight(?:\?.*)?$/)) {
            const queryIndex = req.url.indexOf('?')
            const query = queryIndex >= 0 ? req.url.slice(queryIndex) : ''
            res.writeHead(308, { location: `/moonlight/${query}` })
            res.end()
            return
          }
          next()
        })
      },
    },
    vue(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT || 5173),
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
      '/moonlight': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
