import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { X } from 'lucide-react'
import type { DeviceCategory, DeviceDraft, DeviceErrors, InventoryDevice } from '../../types/device'
import { deviceCategories, validateDevice } from '../../types/device'

export function DeviceDialog({
  title,
  children,
  onClose,
  fallbackFocus,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    element.querySelector<HTMLElement>('input, [data-initial-focus]')?.focus()
    return () => {
      element.close()
      if (previous?.isConnected) previous.focus()
      else fallbackFocus.current?.focus()
    }
  }, [fallbackFocus])
  return (
    <dialog
      ref={dialog}
      className="inventory-dialog"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
        )
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="inventory-dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

export function DeviceFormModal({
  device,
  onSave,
  onClose,
  fallbackFocus,
}: {
  device?: InventoryDevice
  onSave: (draft: DeviceDraft) => void
  onClose: () => void
  fallbackFocus: RefObject<HTMLButtonElement | null>
}) {
  const [form, setForm] = useState({
    name: device?.name || '',
    category: device?.category || ('light' as DeviceCategory),
    room: device?.room || '',
    quantity: String(device?.quantity ?? 1),
    activeQuantity: String(device?.activeQuantity ?? 0),
    ratedPowerW: String(device?.ratedPowerW ?? ''),
  })
  const [errors, setErrors] = useState<DeviceErrors>({})
  const [saveError, setSaveError] = useState('')
  const change = (key: keyof typeof form, value: string) => {
    setForm((old) => ({ ...old, [key]: value }))
    setErrors((old) => ({ ...old, [key]: undefined }))
    setSaveError('')
  }
  const fieldError = (key: keyof DeviceErrors) =>
    errors[key] ? (
      <small className="danger-text" id={`device-error-${key}`}>
        {errors[key]}
      </small>
    ) : null
  const numeric = (value: string) => (value.trim() === '' ? NaN : Number(value))
  return (
    <DeviceDialog
      title={device ? 'Edit Device' : 'Add Device'}
      onClose={onClose}
      fallbackFocus={fallbackFocus}
    >
      <p className="inventory-dialog-note">
        Configure an estimate. Activity controls do not switch appliances.
      </p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          const draft: DeviceDraft = {
            name: form.name,
            category: form.category,
            room: form.room,
            quantity: numeric(form.quantity),
            activeQuantity: numeric(form.activeQuantity),
            ratedPowerW: numeric(form.ratedPowerW),
            monitoringType: device?.monitoringType || 'estimated',
          }
          const nextErrors = validateDevice(draft)
          setErrors(nextErrors)
          if (Object.keys(nextErrors).length) {
            const key = Object.keys(nextErrors)[0]
            document.getElementById(`device-field-${key}`)?.focus()
            return
          }
          try {
            onSave(draft)
            onClose()
          } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Unable to save this device.')
          }
        }}
      >
        <div className="inventory-form-grid">
          <label className="field inventory-full">
            <span>Device Name</span>
            <input
              id="device-field-name"
              required
              maxLength={100}
              value={form.name}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'device-error-name' : undefined}
              onChange={(e) => change('name', e.target.value)}
            />
            {fieldError('name')}
          </label>
          <label className="field">
            <span>Category</span>
            <select
              id="device-field-category"
              value={form.category}
              onChange={(e) => change('category', e.target.value)}
            >
              {Object.entries(deviceCategories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Room</span>
            <input
              maxLength={100}
              value={form.room}
              onChange={(e) => change('room', e.target.value)}
            />
          </label>
          {(
            [
              ['quantity', 'Quantity', 1, '1'],
              ['activeQuantity', 'Active Quantity', 0, '1'],
              ['ratedPowerW', 'Rated Power (W)', 0, 'any'],
            ] as const
          ).map(([key, label, min, step]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                id={`device-field-${key}`}
                type="number"
                inputMode={key === 'ratedPowerW' ? 'decimal' : 'numeric'}
                required
                min={min}
                max={key === 'activeQuantity' ? numeric(form.quantity) || undefined : undefined}
                step={step}
                value={form[key]}
                aria-invalid={!!errors[key]}
                aria-describedby={errors[key] ? `device-error-${key}` : undefined}
                onChange={(e) => change(key, e.target.value)}
              />
              {fieldError(key)}
            </label>
          ))}
          <label className="field">
            <span>Monitoring Type</span>
            <select
              value={device?.monitoringType || 'estimated'}
              disabled={device?.monitoringType === 'metered'}
              onChange={() => {}}
            >
              <option value="estimated">Estimated</option>
              <option value="metered" disabled>
                Metered — sensor not connected
              </option>
            </select>
          </label>
        </div>
        <p className="inventory-dialog-note">
          Device metering needs a dedicated sensor. The current PZEM measures total circuit load.
        </p>
        {saveError && (
          <p role="alert" className="danger-text">
            {saveError}
          </p>
        )}
        <div className="inventory-dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            {device ? 'Save changes' : 'Add Device'}
          </button>
        </div>
      </form>
    </DeviceDialog>
  )
}
