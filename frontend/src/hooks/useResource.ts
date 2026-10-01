import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api'
import { useLive } from '../context/LiveContext'
import { offlineResource } from '../services/offlineResources'

export function useResource<T>(path: string | null, revision = 0, refreshMs = 0) {
  const { mode, session, settings, device } = useLive()
  const offline = mode === 'offline-device'
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const refresh = useCallback(() => setReload((x) => x + 1), [])
  useEffect(() => {
    if (!path || offline) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const load = async () => {
      try {
        const result = await api<T>(path, { signal: controller.signal })
        if (!controller.signal.aborted) {
          setData(result)
          setError('')
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Unable to connect')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    const timer = refreshMs ? setInterval(load, refreshMs) : undefined
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [path, revision, reload, refreshMs, offline])
  if (offline) {
    try {
      return {
        data: path ? (offlineResource(path, session, settings, device) as T) : null,
        error: '',
        loading: false,
        refresh,
      }
    } catch (e) {
      return { data: null, error: (e as Error).message, loading: false, refresh }
    }
  }
  return { data, error, loading, refresh }
}
