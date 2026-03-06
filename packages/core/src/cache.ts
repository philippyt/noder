interface CacheEntry<T> {
  data: T
  expires: number
}

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>()

  get<T>(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expires) {
      this.store.delete(key)
      return null
    }
    return entry.data as T
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.store.set(key, {
      data,
      expires: Date.now() + ttlSeconds * 1000,
    })
  }

  invalidate(key: string): void {
    this.store.delete(key)
  }
}

export const cache = new Cache()

export const TTL = {
  ENHET: 86400,
  ROLLER: 86400,
  REGNSKAP: 604800,
  REGNSKAP_EMPTY: 3600,
  SØK: 3600,
} as const
