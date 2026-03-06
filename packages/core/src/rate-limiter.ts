export class RateLimiter {
  private calls: number[] = []
  private maxCalls: number
  private windowMs: number

  constructor(maxCalls = 10, windowMs = 10000) {
    this.maxCalls = maxCalls
    this.windowMs = windowMs
  }

  async throttle(): Promise<void> {
    const now = Date.now()
    this.calls = this.calls.filter(t => t > now - this.windowMs)

    if (this.calls.length >= this.maxCalls) {
      const waitMs = this.calls[0]! + this.windowMs - now
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }

    this.calls.push(Date.now())
  }
}

export const rateLimiter = new RateLimiter()
