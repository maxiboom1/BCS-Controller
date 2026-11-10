export type Kind = 'sources' | 'destinations' | 'levels' | 'salvos'
export type Item = { id: string; name: string; label: string }
export type Catalogue = Record<Kind, Item[]>
export type Binding = { id: string; name: string }
export type BoundItem = Binding & { label: string; valid: boolean }
export type PanelInput = {
  name: string
  sources: Binding[]
  destinations: Binding[]
  levels: Binding[] | null
  columns: number
  useTake: boolean
}
export type Panel = PanelInput & { id: string; version: number; allLevelBindings?: Binding[] }
export type PanelView = Omit<Panel, 'sources' | 'destinations' | 'levels' | 'allLevelBindings'> & {
  sources: BoundItem[]
  destinations: BoundItem[]
  levels: BoundItem[]
  validLevels: boolean
  allLevels: boolean
}
export type User = { id: string; username: string; role: 'admin' | 'operator'; enabled: boolean; panelIds: string[] }
export type Crosspoint = { sourceId: string | null; protected: boolean; chopping: boolean }
export type Crosspoints = Record<string, Crosspoint>
export type Route = { destinationId: string; revision: string; levels: Crosspoints; sourceLabels: Record<string, string> }
export type RouterStatus = {
  state: 'offline' | 'connecting' | 'syncing' | 'retrying' | 'live'
  enabled: boolean
  adminDisconnected: boolean
  endpoint: string
  mode: 'simulator' | 'live-readonly' | 'live'
  writes: boolean
  selectedLevels: boolean
  connectedAt: number | null
  lastError: string | null
}
export const MIN_PASSWORD_LENGTH = 6
export type ControllerSettings = {
  bcsHost: string; bcsPort: number; pollIntervalMs: number; webPort: number; idleMinutes: number
}
export type SettingsView = {
  settings: ControllerSettings; activeUrl: string; activePort: number; version: string
}
export type OnlineSession = {
  id: string; username: string; ip: string; browser: string; lastActivityAt: number; current: boolean
}
export type Snapshot = { user: User; panels: PanelView[]; router: RouterStatus; routes: Route[]; levels: Binding[] }
export type TakeInput = { actionId: string; sourceId: string; destinationId: string; revision: string; panelVersion: number }
export type TakeResult = {
  outcome: 'confirmed' | 'conflict' | 'blocked' | 'mismatch' | 'uncertain'
  message: string
  route?: Route
}
export const emptyCatalogue = (): Catalogue => ({ sources: [], destinations: [], levels: [], salvos: [] })

