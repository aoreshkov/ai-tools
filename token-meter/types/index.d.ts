export type Limit = { kind: string; percentUsed: number; resetsAt: string | null }

export type Meter = {
  percent: number | null
  tokens: number | null
  window: number
  usd: number | null
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { meter: Meter | null; isHidden: boolean; effort: string | null; branch: string | null }
  }
}
