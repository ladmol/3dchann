export const STORAGE_KEY = 'warehouse_inventory_mvp_v1'

export const BASE_STATUSES = [
  'новый',
  'открытый',
  'в использовании',
  'использован',
  'списан',
] as const

export const DELETED_STATUS_LABEL = 'СТАТУС УДАЛЕН - выберите новый'
export const DELETED_CATEGORY_LABEL = 'КАТЕГОРИЯ УДАЛЕНА - выберите новую'

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
  renamedBaseStatuses: Record<string, string>
  removedBaseStatuses: string[]
  categories: string[]
  repeatScanMode: RepeatScanMode
  autoScanStatus: string
  autoOpenCardOnScan: boolean
  advanceStatusOnRepeatScan: boolean
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
  renamedBaseStatuses: {},
  removedBaseStatuses: [],
  categories: [...DEFAULT_CATEGORIES],
  repeatScanMode: 'open-card',
  autoScanStatus: BASE_STATUSES[1],
  autoOpenCardOnScan: true,
  advanceStatusOnRepeatScan: false,
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
  const baseStatuses = BASE_STATUSES
    .filter((base) => !settings.removedBaseStatuses.includes(base))
    .map((base) => settings.renamedBaseStatuses[base] || base)
  return uniqueNormalized([...baseStatuses, ...settings.customStatuses])
}

export function getAllCategories(settings: AppSettings): string[] {
  return uniqueNormalized(settings.categories)
}

function buildDefaultData(): AppData {
  return {
    ...DEFAULT_DATA,
    settings: {
      ...DEFAULT_SETTINGS,
      renamedBaseStatuses: { ...DEFAULT_SETTINGS.renamedBaseStatuses },
      removedBaseStatuses: [...DEFAULT_SETTINGS.removedBaseStatuses],
      categories: [...DEFAULT_SETTINGS.categories],
    },
    materials: [],
  }
}

