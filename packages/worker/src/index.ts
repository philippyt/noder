const ROUTES: Record<string, string> = {
  '/api/brreg/': 'https://data.brreg.no/enhetsregisteret/api/',
  '/api/regnskap/': 'https://data.brreg.no/regnskapsregisteret/regnskap/',
}

function matchRoute(pathname: string): { upstream: string; rest: string } | null {
  for (const [prefix, upstream] of Object.entries(ROUTES)) {
    if (pathname.startsWith(prefix)) {
      return { upstream, rest: pathname.slice(prefix.length) }
    }
  }
  return null
}

function getTtl(pathname: string): number {
  // /api/regnskap/*
  if (pathname.startsWith('/api/regnskap/')) return 604800

  // /api/brreg/enheter/{orgnr} exact (no sub-path, no query)
  const enheterMatch = pathname.match(/^\/api\/brreg\/enheter\/\d+$/)
  if (enheterMatch) return 86400

  // /api/brreg/enheter/{orgnr}/roller
  if (/^\/api\/brreg\/enheter\/\d+\/roller$/.test(pathname)) return 86400

  // /api/brreg/underenheter with query params
  if (pathname === '/api/brreg/underenheter') return 86400

  // /api/brreg/enheter with query params (search)
  if (pathname === '/api/brreg/enheter') return 3600

  return 3600
}

function normalizeCacheKey(url: URL): string {
  const sorted = new URLSearchParams([...url.searchParams.entries()].sort())
  return `${url.origin}${url.pathname}${sorted.size ? '?' + sorted.toString() : ''}`
}

function corsHeaders(): Record<string, string> {
  return { 'Access-Control-Allow-Origin': '*' }
}

function jsonResponse(body: Record<string, string>, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extra },
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Accept, Content-Type',
        },
      })
    }

    const url = new URL(request.url)
    const route = matchRoute(url.pathname)

    if (!route) {
      return jsonResponse({ error: 'Not found' }, 404)
    }

    const cacheKey = normalizeCacheKey(url)
    const cache = caches.default

    const cached = await cache.match(cacheKey)
    if (cached) {
      const resp = new Response(cached.body, cached)
      resp.headers.set('X-Cache', 'HIT')
      resp.headers.set('Access-Control-Allow-Origin', '*')
      return resp
    }

    const upstreamUrl = route.upstream + route.rest + (url.search || '')

    const headers: Record<string, string> = {}
    const accept = request.headers.get('Accept')
    if (accept) headers['Accept'] = accept
    const contentType = request.headers.get('Content-Type')
    if (contentType) headers['Content-Type'] = contentType

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(upstreamUrl, { headers })
    } catch {
      return jsonResponse({ error: 'Upstream error' }, 502)
    }

    if (!upstreamResponse.ok) {
      return jsonResponse({ error: 'Upstream error' }, 502)
    }

    const ttl = getTtl(url.pathname)
    const responseHeaders = new Headers(upstreamResponse.headers)
    responseHeaders.delete('Set-Cookie')
    responseHeaders.set('Cache-Control', `public, max-age=${ttl}`)
    responseHeaders.set('X-Cache', 'MISS')
    responseHeaders.set('Access-Control-Allow-Origin', '*')

    const body = await upstreamResponse.arrayBuffer()
    const response = new Response(body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    })

    const cacheResponse = new Response(body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    })
    await cache.put(cacheKey, cacheResponse)

    return response
  },
}
