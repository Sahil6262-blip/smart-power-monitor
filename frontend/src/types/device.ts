export type DeviceCategory = 'light' | 'fan' | 'ac' | 'other'
export type MonitoringType = 'estimated' | 'metered'

export interface InventoryDevice {
  id: string
  name: string
  category: DeviceCategory
  room: string
  quantity: number
  activeQuantity: number
  ratedPowerW: number
  monitoringType: MonitoringType
  createdAt: string
  updatedAt: string
}
export type DeviceDraft = Omit<InventoryDevice, 'id' | 'createdAt' | 'updatedAt'>
export type DeviceErrors = Partial<Record<keyof DeviceDraft, string>>

export const deviceCategories: Record<DeviceCategory, string> = {
  light: 'Lights',
  fan: 'Fans',
  ac: 'AC',
  other: 'Other',
}
export function validateDevice(device: DeviceDraft): DeviceErrors {
  const errors: DeviceErrors = {}
  if (!device.name.trim()) errors.name = 'Enter a device name.'
  if (!Object.hasOwn(deviceCategories, device.category)) errors.category = 'Choose a category.'
  if (!Number.isSafeInteger(device.quantity) || device.quantity < 1)
    errors.quantity = 'Quantity must be a whole number of at least 1.'
  if (!Number.isSafeInteger(device.activeQuantity) || device.activeQuantity < 0)
    errors.activeQuantity = 'Active quantity must be a non-negative whole number.'
  else if (device.activeQuantity > device.quantity)
    errors.activeQuantity = 'Active quantity cannot exceed quantity.'
  if (
    !Number.isFinite(device.ratedPowerW) ||
    device.ratedPowerW < 0 ||
    !Number.isFinite(device.ratedPowerW * device.quantity)
  )
    errors.ratedPowerW = 'Enter a valid rated power of 0 W or more.'
  if (!['estimated', 'metered'].includes(device.monitoringType))
    errors.monitoringType = 'Choose a monitoring type.'
  return errors
}
export const estimatedPower = (device: DeviceDraft) => device.ratedPowerW * device.activeQuantity
export function deviceTotals(devices: InventoryDevice[], meteredLoadW: number | null) {
  const knownLoadW = devices.reduce((sum, d) => sum + estimatedPower(d), 0)
  return {
    total: devices.reduce((sum, d) => sum + d.quantity, 0),
    active: devices.reduce((sum, d) => sum + d.activeQuantity, 0),
    knownLoadW,
    unassignedLoadW: meteredLoadW === null ? null : Math.max(meteredLoadW - knownLoadW, 0),
  }
}
