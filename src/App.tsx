import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Camera, Database, QrCode, Search, Settings, Trash2 } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import {
  addCustomStatus,
  BASE_STATUSES,
  changeMaterialStatus,
  deleteMaterial,
  DEFAULT_CATEGORIES,
  formatDateTime,
  getAllStatuses,
  loadData,
  processScan,
  removeCustomStatus,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Textarea } from './components/ui/textarea'

type AppTab = 'scan' | 'list' | 'settings'

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
  const [settingsInfo, setSettingsInfo] = useState('')

  const lastScanRef = useRef({ qrCode: '', timestamp: 0 })

  const statuses = useMemo(() => getAllStatuses(data.settings), [data.settings])

  const categories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES)
    for (const material of data.materials) {
      if (material.category.trim()) {
        set.add(material.category.trim())
      }
    }
    return Array.from(set)
  }, [data.materials])

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

  const processScannedQr = (scannedCodeRaw: string) => {
    const scannedCode = scannedCodeRaw.trim()
    if (!scannedCode) {
      return
    }

    const nextResult = processScan(data, scannedCode)
    setData(nextResult.nextData)

    setSelectedMaterialId(nextResult.result.materialId)

    if (nextResult.result.kind === 'created') {
      setScanInfo(`Новый материал добавлен: ${scannedCode}`)
      setActiveTab('list')
      return
    }

    if (nextResult.result.kind === 'existing') {
      setScanInfo(`QR найден: ${scannedCode}`)
      setActiveTab('list')
      return
    }

    setScanInfo(`Повторный скан: статус изменен на «${nextResult.result.status}»`)
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

  const probeCameraAccess = async () => {
    if (!window.isSecureContext) {
      setScanInfo(
        `Камера доступна только в HTTPS/localhost. Сейчас: ${window.location.protocol}//${window.location.host}`,
      )
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setScanInfo('Браузер не поддерживает MediaDevices/getUserMedia')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
        },
      })
      stream.getTracks().forEach((track) => track.stop())
      setScanInfo('Доступ к камере получен. Можно запускать сканер.')
      setCameraEnabled(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setScanInfo(`Не удалось получить доступ к камере: ${message}`)
    }
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
    setManualStatus(nextStatus)

    if (!selectedMaterialId) {
      return
    }

    setData((prev) => changeMaterialStatus(prev, selectedMaterialId, nextStatus, 'manual', ''))
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

  const handleRemoveCustomStatus = (status: string) => {
    const result = removeCustomStatus(data, status)
    if (result.error) {
      setSettingsInfo(result.error)
      return
    }

    setData(result.nextData)
    setSettingsInfo(`Статус «${status}» удален`)
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
              <Badge variant="outline">{selectedMaterial.status}</Badge>
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
              <Input
                list="category-options"
                value={selectedMaterial.category}
                onChange={(event) =>
                  handleUpdateMaterial(selectedMaterial.id, { category: event.target.value })
                }
                placeholder="Категория"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Статус (автосохранение)</label>
              <select
                className={statusSelectClassName}
                value={manualStatus}
                onChange={(event) => handleManualStatusChange(event.target.value)}
              >
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
              <CardDescription>{scanInfo}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
                <Button variant="outline" onClick={probeCameraAccess}>
                  Проверить доступ
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCameraEnabled(false)
                    setScanInfo('Камера остановлена')
                  }}
                >
                  Сброс
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
                      className="bg-card hover:bg-muted/40 flex w-full cursor-pointer items-start justify-between rounded-lg border p-3 text-left"
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
                        <Badge variant="outline">{material.status}</Badge>
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
              <div className="grid gap-2">
                <label className="text-sm font-medium">Поведение при повторном сканировании</label>
                <select
                  className={statusSelectClassName}
                  value={data.settings.repeatScanMode}
                  onChange={(event) => {
                    const mode = event.target.value as AppData['settings']['repeatScanMode']
                    setData((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        repeatScanMode: mode,
                      },
                    }))
                  }}
                >
                  <option value="open-card">Открывать карточку записи</option>
                  <option value="auto-status">Автоматически менять статус</option>
                </select>
              </div>

              {data.settings.repeatScanMode === 'auto-status' ? (
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Статус для авто-сценария</label>
                  <select
                    className={statusSelectClassName}
                    value={data.settings.autoScanStatus}
                    onChange={(event) => {
                      const nextStatus = event.target.value
                      setData((prev) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          autoScanStatus: nextStatus,
                        },
                      }))
                    }}
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="grid gap-2">
                <label className="text-sm font-medium">Добавить кастомный статус</label>
                <div className="flex gap-2">
                  <Input
                    value={newCustomStatus}
                    onChange={(event) => setNewCustomStatus(event.target.value)}
                    placeholder="Например: на карантине"
                  />
                  <Button onClick={handleAddCustomStatus}>Добавить</Button>
                </div>
              </div>

              <div className="space-y-2">
                {statuses.map((status) => (
                  <div key={status} className="flex items-center justify-between rounded-md border p-2">
                    <span className="text-sm">{status}</span>
                    {BASE_STATUSES.includes(status as (typeof BASE_STATUSES)[number]) ? (
                      <Badge variant="secondary">базовый</Badge>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => handleRemoveCustomStatus(status)}>
                        Удалить
                      </Button>
                    )}
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

      <datalist id="category-options">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </div>
  )
}

export default App