function resolveBaseStatusKey(settings: AppSettings, statusName: string): string | null {
  const lowered = statusName.toLocaleLowerCase('ru-RU')
  for (const base of BASE_STATUSES) {
    const mapped = settings.renamedBaseStatuses[base] || base
    if (mapped.toLocaleLowerCase('ru-RU') === lowered) {
      return base
    }
  }
  return null
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

    if (data.settings.advanceStatusOnRepeatScan) {
      const statuses = getAllStatuses(data.settings)
      if (statuses.length === 0) {
        return {
          nextData: data,
          result: { kind: 'existing', materialId: existing.id },
        }
      }
      const currentIndex = statuses.findIndex((status) => status === existing.status)
      const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, statuses.length - 1) : 0
      const targetStatus = statuses[nextIndex]

      const updatedMaterial = updateStatusOnMaterial(
        existing,
        targetStatus,
        'scan-repeat',
        'Повторное сканирование: следующий статус',
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

    if (data.settings.repeatScanMode === 'open-card') {
      return {
        nextData: data,
        result: { kind: 'existing', materialId: existing.id },
      }
    }

    const statuses = getAllStatuses(data.settings)
    if (statuses.length === 0) {
      return {
        nextData: data,
        result: { kind: 'existing', materialId: existing.id },
      }
    }
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
  const resolvedFirstStatus = firstStatus || DELETED_STATUS_LABEL
  const created = createMaterialFromQr(qrCode, resolvedFirstStatus)

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

export function deleteMaterial(data: AppData, materialId: string): AppData {
  return {
    ...data,
    materials: data.materials.filter((material) => material.id !== materialId),
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

export function addCategory(
  data: AppData,
  category: string,
): { nextData: AppData; error?: string } {
  const normalized = category.trim()
  if (!normalized) {
    return { nextData: data, error: 'Введите непустую категорию' }
  }

  const categories = getAllCategories(data.settings)
  if (categories.some((item) => item.toLocaleLowerCase('ru-RU') === normalized.toLocaleLowerCase('ru-RU'))) {
    return { nextData: data, error: 'Такая категория уже существует' }
  }

  return {
    nextData: {
      ...data,
      settings: {
        ...data.settings,
        categories: [...data.settings.categories, normalized],
      },
    },
  }
}

export function removeCustomStatus(
  data: AppData,
  status: string,
): { nextData: AppData; error?: string } {
  const baseStatusKey = resolveBaseStatusKey(data.settings, status)

  const existsInCustom = data.settings.customStatuses.some(
    (item) => item.toLocaleLowerCase('ru-RU') === status.toLocaleLowerCase('ru-RU'),
  )
  if (!existsInCustom && !baseStatusKey) {
    return { nextData: data, error: 'Статус не найден' }
  }

  const nextCustomStatuses = data.settings.customStatuses.filter(
    (item) => item.toLocaleLowerCase('ru-RU') !== status.toLocaleLowerCase('ru-RU'),
  )

  const nextRenamedBaseStatuses = {
    ...data.settings.renamedBaseStatuses,
  }

  const nextRemovedBaseStatuses = [...data.settings.removedBaseStatuses]
  if (baseStatusKey) {
    delete nextRenamedBaseStatuses[baseStatusKey]
    if (!nextRemovedBaseStatuses.includes(baseStatusKey)) {
      nextRemovedBaseStatuses.push(baseStatusKey)
    }
  }

  const nextStatuses = getAllStatuses({
    ...data.settings,
    customStatuses: nextCustomStatuses,
    renamedBaseStatuses: nextRenamedBaseStatuses,
    removedBaseStatuses: nextRemovedBaseStatuses,
  })

  if (nextStatuses.length === 0) {
    return { nextData: data, error: 'Нельзя удалить последний доступный статус' }
  }

  const nextMaterials = data.materials.map((material) => {
    if (material.status.toLocaleLowerCase('ru-RU') !== status.toLocaleLowerCase('ru-RU')) {
      return material
    }

    return {
      ...material,
      status: DELETED_STATUS_LABEL,
      updatedAt: nowIso(),
      history: [
        ...material.history,
        createHistoryItem(material.status, DELETED_STATUS_LABEL, 'manual', `Статус «${material.status}» удален`),
      ],
    }
  })

  const nextAutoScanStatus = nextStatuses.includes(data.settings.autoScanStatus)
    ? data.settings.autoScanStatus
    : nextStatuses[0]

  return {
    nextData: {
      ...data,
      materials: nextMaterials,
      settings: {
        ...data.settings,
        customStatuses: nextCustomStatuses,
        renamedBaseStatuses: nextRenamedBaseStatuses,
        removedBaseStatuses: nextRemovedBaseStatuses,
        autoScanStatus: nextAutoScanStatus,
      },
    },
  }
}

export function renameStatus(
  data: AppData,
  oldStatus: string,
  nextStatusRaw: string,
): { nextData: AppData; error?: string } {
  const nextStatus = nextStatusRaw.trim()
  if (!nextStatus) {
    return { nextData: data, error: 'Введите непустое имя статуса' }
  }

  if (oldStatus.toLocaleLowerCase('ru-RU') === nextStatus.toLocaleLowerCase('ru-RU')) {
    return { nextData: data }
  }

  const statuses = getAllStatuses(data.settings)
  if (!statuses.includes(oldStatus)) {
    return { nextData: data, error: 'Статус не найден' }
  }

  if (statuses.some((item) => item.toLocaleLowerCase('ru-RU') === nextStatus.toLocaleLowerCase('ru-RU'))) {
    return { nextData: data, error: 'Статус с таким именем уже существует' }
  }

  const baseKey = resolveBaseStatusKey(data.settings, oldStatus)
  const renameBase = Boolean(baseKey)

  const nextCustomStatuses = renameBase
    ? [...data.settings.customStatuses]
    : data.settings.customStatuses.map((status) => (status === oldStatus ? nextStatus : status))

  const nextRenamedBaseStatuses = {
    ...data.settings.renamedBaseStatuses,
  }

  if (baseKey) {
    nextRenamedBaseStatuses[baseKey] = nextStatus
  }

  const nextMaterials = data.materials.map((material) => {
    const currentStatus = material.status === oldStatus ? nextStatus : material.status
    const nextHistory = material.history.map((historyItem) => ({
      ...historyItem,
      fromStatus: historyItem.fromStatus === oldStatus ? nextStatus : historyItem.fromStatus,
      toStatus: historyItem.toStatus === oldStatus ? nextStatus : historyItem.toStatus,
    }))

    return {
      ...material,
      status: currentStatus,
      history: nextHistory,
    }
  })

  const autoScanStatus = data.settings.autoScanStatus === oldStatus ? nextStatus : data.settings.autoScanStatus

  return {
    nextData: {
      ...data,
      materials: nextMaterials,
      settings: {
        ...data.settings,
        customStatuses: nextCustomStatuses,
        renamedBaseStatuses: nextRenamedBaseStatuses,
        autoScanStatus,
      },
    },
  }
}

export function removeCategory(
  data: AppData,
  category: string,
): { nextData: AppData; error?: string } {
  const nextCategories = data.settings.categories.filter(
    (item) => item.toLocaleLowerCase('ru-RU') !== category.toLocaleLowerCase('ru-RU'),
  )

  if (nextCategories.length === 0) {
    return { nextData: data, error: 'Нельзя удалить последнюю категорию' }
  }

  const nextMaterials = data.materials.map((material) => {
    if (material.category.toLocaleLowerCase('ru-RU') !== category.toLocaleLowerCase('ru-RU')) {
      return material
    }

    return {
      ...material,
      category: DELETED_CATEGORY_LABEL,
      updatedAt: nowIso(),
    }
  })

  return {
    nextData: {
      ...data,
      materials: nextMaterials,
      settings: {
        ...data.settings,
        categories: nextCategories,
      },
    },
  }
}

export function renameCategory(
  data: AppData,
  oldCategory: string,
  newCategoryRaw: string,
): { nextData: AppData; error?: string } {
  const newCategory = newCategoryRaw.trim()
  if (!newCategory) {
    return { nextData: data, error: 'Введите непустое имя категории' }
  }

  if (oldCategory.toLocaleLowerCase('ru-RU') === newCategory.toLocaleLowerCase('ru-RU')) {
    return { nextData: data }
  }

  const categories = getAllCategories(data.settings)
  if (categories.some((item) => item.toLocaleLowerCase('ru-RU') === newCategory.toLocaleLowerCase('ru-RU'))) {
    return { nextData: data, error: 'Категория с таким именем уже существует' }
  }

  const categoryExists = categories.includes(oldCategory)
  if (!categoryExists) {
    return { nextData: data, error: 'Категория не найдена' }
  }

  return {
    nextData: {
      ...data,
      settings: {
        ...data.settings,
        categories: data.settings.categories.map((category) =>
          category === oldCategory ? newCategory : category,
        ),
      },
      materials: data.materials.map((material) =>
        material.category === oldCategory ? { ...material, category: newCategory, updatedAt: nowIso() } : material,
      ),
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

  const renamedBaseStatusesRaw =
    settingsRaw.renamedBaseStatuses && typeof settingsRaw.renamedBaseStatuses === 'object'
      ? (settingsRaw.renamedBaseStatuses as Record<string, unknown>)
      : {}

  const renamedBaseStatuses: Record<string, string> = {}
  for (const baseStatus of BASE_STATUSES) {
    const maybeRenamed = asString(renamedBaseStatusesRaw[baseStatus]).trim()
    if (maybeRenamed) {
      renamedBaseStatuses[baseStatus] = maybeRenamed
    }
  }

  const removedBaseStatuses = Array.isArray(settingsRaw.removedBaseStatuses)
    ? settingsRaw.removedBaseStatuses
        .map((item) => asString(item))
        .filter((item): item is string => BASE_STATUSES.includes(item as (typeof BASE_STATUSES)[number]))
    : []

  const legacyCustomCategories = uniqueNormalized(
    Array.isArray(settingsRaw.customCategories)
      ? settingsRaw.customCategories.map((item) => asString(item))
      : [],
  )

  const categories = uniqueNormalized(
    Array.isArray(settingsRaw.categories)
      ? settingsRaw.categories.map((item) => asString(item))
      : [],
  )

  const settings: AppSettings = {
    customStatuses,
    renamedBaseStatuses,
    removedBaseStatuses,
    categories: categories.length > 0 ? categories : [...DEFAULT_CATEGORIES, ...legacyCustomCategories],
    repeatScanMode: validMode,
    autoScanStatus: asString(settingsRaw.autoScanStatus) || BASE_STATUSES[1],
    autoOpenCardOnScan: Boolean(settingsRaw.autoOpenCardOnScan ?? true),
    advanceStatusOnRepeatScan: Boolean(settingsRaw.advanceStatusOnRepeatScan ?? false),
  }

  const importedCategories = uniqueNormalized(materials.map((material) => material.category).filter(Boolean))
  settings.categories = uniqueNormalized(
    [...settings.categories, ...importedCategories].filter((item) => item !== DELETED_CATEGORY_LABEL),
  )

  const statuses = getAllStatuses(settings)
  const materialQrs = new Set<string>()

  for (const material of materials) {
    if (materialQrs.has(material.qrCode)) {
      return { ok: false, error: `Найден дубликат QR: ${material.qrCode}` }
    }
    materialQrs.add(material.qrCode)

    if (!statuses.includes(material.status)) {
      material.status = statuses[0] || DELETED_STATUS_LABEL
    }
  }

  const normalizedSettings: AppSettings = {
    ...settings,
    autoScanStatus: statuses.includes(settings.autoScanStatus)
      ? settings.autoScanStatus
      : statuses[0] || DELETED_STATUS_LABEL,
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
