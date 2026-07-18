import { createServer } from 'node:http'
import { timingSafeEqual, webcrypto } from 'node:crypto'

const host = '127.0.0.1'
const port = Number(process.env.RECEIPT_BRIDGE_PORT || 8787)
const secret = process.env.RECEIPT_BRIDGE_SECRET || ''
const maxReceiptBytes = 5 * 1024 * 1024
const maxRequestBytes = 8 * 1024
const encryptionContext = new TextEncoder().encode('groceries-receipt-bridge-v1')

if (secret.length < 32) {
  console.error('RECEIPT_BRIDGE_SECRET must contain at least 32 characters.')
  process.exit(1)
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method === 'GET' && request.url === '/health') {
    respond(response, 200, 'ok')
    return
  }

  if (request.method !== 'POST' || request.url !== '/receipt') {
    respond(response, 404, 'Not found')
    return
  }

  if (!authorized(request.headers.authorization)) {
    respond(response, 401, 'Unauthorized')
    return
  }

  try {
    const envelope = JSON.parse(await readRequestBody(request))
    const payload = JSON.parse(await decrypt(envelope))
    const receiptUrl = validateReceiptUrl(payload?.url)
    const upstream = await fetch(receiptUrl, {
      headers: {
        Accept: 'text/html,application/json,text/plain,*/*',
        'User-Agent': 'groceries-app-receipt-import/1.0',
      },
      signal: AbortSignal.timeout(20_000),
    })

    const declaredLength = Number(upstream.headers.get('content-length') || 0)
    if (declaredLength > maxReceiptBytes) throw new HttpError(413, 'Receipt response is too large')

    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.byteLength > maxReceiptBytes) throw new HttpError(413, 'Receipt response is too large')

    const encryptedResponse = await encrypt(JSON.stringify({
      status: upstream.status,
      contentType: upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
      text: new TextDecoder().decode(bytes),
    }))
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    })
    response.end(JSON.stringify(encryptedResponse))
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502
    const message = error instanceof Error ? error.message : 'Receipt request failed'
    respond(response, status, message)
  }
})

server.listen(port, host, () => {
  console.log(`Receipt bridge listening on http://${host}:${port}`)
})

function authorized(value = '') {
  const prefix = 'Bearer '
  if (!value.startsWith(prefix)) return false
  const supplied = Buffer.from(value.slice(prefix.length))
  const expected = Buffer.from(secret)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

async function encrypt(value) {
  const key = await encryptionKey()
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encryptionContext },
    key,
    new TextEncoder().encode(value),
  )
  return { iv: base64Url(iv), data: base64Url(new Uint8Array(encrypted)) }
}

async function decrypt(value) {
  if (!value || typeof value.iv !== 'string' || typeof value.data !== 'string') {
    throw new HttpError(400, 'Invalid encrypted request')
  }
  try {
    const decrypted = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(value.iv), additionalData: encryptionContext },
      await encryptionKey(),
      fromBase64Url(value.data),
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    throw new HttpError(400, 'Invalid encrypted request')
  }
}

async function encryptionKey() {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return webcrypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

function validateReceiptUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new HttpError(400, 'Invalid receipt URL')
  }
  if (url.protocol !== 'https:' || url.hostname !== 'digi.rami-levy.co.il') {
    throw new HttpError(400, 'Receipt host is not allowed')
  }
  const receiptId = url.pathname.split('/').filter(Boolean).at(-1) || ''
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(receiptId)) throw new HttpError(400, 'Invalid receipt ID')
  return url
}

async function readRequestBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxRequestBytes) throw new HttpError(413, 'Request is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(body)
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
