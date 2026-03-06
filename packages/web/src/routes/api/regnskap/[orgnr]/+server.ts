import type { RequestHandler } from './$types'

const SECURITY_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'private, max-age=3600',
}

export const GET: RequestHandler = async ({ params }) => {
  const orgnr = params.orgnr
  if (!/^\d{9}$/.test(orgnr)) {
    return new Response(JSON.stringify({ error: 'Ugyldig format' }), {
      status: 400,
      headers: SECURITY_HEADERS,
    })
  }

  const url = `https://data.brreg.no/regnskapsregisteret/regnskap/${encodeURIComponent(orgnr)}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  })

  return new Response(res.body, {
    status: res.status,
    headers: SECURITY_HEADERS,
  })
}