let displayZone = 'Asia/Kolkata'
export function setDisplayZone(zone: string) {
  displayZone = zone
}
export const number = (value: number | undefined | null, digits = 1) =>
  value == null
    ? '—'
    : value.toLocaleString('en-IN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
export const money = (value?: number) => (value == null ? '—' : `₹${number(value, 2)}`)
export const time = (stamp?: string | null, seconds = false) =>
  stamp
    ? new Date(stamp).toLocaleTimeString('en-IN', {
        timeZone: displayZone,
        hour: '2-digit',
        minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
        hour12: false,
      })
    : '—'
export const date = (stamp: string) =>
  new Date(stamp).toLocaleDateString('en-IN', {
    timeZone: displayZone,
    day: '2-digit',
    month: 'short',
  })
export const titleCase = (s: string) =>
  s.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
