import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useLive } from '../context/LiveContext'
import { useDevices } from '../context/DevicesContext'
import { DeviceCard } from '../components/devices/DeviceCard'
import { DeviceDialog, DeviceFormModal } from '../components/devices/DeviceFormModal'
import { DeviceOverview, DeviceLoadComparison } from '../components/devices/DeviceOverview'
import { Empty, Loading, PageHeading, Tabs } from '../components/UI'
import { deviceCategories } from '../types/device'
import type { DeviceCategory, InventoryDevice } from '../types/device'
import './devices.css'

export default function Devices() {
  const { devices, loading, storageWarning, save, remove, setActive } = useDevices()
  const { latest, status } = useLive()
  const [category, setCategory] = useState<DeviceCategory | 'all'>('all')
  const [editing, setEditing] = useState<InventoryDevice | 'new' | null>(null)
  const [deleting, setDeleting] = useState<InventoryDevice | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const measured =
    status === 'live' &&
    latest &&
    ['hardware', 'ble'].includes(latest.source || '') &&
    Number.isFinite(latest.power) &&
    latest.power >= 0
      ? latest.power
      : null
  const visible = devices.filter((device) => category === 'all' || device.category === category)
  return (
    <div className="page-enter devices-page">
      <PageHeading
        title="Devices"
        description="Configured appliance estimates alongside your circuit's measured load."
        action={
          <button
            ref={addButton}
            className="button primary"
            disabled={loading}
            onClick={() => setEditing('new')}
          >
            <Plus size={16} />
            Add Device
          </button>
        }
      />
      {storageWarning && (
        <p className="error-state" role="status">
          Device storage unavailable. Changes work in this tab but may be lost on reload.
        </p>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <DeviceOverview devices={devices} meteredLoadW={measured} />
          <DeviceLoadComparison devices={devices} meteredLoadW={measured} />
          <div className="inventory-toolbar">
            <Tabs
              value={category}
              onChange={setCategory}
              items={[
                { value: 'all', label: 'All' },
                ...Object.entries(deviceCategories).map(([value, label]) => ({
                  value: value as DeviceCategory,
                  label,
                })),
              ]}
            />
            <span>
              {visible.length} {visible.length === 1 ? 'group' : 'groups'}
            </span>
          </div>
          <p className="inventory-manual-note">
            Activity is set manually for estimates only. These controls do not switch appliances.
          </p>
          {visible.length ? (
            <div className="inventory-grid">
              {visible.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  onEdit={() => setEditing(device)}
                  onDelete={() => setDeleting(device)}
                  onActive={(quantity) => setActive(device.id, quantity)}
                />
              ))}
            </div>
          ) : (
            <div className="panel">
              <Empty
                title={devices.length ? 'No devices in this category' : 'Add your first device'}
                text={
                  devices.length
                    ? 'Choose another category or add a device.'
                    : 'Add lights, fans, AC units, or other appliances to estimate their load.'
                }
              />
            </div>
          )}
        </>
      )}
      {editing && (
        <DeviceFormModal
          device={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          fallbackFocus={addButton}
          onSave={(draft) => save(draft, editing === 'new' ? undefined : editing.id)}
        />
      )}
      {deleting && (
        <DeviceDialog
          title="Delete Device"
          onClose={() => setDeleting(null)}
          fallbackFocus={addButton}
        >
          <p className="inventory-delete-copy">
            Delete <strong>{deleting.name}</strong> from your device inventory? Power readings will
            remain unchanged.
          </p>
          <div className="inventory-dialog-actions">
            <button className="button" data-initial-focus onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className="button inventory-danger"
              onClick={() => {
                remove(deleting.id)
                setDeleting(null)
              }}
            >
              Delete Device
            </button>
          </div>
        </DeviceDialog>
      )}
    </div>
  )
}
