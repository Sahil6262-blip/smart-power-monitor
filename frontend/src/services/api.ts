export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const WS =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/live`

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/api${path}`, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const detail = Array.isArray(body.detail)
      ? body.detail.map((e: { msg: string }) => e.msg).join('. ')
      : body.detail
    throw new Error(detail || `Request failed (${response.status})`)
  }
  return response.json()
}

export async function download(path: string, filename: string) {
  const response = await fetch(`${API}/api${path}`, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error('Export failed. Please try again.')
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
