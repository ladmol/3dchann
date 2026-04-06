import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Scanner } from '@yudiel/react-qr-scanner'
import './App.css'
import {
  addCustomStatus,
  BASE_STATUSES,
  changeMaterialStatus,
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
  const [statusComment, setStatusComment] = useState('')

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

  const handleChangeStatus = () => {
    if (!selectedMaterialId) {
      return
    }

    setData((prev) =>
      changeMaterialStatus(prev, selectedMaterialId, manualStatus, 'manual', statusComment.trim()),
    )
    setStatusComment('')
  }

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
    if (!selectedMaterial) {
      return (
        <section className="panel">
          <h2>Карточка материала</h2>
          <p className="muted">Выберите запись из списка или отсканируйте QR</p>
        </section>
      )
    }

  return (
      <section className="panel">
        <div className="card-head">
          <h2>Карточка материала</h2>
          <span className="chip">ID: {selectedMaterial.id.slice(0, 8)}</span>
        </div>

        <div className="field-group">
          <label>QR-код</label>
          <input value={selectedMaterial.qrCode} readOnly />
        </div>

        <div className="two-columns">
          <div className="field-group">
            <label>Название</label>
            <input
              value={selectedMaterial.name}
              onChange={(event) =>
                handleUpdateMaterial(selectedMaterial.id, { name: event.target.value })
              }
              placeholder="Например: Смола LOT-45"
            />
          </div>
          <div className="field-group">
            <label>Категория</label>
            <input
              list="category-options"
              value={selectedMaterial.category}
              onChange={(event) =>
                handleUpdateMaterial(selectedMaterial.id, { category: event.target.value })
              }
              placeholder="Категория"
            />
          </div>
        </div>

        <div className="two-columns">
          <div className="field-group">
            <label>Текущий статус</label>
            <select value={manualStatus} onChange={(event) => setManualStatus(event.target.value)}>
              {statuses.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label>Комментарий к смене статуса</label>
            <input
              value={statusComment}
              onChange={(event) => setStatusComment(event.target.value)}
              placeholder="Причина смены статуса"
            />
          </div>
        </div>

        <div className="button-row">
          <button className="button" onClick={handleChangeStatus}>
            Применить статус вручную
          </button>
        </div>

        <div className="field-group">
          <label>Комментарий по материалу</label>
          <textarea
            value={selectedMaterial.comment}
            onChange={(event) =>
              handleUpdateMaterial(selectedMaterial.id, { comment: event.target.value })
            }
            rows={3}
            placeholder="Дополнительные заметки"
          />
        </div>

        <p className="meta">
          Создан: {formatDateTime(selectedMaterial.createdAt)} | Обновлен:{' '}
          {formatDateTime(selectedMaterial.updatedAt)}
        </p>

        <h3>История изменений</h3>
        <div className="history-list">
          {selectedMaterial.history
            .slice()
            .reverse()
            .map((historyItem) => (
              <article className="history-item" key={historyItem.id}>
                <div>
                  <strong>
                    {historyItem.fromStatus ?? 'нет'} → {historyItem.toStatus}
                  </strong>
                </div>
                <div className="meta">{formatDateTime(historyItem.at)}</div>
                <div className="meta">Источник: {historyItem.source}</div>
                {historyItem.comment ? <div>{historyItem.comment}</div> : null}
              </article>
            ))}
        </div>
      </section>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="badge">MVP • Offline Ready</p>
        <h1>Склад Материалов 3D Форм</h1>
        <p>
          Быстрый учет по QR: сканирование, смена статусов, история, экспорт и импорт без
          сервера.
        </p>
      </header>

      <nav className="tab-row">
        <button
          className={`tab-button ${activeTab === 'scan' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('scan')}
        >
          Сканирование
        </button>
        <button
          className={`tab-button ${activeTab === 'list' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          Материалы ({data.materials.length})
        </button>
        <button
          className={`tab-button ${activeTab === 'settings' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Настройки
        </button>
      </nav>

      <main className="content-stack">
        {activeTab === 'scan' ? (
          <section className="panel">
            <h2>Экран сканирования</h2>
            <p className="muted">{scanInfo}</p>
            {!window.isSecureContext ? (
              <div className="camera-warning">
                <strong>Камера на телефоне не будет запрошена в HTTP.</strong>
                <p>
                  Откройте приложение через HTTPS (или localhost). Текущий адрес:{' '}
                  {window.location.protocol}//{window.location.host}
                </p>
              </div>
            ) : null}

            <div className="button-row">
              <button
                className="button"
                disabled={!window.isSecureContext}
                onClick={() => setCameraEnabled((prev) => !prev)}
              >
                {cameraEnabled ? 'Остановить камеру' : 'Запустить камеру'}
              </button>
              <button className="button ghost" onClick={probeCameraAccess}>
                Проверить доступ к камере
              </button>
              <button
                className="button ghost"
                onClick={() => {
                  setCameraEnabled(false)
                  setScanInfo('Камера остановлена')
                }}
              >
                Сброс
              </button>
            </div>

            {cameraEnabled ? (
              <div className="scanner-wrap">
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
              <p className="muted">Камера выключена</p>
            )}

            <div className="field-group">
              <label>Ручной ввод QR (fallback для теста без камеры)</label>
              <div className="button-row">
                <input
                  value={manualQr}
                  onChange={(event) => setManualQr(event.target.value)}
                  placeholder="Вставьте строку QR"
                />
                <button className="button" onClick={handleManualQrSubmit}>
                  Обработать QR
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'list' ? (
          <>
            <section className="panel">
              <h2>Список материалов</h2>
              <div className="two-columns">
                <div className="field-group">
                  <label>Поиск</label>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="QR, название, категория, комментарий"
                  />
                </div>
                <div className="field-group">
                  <label>Фильтр по статусу</label>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">Все</option>
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-group">
                <label>Фильтр по категории</label>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">Все</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="material-list">
                {filteredMaterials.length === 0 ? (
                  <p className="muted">Ничего не найдено</p>
                ) : (
                  filteredMaterials.map((material) => (
                    <article
                      className={`material-item ${
                        selectedMaterialId === material.id ? 'is-selected' : ''
                      }`}
                      key={material.id}
                    >
                      <div>
                        <strong>{material.name || '(без названия)'}</strong>
                        <div className="meta">{material.qrCode}</div>
                      </div>
                      <div className="meta">
                        {material.category} • {material.status}
                      </div>
                      <div className="button-row">
                        <button className="button small" onClick={() => setSelectedMaterialId(material.id)}>
                          Открыть карточку
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            {renderMaterialCard()}
          </>
        ) : null}

        {activeTab === 'settings' ? (
          <section className="panel">
            <h2>Настройки и справочники</h2>
            <p className="muted">{settingsInfo || 'Управление статусами и перенос базы между устройствами'}</p>

            <div className="field-group">
              <label>Поведение при повторном сканировании</label>
              <select
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
              <div className="field-group">
                <label>Статус для авто-сценария</label>
                <select
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

            <div className="field-group">
              <label>Добавить кастомный статус</label>
              <div className="button-row">
                <input
                  value={newCustomStatus}
                  onChange={(event) => setNewCustomStatus(event.target.value)}
                  placeholder="Например: на карантине"
                />
                <button className="button" onClick={handleAddCustomStatus}>
                  Добавить
                </button>
              </div>
            </div>

            <div className="status-list">
              {statuses.map((status) => (
                <div className="status-item" key={status}>
                  <span>{status}</span>
                  {BASE_STATUSES.includes(status as (typeof BASE_STATUSES)[number]) ? (
                    <span className="chip">базовый</span>
                  ) : (
                    <button className="button small ghost" onClick={() => handleRemoveCustomStatus(status)}>
                      Удалить
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="button-row">
              <button className="button" onClick={handleExport}>
                Экспорт JSON
              </button>
              <label className="button ghost file-upload">
                Импорт JSON
                <input type="file" accept="application/json" onChange={handleImport} />
              </label>
            </div>
          </section>
        ) : null}
      </main>

      <datalist id="category-options">
        {categories.map((category) => (
          <option value={category} key={category} />
        ))}
      </datalist>
    </div>
  )
}

export default App
