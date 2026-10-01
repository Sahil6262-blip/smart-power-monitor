import {
  Activity,
  Bell,
  ChartNoAxesCombined,
  Cpu,
  FileChartColumn,
  History,
  LayoutDashboard,
  PlugZap,
  Settings2,
  Sparkles,
} from 'lucide-react'

export const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, hint: 'Energy overview and system health' },
  {
    to: '/live',
    label: 'Live monitoring',
    icon: Activity,
    hint: 'Electrical measurements in real time',
  },
  {
    to: '/consumption',
    label: 'Consumption',
    icon: ChartNoAxesCombined,
    hint: 'Energy usage, costs, and budget',
  },
  {
    to: '/insights',
    label: 'Predictions',
    icon: Sparkles,
    hint: 'Consumption and cost forecasts',
  },
  { to: '/alerts', label: 'Alerts', icon: Bell, hint: 'Events, warnings, and acknowledgements' },
  {
    to: '/history',
    label: 'History',
    icon: History,
    hint: 'Explore and export historical readings',
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: FileChartColumn,
    hint: 'Energy summaries and CSV reports',
  },
  { to: '/device', label: 'Device status', icon: Cpu, hint: 'Connections, hardware, and storage' },
  {
    to: '/devices',
    label: 'Devices',
    icon: PlugZap,
    hint: 'Appliance inventory and estimated loads',
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings2,
    hint: 'Tariff, thresholds, and preferences',
  },
]
