import { Panel } from '../UI'
import { number } from '../../utils/format'
import { deviceTotals } from '../../types/device'
import type { InventoryDevice } from '../../types/device'

export function powerLabel(watts: number) {
  return watts >= 1000 ? `${number(watts / 1000, 2)} kW` : `${number(watts, 1)} W`
}
export function DeviceOverview({
  devices,
  meteredLoadW,
}: {
  devices: InventoryDevice[]
  meteredLoadW: number | null
}) {
  const totals = deviceTotals(devices, meteredLoadW)
  const items = [
    {
      title: 'Total Devices',
      value: number(totals.total, 0),
      note: `${devices.length} configured groups · Units counted`,
    },
    { title: 'Active Devices', value: number(totals.active, 0), note: 'Manually marked active' },
    {
      title: 'Estimated Device Load',
      value: powerLabel(totals.knownLoadW),
      note: 'Rated power × active quantity',
    },
    {
      title: 'Actual Metered Load',
      value: meteredLoadW === null ? 'Unavailable' : powerLabel(meteredLoadW),
      note: meteredLoadW === null ? 'Metered load unavailable' : 'PZEM · Total circuit consumption',
    },
  ]
  return (
    <div className="inventory-overview">
      {items.map((item) => (
        <Panel key={item.title} className="inventory-stat">
          <h2>{item.title}</h2>
          <strong>{item.value}</strong>
          <p>{item.note}</p>
        </Panel>
      ))}
    </div>
  )
}

export function DeviceLoadComparison({
  devices,
  meteredLoadW,
}: {
  devices: InventoryDevice[]
  meteredLoadW: number | null
}) {
  const { knownLoadW, unassignedLoadW } = deviceTotals(devices, meteredLoadW)
  const fraction =
    meteredLoadW && meteredLoadW > 0 ? Math.min(100, (knownLoadW / meteredLoadW) * 100) : 0
  return (
    <Panel className="inventory-comparison">
      <div className="panel-title">
        <h2>Metered vs Estimated Load</h2>
      </div>
      <dl>
        <div>
          <dt>Actual Metered Load</dt>
          <dd>{meteredLoadW === null ? 'Metered load unavailable' : powerLabel(meteredLoadW)}</dd>
        </div>
        <div>
          <dt>
            Known Device Load <span>(estimated)</span>
          </dt>
          <dd>{powerLabel(knownLoadW)}</dd>
        </div>
        <div>
          <dt>Unassigned Load</dt>
          <dd>{unassignedLoadW === null ? '—' : powerLabel(unassignedLoadW)}</dd>
        </div>
      </dl>
      {meteredLoadW !== null && meteredLoadW > 0 && (
        <div className="inventory-load-track" aria-hidden="true">
          <span style={{ width: `${fraction}%` }} />
        </div>
      )}
      <p>
        {meteredLoadW !== null && knownLoadW > meteredLoadW
          ? 'Configured estimates exceed the metered load. Check ratings and active quantities.'
          : 'Device loads are estimates. The PZEM measures the whole circuit; unassigned load is the remaining difference.'}
      </p>
    </Panel>
  )
}
