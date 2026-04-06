export const STORAGE_KEY = 'warehouse_inventory_mvp_v1'

export const BASE_STATUSES = [
  'новый',
  'открытый',
  'в использовании',
  'использован',
  'списан',
] as const

export const DEFAULT_CATEGORIES = [
  'песок',
  'смола',
  'катализатор',
  'спирт',
  'СИЗ',
  'комплектующие',
  'запчасти',
  'прочее',
]

export type RepeatScanMode = 'open-card' | 'auto-status'
export type StatusChangeSource = 'scan-create' | 'scan-repeat' | 'manual' | 'auto'

export interface StatusHistoryItem {
  id: string
  at: string
  fromStatus: string | null
  toStatus: string
  source: StatusChangeSource
  comment: string
}

export interface MaterialRecord {
  id: string
  qrCode: string
  name: string
  category: string
  status: string
  createdAt: string
  updatedAt: string
  history: StatusHistoryItem[]
  comment: string
}

export interface AppSettings {
  customStatuses: string[]
  repeatScanMode: RepeatScanMode
  autoScanStatus: string
}

export interface AppData {
  version: number
  materials: MaterialRecord[]
  settings: AppSettings
}

export interface ScanResult {
  kind: 'created' | 'existing' | 'auto-updated'
  materialId: string
  status?: string
}

export interface ImportValidationResult {
  ok: boolean
  data?: AppData
  error?: string
}

const DEFAULT_SETTINGS: AppSettings = {
  customStatuses: [],
  repeatScanMode: 'open-card',
  autoScanStatus: BASE_STATUSES[1],
}

const DEFAULT_DATA: AppData = {
  version: 1,
  materials: [],
  settings: DEFAULT_SETTINGS,
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nowIso(): string {
  return new Date().toISOString()
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    const key = normalized.toLocaleLowerCase('ru-RU')
    if (!normalized || seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(normalized)
  }

  return out
}

export function getAllStatuses(settings: AppSettings): string[] {
  return uniqueNormalized([...BASE_STATUSES, ...settings.customStatuses])
}

function buildDefaultData(): AppData {
  return {
    ...DEFAULT_DATA,
    settings: { ...DEFAULT_SETTINGS },
    materials: [],
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return buildDefaultData()
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    const validated = validateImportData(parsed)
    return validated.ok && validated.data ? validated.data : buildDefaultData()
  } catch {
    return buildDefaultData()
  }
}

function createHistoryItem(
  fromStatus: string | null,
  toStatus: string,
  source: StatusChangeSource,
  comment: string,
): StatusHistoryItem {
  return {
    id: crypto.randomUUID(),
    at: nowIso(),
    fromStatus,
    toStatus,
    source,
    comment,
  }
}

function createMaterialFromQr(qrCode: string, status: string): MaterialRecord {
  const timestamp = nowIso()
  return {
    id: crypto.randomUUID(),
    qrCode,
    name: '',
    category: DEFAULT_CATEGORIES[7],
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    history: [createHistoryItem(null, status, 'scan-create', 'Создано сканированием')],
    comment: '',
  }
}

function updateStatusOnMaterial(
  material: MaterialRecord,
  nextStatus: string,
  source: StatusChangeSource,
  comment: string,
): MaterialRecord {
  if (material.status === nextStatus) {
    return material
  }

  const historyItem = createHistoryItem(material.status, nextStatus, source, comment)
  return {
    ...material,
    status: nextStatus,
    updatedAt: nowIso(),
    history: [...material.history, historyItem],
  }
}

export function processScan(
  data: AppData,
  qrCodeRaw: string,
): { nextData: AppData; result: ScanResult } {
  const qrCode = qrCodeRaw.trim()
  const existingIndex = data.materials.findIndex((item) => item.qrCode === qrCode)

  if (existingIndex !== -1) {
    const existing = data.materials[existingIndex]

    if (data.settings.repeatScanMode === 'open-card') {
      return {
        nextData: data,
        result: { kind: 'existing', materialId: existing.id },
      }
    }

    const statuses = getAllStatuses(data.settings)
    const targetStatus = statuses.includes(data.settings.autoScanStatus)
      ? data.settings.autoScanStatus
      : statuses[0]

    const updatedMaterial = updateStatusOnMaterial(
      existing,
      targetStatus,
      'auto',
      'Автоматическая смена при повторном сканировании',
    )

    if (updatedMaterial === existing) {
      return {
        nextData: data,
        result: { kind: 'existing', materialId: existing.id },
      }
    }

    const nextMaterials = [...data.materials]
    nextMaterials[existingIndex] = updatedMaterial

    return {
      nextData: {
        ...data,
        materials: nextMaterials,
      },
      result: { kind: 'auto-updated', materialId: existing.id, status: targetStatus },
    }
  }

  const firstStatus = getAllStatuses(data.settings)[0]
  const created = createMaterialFromQr(qrCode, firstStatus)

  return {
    nextData: {
      ...data,
      materials: [created, ...data.materials],
    },
    result: { kind: 'created', materialId: created.id },
  }
}

export function updateMaterialFields(
  data: AppData,
  materialId: string,
  patch: Partial<Pick<MaterialRecord, 'name' | 'category' | 'comment'>>,
): AppData {
  const nextMaterials = data.materials.map((material) => {
    if (material.id !== materialId) {
      return material
    }

    return {
      ...material,
      ...patch,
      updatedAt: nowIso(),
    }
  })

  return {
    ...data,
    materials: nextMaterials,
  }
}

export function changeMaterialStatus(
  data: AppData,
  materialId: string,
  nextStatus: string,
  source: StatusChangeSource,
  comment: string,
): AppData {
  const nextMaterials = data.materials.map((material) => {
    if (material.id !== materialId) {
      return material
    }

    return updateStatusOnMaterial(material, nextStatus, source, comment)
  })

  return {
    ...data,
    materials: nextMaterials,
  }
}

export function addCustomStatus(
  data: AppData,
  status: string,
): { nextData: AppData; error?: string } {
  const normalized = status.trim()
  if (!normalized) {
    return { nextData: data, error: 'Введите непустой статус' }
  }

  const statuses = getAllStatuses(data.settings)
  if (statuses.some((item) => item.toLocaleLowerCase('ru-RU') === normalized.toLocaleLowerCase('ru-RU'))) {
    return { nextData: data, error: 'Такой статус уже существует' }
  }

  return {
    nextData: {
      ...data,
      settings: {
        ...data.settings,
        customStatuses: [...data.settings.customStatuses, normalized],
      },
    },
  }
}

export function removeCustomStatus(
  data: AppData,
  status: string,
): { nextData: AppData; error?: string } {
  if (BASE_STATUSES.includes(status as (typeof BASE_STATUSES)[number])) {
    return { nextData: data, error: 'Базовые статусы нельзя удалить' }
  }

  const inUse = data.materials.some((material) => material.status === status)
  if (inUse) {
    return {
      nextData: data,
      error: 'Статус используется в материалах. Сначала смените его в карточках.',
    }
  }

  return {
    nextData: {
      ...data,
      settings: {
        ...data.settings,
        customStatuses: data.settings.customStatuses.filter((item) => item !== status),
      },
    },
  }
}

function parseHistory(value: unknown): StatusHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Record<string, unknown>
  const source = asString(row.source) as StatusChangeSource
  const allowedSources: StatusChangeSource[] = ['scan-create', 'scan-repeat', 'manual', 'auto']
  if (!allowedSources.includes(source)) {
    return null
  }

  const fromStatusRaw = row.fromStatus
  const fromStatus = fromStatusRaw === null ? null : asString(fromStatusRaw)

  return {
    id: asString(row.id) || crypto.randomUUID(),
    at: asString(row.at) || nowIso(),
    fromStatus,
    toStatus: asString(row.toStatus),
    source,
    comment: asString(row.comment),
  }
}

