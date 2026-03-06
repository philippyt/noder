export function validateOrgnr(orgnr: string): string {
  const clean = orgnr.replace(/\s/g, '')
  if (!/^\d{9}$/.test(clean)) {
    throw new Error('Ugyldig organisasjonsnummer')
  }
  return clean
}

export function sanitizeSearchInput(input: string): string {
  return input
    .trim()
    .slice(0, 100)
    .replace(/[<>'"]/g, '')
    .replace(/\s+/g, ' ')
}
