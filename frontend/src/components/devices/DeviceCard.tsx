import {
  Fan,
  Lightbulb,
  Minus,
  Pencil,
  PlugZap,
  Plus,
  Power,
  Snowflake,
  Trash2,
} from 'lucide-react'
import { Badge } from '../UI'
import type { InventoryDevice } from '../../types/device'
import { deviceCategories, estimatedPower } from '../../types/device'
import { number } from '../../utils/format'
import { powerLabel } from './DeviceOverview'

const icons = { light: Lightbulb, fan: Fan, ac: Snowflake, other: PlugZap }
export function DeviceCard({
  device,
  onEdit,
  onDelete,
  onActive,
}: {
  device: InventoryDevice
  onEdit: () => void
  onDelete: () => void
  onActive: (quantity: number) => void
}) {
  const Icon = icons[device.category]
  const on = device.activeQuantity > 0
  return (
    <article className="panel inventory-card" aria-labelledby={`device-${device.id}`}>
      <div className="inventory-card-heading">
        <span className="inventory-category-icon">
          <Icon size={19} />
        </span>
        <h2 id={`device-${device.id}`}>{device.name}</h2>
        <div className="inventory-card-actions">
          <button
            className="icon-button"
            aria-label={`Edit ${device.name}`}
            title="Edit"
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Delete ${device.name}`}
            title="Delete"
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <p className="inventory-location">
        {deviceCategories[device.category]} · {device.room || 'No room set'}
      </p>
      <dl className="inventory-specs">
        <div>
          <dt>Rated power / unit</dt>
          <dd>{number(device.ratedPowerW, 1)} W</dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{number(device.quantity, 0)}</dd>
        </div>
      </dl>
      <div className="inventory-active">
        <span>Active quantity</span>
        <div className="inventory-quantity">
          {device.quantity > 1 && (
            <button
              className="button small"
              aria-label={`Decrease active quantity for ${device.name}`}
              disabled={!on}
              onClick={() => onActive(device.activeQuantity - 1)}
            >
              <Minus size={14} />
            </button>
          )}
          <strong>
            {device.activeQuantity} / {device.quantity}
          </strong>
          {device.quantity > 1 ? (
            <button
              className="button small"
              aria-label={`Increase active quantity for ${device.name}`}
              disabled={device.activeQuantity >= device.quantity}
              onClick={() => onActive(device.activeQuantity + 1)}
            >
              <Plus size={14} />
            </button>
          ) : (
            <button
              className={`button small ${on ? 'inventory-on' : ''}`}
              role="switch"
              aria-checked={on}
              aria-label={`Active state for ${device.name}`}
              onClick={() => onActive(on ? 0 : 1)}
            >
              <Power size={14} />
              <span>{on ? 'ON' : 'OFF'}</span>
            </button>
          )}
        </div>
      </div>
      <div className="inventory-estimate">
        <span>Estimated Load</span>
        <strong>{powerLabel(estimatedPower(device))}</strong>
      </div>
      <div className="inventory-card-footer">
        <span>
          Status <Badge tone={on ? 'green' : 'muted'}>{on ? 'ON' : 'OFF'}</Badge>
        </span>
        <Badge>
          {device.monitoringType === 'metered' ? 'Sensor not connected · Estimated' : 'Estimated'}
        </Badge>
      </div>
    </article>
  )
}