function parseMaterial(value: unknown): MaterialRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Record<string, unknown>
  const historyRaw = Array.isArray(row.history) ? row.history : []
  const parsedHistory = historyRaw
    .map((item) => parseHistory(item))
    .filter((item): item is StatusHistoryItem => Boolean(item))

  const qrCode = asString(row.qrCode).trim()
  if (!qrCode) {
    return null
  }

  return {
    id: asString(row.id) || crypto.randomUUID(),
    qrCode,
    name: asString(row.name),
    category: asString(row.category) || DEFAULT_CATEGORIES[7],
    status: asString(row.status) || BASE_STATUSES[0],
    createdAt: asString(row.createdAt) || nowIso(),
    updatedAt: asString(row.updatedAt) || nowIso(),
    history: parsedHistory,
    comment: asString(row.comment),
  }
}

export function validateImportData(raw: unknown): ImportValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Файл не похож на JSON-объект приложения' }
  }

  const root = raw as Record<string, unknown>
  if (!Array.isArray(root.materials)) {
    return { ok: false, error: 'В файле отсутствует массив materials' }
  }

  const materials = root.materials
    .map((item) => parseMaterial(item))
    .filter((item): item is MaterialRecord => Boolean(item))

  if (!root.settings || typeof root.settings !== 'object') {
    return { ok: false, error: 'В файле отсутствуют настройки settings' }
  }

  const settingsRaw = root.settings as Record<string, unknown>
  const repeatScanMode = asString(settingsRaw.repeatScanMode) as RepeatScanMode
  const validMode: RepeatScanMode =
    repeatScanMode === 'auto-status' || repeatScanMode === 'open-card'
      ? repeatScanMode
      : 'open-card'

  const customStatuses = uniqueNormalized(
    Array.isArray(settingsRaw.customStatuses)
      ? settingsRaw.customStatuses.map((item) => asString(item))
      : [],
  )

  const settings: AppSettings = {
    customStatuses,
    repeatScanMode: validMode,
    autoScanStatus: asString(settingsRaw.autoScanStatus) || BASE_STATUSES[1],
  }

  const statuses = getAllStatuses(settings)
  const materialQrs = new Set<string>()

  for (const material of materials) {
    if (materialQrs.has(material.qrCode)) {
      return { ok: false, error: `Найден дубликат QR: ${material.qrCode}` }
    }
    materialQrs.add(material.qrCode)

    if (!statuses.includes(material.status)) {
      material.status = BASE_STATUSES[0]
    }
  }

  const normalizedSettings: AppSettings = {
    ...settings,
    autoScanStatus: statuses.includes(settings.autoScanStatus)
      ? settings.autoScanStatus
      : statuses[0],
  }

  return {
    ok: true,
    data: {
      version: Number(root.version) || 1,
      materials,
      settings: normalizedSettings,
    },
  }
}

export function formatDateTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('ru-RU')
  } catch {
    return isoString
  }
}
