import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function receiptProxyPlugin() {
  return {
    name: 'receipt-proxy',
    configureServer(server) {
      server.middlewares.use('/api/receipt-text', async (request, response) => {
        const requestUrl = new URL(request.url || '', 'http://localhost')
        const target = requestUrl.searchParams.get('url')

        if (!target) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Missing url')
          return
        }

        let targetUrl
        try {
          targetUrl = new URL(target)
        } catch {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Invalid url')
          return
        }
        if (!['http:', 'https:'].includes(targetUrl.protocol)) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Unsupported url')
          return
        }

        try {
          const receiptResponse = await fetch(targetUrl, {
            headers: {
              Accept: 'text/html,application/json,text/plain,*/*',
              'User-Agent': 'groceries-app-receipt-import/1.0',
            },
          })
          const text = await receiptResponse.text()

          response.writeHead(receiptResponse.status, {
            'Cache-Control': 'no-store',
            'Content-Type': receiptResponse.headers.get('content-type') || 'text/plain; charset=utf-8',
          })
          response.end(text)
        } catch (error) {
          response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end(error.message)
        }
      })

      server.middlewares.use('/api/rami-catalog', async (request, response) => {
        const requestUrl = new URL(request.url || '', 'http://localhost')
        const query = requestUrl.searchParams.get('query') || ''
        const store = requestUrl.searchParams.get('store') || '331'

        try {
          const catalogResponse = await fetch('https://www.rami-levy.co.il/api/catalog?', {
            method: 'POST',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/json;charset=UTF-8',
              'User-Agent': 'groceries-app-catalog-match/1.0',
              locale: 'he',
              origin: 'https://www.rami-levy.co.il',
              referer: 'https://www.rami-levy.co.il/he',
            },
            body: JSON.stringify({
              q: query,
              aggs: 1,
              store,
            }),
          })
          const text = await catalogResponse.text()

          response.writeHead(catalogResponse.status, {
            'Cache-Control': 'no-store',
            'Content-Type': catalogResponse.headers.get('content-type') || 'application/json; charset=utf-8',
          })
          response.end(text)
        } catch (error) {
          response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end(error.message)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/groceries-app/',
  plugins: [receiptProxyPlugin(), react(), tailwindcss()],
})
