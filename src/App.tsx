import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Camera, CheckCircle2, Database, Pencil, QrCode, Search, Settings, Trash2 } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import {
  addCategory,
  addCustomStatus,
  BASE_STATUSES,
  changeMaterialStatus,
  DELETED_CATEGORY_LABEL,
  DELETED_STATUS_LABEL,
  deleteMaterial,
  formatDateTime,
  getAllCategories,
  getAllStatuses,
  loadData,
  processScan,
  removeCategory,
  removeCustomStatus,
  renameCategory,
  renameStatus,
  saveData,
  updateMaterialFields,
  validateImportData,
  type AppData,
} from './inventory'
import type { MaterialRecord } from './inventory'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './components/ui/sheet'
import { Switch } from './components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Textarea } from './components/ui/textarea'

type AppTab = 'scan' | 'list' | 'settings'

type ToastState = {
  id: number
  message: string
  toneClassName: string
} | null

function App() {
  const [data, setData] = useState<AppData>(() => loadData())
  const [activeTab, setActiveTab] = useState<AppTab>('scan')
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [scanInfo, setScanInfo] = useState('Отсканируйте QR для добавления или обновления материала')
  const [manualQr, setManualQr] = useState('')

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [manualStatus, setManualStatus] = useState<string>(BASE_STATUSES[0])

  const [newCustomStatus, setNewCustomStatus] = useState('')
  const [newCustomCategory, setNewCustomCategory] = useState('')
  const [settingsInfo, setSettingsInfo] = useState('')
  const [toast, setToast] = useState<ToastState>(null)

  const lastScanRef = useRef({ qrCode: '', timestamp: 0 })

  const statuses = useMemo(() => getAllStatuses(data.settings), [data.settings])

  const categories = useMemo(() => getAllCategories(data.settings), [data.settings])

  const selectedMaterial = useMemo(
    () => data.materials.find((item) => item.id === selectedMaterialId) ?? null,
    [data.materials, selectedMaterialId],
  )

  const filteredMaterials = useMemo(() => {
    return [...data.materials]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((item) => {
        const text = `${item.qrCode} ${item.name} ${item.category} ${item.comment}`.toLowerCase()
        const matchesSearch = text.includes(searchQuery.trim().toLowerCase())
        const matchesStatus = statusFilter === 'all' || item.status === statusFilter
        const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
        return matchesSearch && matchesStatus && matchesCategory
      })
  }, [categoryFilter, data.materials, searchQuery, statusFilter])

  useEffect(() => {
    saveData(data)
  }, [data])

  useEffect(() => {
    if (selectedMaterial) {
      setManualStatus(selectedMaterial.status)
    }
  }, [selectedMaterial])

  useEffect(() => {
    if (!toast) {
      return
    }

    const timer = window.setTimeout(() => {
      setToast(null)
    }, 2300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [toast])

  const showSuccessToast = (message: string) => {
    setToast({
      id: Date.now(),
      message,
      toneClassName: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    })
  }

  const showStatusToast = (status: string) => {
    const toneClassName = getStatusColorClasses(status).toast
    setToast({
      id: Date.now(),
      message: `Текущий статус: ${status}`,
      toneClassName,
    })
  }

  const processScannedQr = (scannedCodeRaw: string) => {
    const scannedCode = scannedCodeRaw.trim()
    if (!scannedCode) {
      return
    }

    const nextResult = processScan(data, scannedCode)
    setData(nextResult.nextData)

    const shouldAutoOpen = data.settings.autoOpenCardOnScan

    if (shouldAutoOpen) {
      setSelectedMaterialId(nextResult.result.materialId)
    } else {
      setSelectedMaterialId(null)
    }

    if (nextResult.result.kind === 'created') {
      setScanInfo(`Новый материал добавлен: ${scannedCode}`)
      showSuccessToast('Новый материал добавлен')
      if (shouldAutoOpen) {
        setActiveTab('list')
      }
      return
    }

    if (nextResult.result.kind === 'existing') {
      setScanInfo(`QR найден: ${scannedCode}`)

      if (!data.settings.advanceStatusOnRepeatScan) {
        const existingMaterial = data.materials.find(
          (material) => material.id === nextResult.result.materialId,
        )
        if (existingMaterial) {
          showStatusToast(existingMaterial.status)
        }
      }

      if (shouldAutoOpen) {
        setActiveTab('list')
      }
      return
    }

    setScanInfo(`Повторный скан: статус изменен на «${nextResult.result.status}»`)
    if (nextResult.result.status) {
      showSuccessToast(`Статус изменен: ${nextResult.result.status}`)
    }
  }

  const handleDetected = (detectedCodes: Array<{ rawValue?: string }>) => {
    const scannedCode = detectedCodes[0]?.rawValue?.trim()
    if (!scannedCode) {
      return
    }

    const now = Date.now()
    if (
      lastScanRef.current.qrCode === scannedCode &&
      now - lastScanRef.current.timestamp < 1800
    ) {
      return
    }

    lastScanRef.current = {
      qrCode: scannedCode,
      timestamp: now,
    }

    processScannedQr(scannedCode)
  }

  const handleManualQrSubmit = () => {
    processScannedQr(manualQr)
    setManualQr('')
  }

  const handleUpdateMaterial = (
    materialId: string,
    patch: Partial<Pick<MaterialRecord, 'name' | 'category' | 'comment'>>,
  ) => {
    setData((prev) => updateMaterialFields(prev, materialId, patch))
  }

  const handleManualStatusChange = (nextStatus: string) => {
    const previousStatus = selectedMaterial?.status
    setManualStatus(nextStatus)

    if (!selectedMaterialId) {
      return
    }

    setData((prev) => changeMaterialStatus(prev, selectedMaterialId, nextStatus, 'manual', ''))

    if (previousStatus && previousStatus !== nextStatus) {
      showSuccessToast(`Статус изменен: ${nextStatus}`)
    }
  }

  const handleDeleteMaterial = (materialId: string) => {
    const material = data.materials.find((item) => item.id === materialId)
    if (!material) {
      return
    }

    const targetLabel = material.name.trim() ? material.name : material.qrCode
    const confirmed = window.confirm(`Удалить материал «${targetLabel}»? Действие необратимо.`)
    if (!confirmed) {
      return
    }

    setData((prev) => deleteMaterial(prev, materialId))

    if (selectedMaterialId === materialId) {
      setSelectedMaterialId(null)
    }

    setScanInfo(`Материал удален: ${targetLabel}`)
  }

  const statusSelectClassName =
    'border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

  const handleAddCustomStatus = () => {
    const result = addCustomStatus(data, newCustomStatus)
    if (result.error) {
      setSettingsInfo(result.error)
      return
    }

    setData(result.nextData)
    setNewCustomStatus('')
    setSettingsInfo('Статус добавлен')
  }

  const handleAddCategory = () => {
    const result = addCategory(data, newCustomCategory)
    if (result.error) {
      setSettingsInfo(result.error)
      return
    }

    setData(result.nextData)
    setNewCustomCategory('')
    setSettingsInfo('Категория добавлена')
  }

  const handleRemoveCustomStatus = (status: string) => {
    const confirmed = window.confirm(`Удалить статус «${status}»?`)
    if (!confirmed) {
      return
    }

    const result = removeCustomStatus(data, status)
    if (result.error) {
      setSettingsInfo(result.error)
      return
    }

    setData(result.nextData)
    setSettingsInfo(`Статус «${status}» удален`)
  }

  const handleRenameStatus = (status: string) => {
    const nextName = window.prompt('Новое название статуса', status)
    if (nextName === null) {
      return
    }

    const result = renameStatus(data, status, nextName)
    if (result.error) {
      setSettingsInfo(result.error)
      return
    }

    setData(result.nextData)
    if (nextName.trim() && nextName.trim() !== status) {
      setSettingsInfo(`Статус «${status}» переименован в «${nextName.trim()}»`)
    }
  }

  const handleRemoveCategory = (category: string) => {
    const confirmed = window.confirm(`Удалить категорию «${category}»?`)
    if (!confirmed) {
      return
    }

    const result = removeCategory(data, category)
    if (result.error) {
      setSettingsInfo(result.error)
      return
    }

    setData(result.nextData)
    setSettingsInfo(`Категория «${category}» удалена`)
  }

  const handleRenameCategory = (category: string) => {
    const nextName = window.prompt('Новое название категории', category)
    if (nextName === null) {
      return
    }

    const result = renameCategory(data, category, nextName)
    if (result.error) {
      setSettingsInfo(result.error)
      return
    }

    setData(result.nextData)
    if (nextName.trim() && nextName.trim() !== category) {
      setSettingsInfo(`Категория «${category}» переименована в «${nextName.trim()}»`)
    }
  }

  const getStatusColorClasses = (status: string) => {
    const normalized = status.toLocaleLowerCase('ru-RU')

    if (normalized === 'новый') {
      return {
        badge: 'border-sky-300 bg-sky-50 text-sky-700',
        card: 'border-l-4 border-l-sky-500',
        toast: 'border-sky-300 bg-sky-50 text-sky-800',
      }
    }

    if (normalized === 'открытый') {
      return {
        badge: 'border-amber-300 bg-amber-50 text-amber-700',
        card: 'border-l-4 border-l-amber-500',
        toast: 'border-amber-300 bg-amber-50 text-amber-800',
      }
    }

    if (normalized === 'в использовании') {
      return {
        badge: 'border-violet-300 bg-violet-50 text-violet-700',
        card: 'border-l-4 border-l-violet-500',
        toast: 'border-violet-300 bg-violet-50 text-violet-800',
      }
    }

    if (normalized === 'использован') {
      return {
        badge: 'border-green-300 bg-green-50 text-green-700',
        card: 'border-l-4 border-l-green-500',
        toast: 'border-green-300 bg-green-50 text-green-800',
      }
    }

    if (normalized === 'списан') {
      return {
        badge: 'border-rose-300 bg-rose-50 text-rose-700',
        card: 'border-l-4 border-l-rose-500',
        toast: 'border-rose-300 bg-rose-50 text-rose-800',
      }
    }

    return {
      badge: 'border-slate-300 bg-slate-50 text-slate-700',
      card: 'border-l-4 border-l-slate-400',
      toast: 'border-slate-300 bg-slate-50 text-slate-800',
    }
  }

  const isBaseStatus = (status: string) => {
    return BASE_STATUSES.some((baseStatus) => {
      const resolvedName = data.settings.renamedBaseStatuses?.[baseStatus] || baseStatus
      return resolvedName.toLocaleLowerCase('ru-RU') === status.toLocaleLowerCase('ru-RU')
    })
  }

  const handleExport = () => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const filename = `warehouse-export-${timestamp}.json`
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    link.click()
    URL.revokeObjectURL(href)
    setSettingsInfo(`Экспорт готов: ${filename}`)
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      const validated = validateImportData(parsed)

      if (!validated.ok || !validated.data) {
        setSettingsInfo(validated.error ?? 'Не удалось импортировать файл')
        return
      }

      setData(validated.data)
      setSettingsInfo('Импорт завершен, база полностью восстановлена')
    } catch {
      setSettingsInfo('Ошибка чтения файла. Проверьте JSON и повторите.')
    } finally {
      event.target.value = ''
    }
  }

  const renderMaterialCard = () => {
    if (!selectedMaterial) return null

    return (
      <Sheet open={Boolean(selectedMaterialId)} onOpenChange={(open) => !open && setSelectedMaterialId(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selectedMaterial.name || 'Материал без названия'}</SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              <span>{selectedMaterial.qrCode}</span>
                <Badge variant="outline" className={getStatusColorClasses(selectedMaterial.status).badge}>
                  {selectedMaterial.status}
                </Badge>
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Название</label>
              <Input
                value={selectedMaterial.name}
                onChange={(event) =>
                  handleUpdateMaterial(selectedMaterial.id, { name: event.target.value })
                }
                placeholder="Например: Смола LOT-45"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Категория</label>
              {selectedMaterial.category === DELETED_CATEGORY_LABEL ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  У карточки удалена категория. Выберите новую категорию из списка ниже.
                </div>
              ) : null}
              <select
                className={statusSelectClassName}
                value={selectedMaterial.category}
                onChange={(event) =>
                  handleUpdateMaterial(selectedMaterial.id, { category: event.target.value })
                }
              >
                {!categories.includes(selectedMaterial.category) ? (
                  <option value={selectedMaterial.category}>{selectedMaterial.category}</option>
                ) : null}
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Статус (автосохранение)</label>
              {manualStatus === DELETED_STATUS_LABEL ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  У карточки удален статус. Выберите новый статус из списка ниже.
                </div>
              ) : null}
              <select
                className={statusSelectClassName}
                value={manualStatus}
                onChange={(event) => handleManualStatusChange(event.target.value)}
              >
                {!statuses.includes(manualStatus) ? (
                  <option value={manualStatus}>{manualStatus}</option>
                ) : null}
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Комментарий</label>
              <Textarea
                value={selectedMaterial.comment}
                onChange={(event) =>
                  handleUpdateMaterial(selectedMaterial.id, { comment: event.target.value })
                }
                placeholder="Дополнительные заметки"
                rows={3}
              />
            </div>

            <div className="text-muted-foreground text-xs">
              Создан: {formatDateTime(selectedMaterial.createdAt)}
            </div>
            <div className="text-muted-foreground text-xs">
              Обновлен: {formatDateTime(selectedMaterial.updatedAt)}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">История изменений</div>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2">
                {selectedMaterial.history
                  .slice()
                  .reverse()
                  .map((historyItem) => (
                    <div key={historyItem.id} className="rounded-md border p-2 text-sm">
                      <div className="font-medium">
                        {historyItem.fromStatus ?? 'нет'} {'->'} {historyItem.toStatus}
                      </div>
                      <div className="text-muted-foreground text-xs">{formatDateTime(historyItem.at)}</div>
                      <div className="text-muted-foreground text-xs">Источник: {historyItem.source}</div>
                      {historyItem.comment ? <div>{historyItem.comment}</div> : null}
                    </div>
                  ))}
              </div>
            </div>

            <Button
              variant="destructive"
              onClick={() => handleDeleteMaterial(selectedMaterial.id)}
              className="w-full"
            >
              <Trash2 className="size-4" />
              Удалить материал
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-3 py-4 md:px-4">
      {toast ? (
        <div className="pointer-events-none fixed top-3 right-3 left-3 z-[120]" aria-live="polite">
          <div className={`mx-auto flex min-h-[74px] w-full max-w-5xl items-center gap-3 rounded-lg border px-5 py-5 text-base font-medium shadow-lg ${toast.toneClassName}`}>
            <CheckCircle2 className="size-5" />
            <span>{toast.message}</span>
          </div>
        </div>
      ) : null}

      <Card className="mb-3 border-none bg-gradient-to-br from-amber-100 via-lime-50 to-emerald-100 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Склад Материалов 3D Форм</CardTitle>
          <CardDescription>
            Компактный workflow: сканируй, фильтруй, открывай карточку в боковой панели.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AppTab)}>
        <TabsList>
          <TabsTrigger value="scan">
            <QrCode className="size-4" />
            Сканирование
          </TabsTrigger>
          <TabsTrigger value="list">
            <Database className="size-4" />
            Материалы ({data.materials.length})
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-4" />
            Настройки
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Camera className="size-4" />
                Быстрое сканирование
              </CardTitle>
              <CardDescription>Сканируйте камерой или введите код вручную.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <span className="sr-only" aria-live="polite">{scanInfo}</span>
              {!window.isSecureContext ? (
                <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
                  Камера на телефоне требует HTTPS или localhost. Текущий адрес:
                  {' '}
                  {window.location.protocol}//{window.location.host}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!window.isSecureContext}
                  onClick={() => setCameraEnabled((prev) => !prev)}
                >
                  {cameraEnabled ? 'Остановить камеру' : 'Запустить камеру'}
                </Button>
              </div>

              {cameraEnabled ? (
                <div className="overflow-hidden rounded-lg border">
                  <Scanner
                    constraints={{ facingMode: 'environment' }}
                    onScan={(codes) => handleDetected(codes as Array<{ rawValue?: string }>)}
                    formats={[
                      'qr_code',
                      'code_128',
                      'code_39',
                      'code_93',
                      'codabar',
                      'ean_13',
                      'ean_8',
                      'itf',
                      'upc_a',
                      'upc_e',
                    ]}
                    allowMultiple
                  />
                </div>
              ) : (
                <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                  Камера выключена
                </div>
              )}

              <div className="grid gap-2">
                <label className="text-sm font-medium">Ручной ввод кода</label>
                <div className="flex gap-2">
                  <Input
                    value={manualQr}
                    onChange={(event) => setManualQr(event.target.value)}
                    placeholder="Вставьте значение QR/штрихкода"
                  />
                  <Button onClick={handleManualQrSubmit}>Добавить</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="size-4" />
                Список материалов
              </CardTitle>
              <CardDescription>
                Нажми на запись, чтобы открыть карточку в панели справа/снизу.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Поиск: QR, имя, категория"
                />

                <select
                  className={statusSelectClassName}
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">Все статусы</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <select
                  className={statusSelectClassName}
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">Все категории</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
                {filteredMaterials.length === 0 ? (
                  <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                    Ничего не найдено
                  </div>
                ) : (
                  filteredMaterials.map((material) => (
                    <div
                      key={material.id}
                      className={`bg-card hover:bg-muted/40 flex w-full cursor-pointer items-start justify-between rounded-lg border p-3 text-left ${getStatusColorClasses(material.status).card}`}
                      onClick={() => setSelectedMaterialId(material.id)}
                    >
                      <div className="space-y-1">
                        <div className="font-medium">{material.name || '(без названия)'}</div>
                        <div className="text-muted-foreground text-xs">{material.qrCode}</div>
                        <div className="text-muted-foreground text-xs">
                          {material.category} • {formatDateTime(material.updatedAt)}
                        </div>
                      </div>

                      <div className="ml-3 flex flex-col items-end gap-2">
                        <Badge variant="outline" className={getStatusColorClasses(material.status).badge}>
                          {material.status}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleDeleteMaterial(material.id)
                          }}
                        >
                          <Trash2 className="size-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          {renderMaterialCard()}
        </TabsContent>

        <TabsContent value="settings" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Настройки и справочники</CardTitle>
              <CardDescription>
                {settingsInfo || 'Управление статусами, экспорт и импорт базы'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5 pr-4">
                  <div className="text-sm font-medium">Автоматически открывать карточку после сканирования</div>
                  <div className="text-muted-foreground text-xs">
                    Выключите для быстрого поточного сканирования без открытия карточек.
                  </div>
                </div>
                <Switch
                  checked={data.settings.autoOpenCardOnScan}
                  onCheckedChange={(checked) => {
                    setData((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        autoOpenCardOnScan: checked,
                      },
                    }))
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5 pr-4">
                  <div className="text-sm font-medium">При повторном сканировании двигать статус дальше</div>
                  <div className="text-muted-foreground text-xs">
                    Каждый повторный скан переводит материал на следующий статус.
                  </div>
                </div>
                <Switch
                  checked={data.settings.advanceStatusOnRepeatScan}
                  onCheckedChange={(checked) => {
                    setData((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        advanceStatusOnRepeatScan: checked,
                      },
                    }))
                  }}
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Добавить кастомный статус</label>
                <div className="flex gap-2">
                  <Input
                    value={newCustomStatus}
                    onChange={(event) => setNewCustomStatus(event.target.value)}
                    placeholder="Например: новый"
                  />
                  <Button onClick={handleAddCustomStatus}>Добавить</Button>
                </div>
              </div>

              <div className="space-y-2">
                {statuses.map((status) => (
                  <div key={status} className="flex items-center justify-between rounded-md border p-2">
                    <span className="text-sm">{status}</span>
                    <div className="flex items-center gap-2">
                      {isBaseStatus(status) ? (
                        <Badge variant="secondary" className={getStatusColorClasses(status).badge}>
                          базовый
                        </Badge>
                      ) : null}
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Переименовать статус ${status}`}
                        onClick={() => handleRenameStatus(status)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Удалить статус ${status}`}
                        onClick={() => handleRemoveCustomStatus(status)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Добавить категорию</label>
                <div className="flex gap-2">
                  <Input
                    value={newCustomCategory}
                    onChange={(event) => setNewCustomCategory(event.target.value)}
                    placeholder="Например: расходники"
                  />
                  <Button onClick={handleAddCategory}>Добавить</Button>
                </div>
              </div>

              <div className="space-y-2">
                {categories.map((category) => (
                  <div key={category} className="flex items-center justify-between rounded-md border p-2">
                    <span className="text-sm">{category}</span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Переименовать категорию ${category}`}
                        onClick={() => handleRenameCategory(category)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Удалить категорию ${category}`}
                        onClick={() => handleRemoveCategory(category)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleExport}>Экспорт JSON</Button>
                <Button variant="outline" asChild>
                  <label>
                    Импорт JSON
                    <input className="hidden" type="file" accept="application/json" onChange={handleImport} />
                  </label>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default App
