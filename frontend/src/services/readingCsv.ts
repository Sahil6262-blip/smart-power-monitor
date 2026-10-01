import type { Reading } from '../types'

export const CSV_HEADER =
  'Date,Time,Hour,Minute,Voltage (V),Current (A),Active Power (W),Energy (kWh),Frequency (Hz),Power Factor,Source'
const fields = ['voltage', 'current', 'power', 'energy', 'frequency', 'power_factor'] as const

// Read the existing backend CSV into the same model used by BLE/IndexedDB.
export function parseReadingCsv(csv: string): Reading[] {
  const rows: string[][] = []
  let row: string[] = [],
    value = '',
    quoted = false
  csv = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(value)
      value = ''
      if (c !== ',') {
        if (row.some((cell) => cell !== '')) rows.push(row)
        row = []
        if (c === '\r' && csv[i + 1] === '\n') i++
      }
    } else value += c
  }
  if (quoted) throw new Error('Incomplete CSV response. Please retry.')
  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }
  const header = rows.shift() || []
  if (!['timestamp', ...fields].every((field) => header.includes(field)))
    throw new Error('The export response is missing reading fields.')
  return rows.map((cells) => {
    const record = Object.fromEntries(header.map((field, i) => [field, cells[i]]))
    const reading = { timestamp: record.timestamp, source: record.source || '' } as Reading
    for (const field of fields) {
      if (
        record[field] == null ||
        record[field].trim() === '' ||
        !Number.isFinite(Number(record[field]))
      )
        throw new Error('The export contains an invalid reading.')
      reading[field] = Number(record[field])
    }
    return reading
  })
}

function formatter(zone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}
function parts(format: Intl.DateTimeFormat, timestamp: string | Date) {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) throw new Error('The export contains an invalid timestamp.')
  return Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]))
}
function escape(value: string) {
  return /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value
}
function energy(value: number) {
  let result = value.toFixed(6)
  while (result.endsWith('0') && result.split('.')[1].length > 3) result = result.slice(0, -1)
  return result
}
export function readingCsv(readings: Reading[], zone = 'Asia/Kolkata'): string {
  const format = formatter(zone)
  const rows = [...readings].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  return (
    [
      CSV_HEADER,
      ...rows.map((r) => {
        if (!fields.every((field) => Number.isFinite(r[field])))
          throw new Error('The export contains an invalid reading.')
        const p = parts(format, r.timestamp)
        return [
          `${p.day}-${p.month}-${p.year}`,
          `${p.hour}:${p.minute}:${p.second}`,
          p.hour,
          p.minute,
          r.voltage.toFixed(1),
          r.current.toFixed(3),
          r.power.toFixed(1),
          energy(r.energy),
          r.frequency.toFixed(1),
          r.power_factor.toFixed(2),
          r.source || '',
        ]
          .map(escape)
          .join(',')
      }),
    ].join('\r\n') + '\r\n'
  )
}
export function readingFilename(zone = 'Asia/Kolkata', now = new Date()) {
  const p = parts(formatter(zone), now)
  return `smart-power-readings_${p.day}-${p.month}-${p.year}.csv`
}
export function downloadReadingCsv(readings: Reading[], zone: string) {
  const blob = new Blob([readingCsv(readings, zone)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = readingFilename(zone)
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
