import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Background, BackgroundLayout, BgCrop, OccasionType, SlotRect, UpdateLayoutRequest } from '../types'
import {
  getBackground,
  uploadBackgroundImage,
  updateBackground,
  deleteBackground,
  createLayout,
  updateLayout,
  deleteLayout,
} from '../api/client'
import LayoutEditorModal from '../components/LayoutEditorModal'
import PreviewPanel from '../components/PreviewPanel'

const OCCASIONS: OccasionType[] = ['Funeral', 'Birthday', 'Others']

const DEFAULT_SLOTS = JSON.stringify([{
  id: 'main-subject', x: 0.25, y: 0.15, w: 0.50, h: 0.60,
  anchor: 'BottomCenter', fitMode: 'Contain',
  allowUserMove: true, allowUserScale: true, minScale: 0.8, maxScale: 1.4,
}])

export default function BackgroundDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [bg, setBg] = useState<Background | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [imgCacheBust, setImgCacheBust] = useState(() => Date.now())

  // Metadata form
  const [name, setName] = useState('')
  const [occasion, setOccasion] = useState<OccasionType>('Funeral')

  // Layout editor modal
  const [editingLayout, setEditingLayout] = useState<BackgroundLayout | null>(null)
  // Preview modal
  const [previewLayoutId, setPreviewLayoutId] = useState<string | null>(null)
  // Which layout is shown in the left-column thumbnail (defaults to first)
  const [selectedPreviewLayoutId, setSelectedPreviewLayoutId] = useState<string | null>(null)

  useEffect(() => {
    if (id) load(id)
  }, [id])

  async function load(bgId: string) {
    setLoading(true)
    try {
      const loaded = await getBackground(bgId)
      setBg(loaded)
      setName(loaded.name)
      setOccasion(loaded.occasionType)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveMetadata(e: React.FormEvent) {
    e.preventDefault()
    if (!bg) return
    setSaving(true)
    try {
      const updated = await updateBackground(bg.id, { name, occasionType: occasion })
      setBg(prev => prev ? { ...prev, name: updated.name, occasionType: updated.occasionType } : prev)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleImageUpload(file: File, input: HTMLInputElement) {
    if (!bg) return
    setUploading(true)
    try {
      const updated = await uploadBackgroundImage(bg.id, file)
      setBg(prev => prev ? { ...prev, sourcePath: updated.sourcePath, previewPath: updated.previewPath } : prev)
      setImgCacheBust(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      // Reset so the same file can be re-selected if needed
      input.value = ''
    }
  }

  async function handleDelete() {
    if (!bg || !window.confirm(`Delete "${bg.name}"? This cannot be undone.`)) return
    try {
      await deleteBackground(bg.id)
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleAddLayout() {
    if (!bg) return
    try {
      const layout = await createLayout(bg.id, {
        sizeCode: 'A3', widthMm: 297, heightMm: 420, orientation: 'Portrait',
        subjectSlotsJson: DEFAULT_SLOTS,
        textZonesJson: null,
      })
      setBg(prev => prev ? { ...prev, layouts: [...prev.layouts, layout] } : prev)
      setEditingLayout(layout)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleSaveLayout(layoutId: string, req: UpdateLayoutRequest) {
    if (!bg) return
    const updated = await updateLayout(bg.id, layoutId, req)
    setBg(prev => prev
      ? { ...prev, layouts: prev.layouts.map(l => l.id === layoutId ? updated : l) }
      : prev)
    setEditingLayout(null)
  }

  async function handleDeleteLayout(layoutId: string) {
    if (!bg || !window.confirm('Delete this layout?')) return
    try {
      await deleteLayout(bg.id, layoutId)
      setBg(prev => prev
        ? { ...prev, layouts: prev.layouts.filter(l => l.id !== layoutId) }
        : prev)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <div className="text-gray-400 text-sm py-8">Loading…</div>
  if (!bg) return <div className="text-red-500 text-sm py-8">{error ?? 'Not found'}</div>

  const previewLayout =
    (selectedPreviewLayoutId ? bg.layouts.find(l => l.id === selectedPreviewLayoutId) : null)
    ?? bg.layouts[0]
    ?? null
  const previewAspect =
    previewLayout && previewLayout.widthMm > 0 && previewLayout.heightMm > 0
      ? previewLayout.widthMm / previewLayout.heightMm
      : 3 / 4
  const previewBgCrop = parseBgCrop(previewLayout?.bgCropJson)
  const previewSlots  = parseSlots(previewLayout?.subjectSlotsJson)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-400 flex items-center gap-2">
        <Link to="/" className="hover:text-indigo-600">Templates</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{bg.name}</span>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left column: image ── */}
        <div>
          <div
            className="relative bg-gray-100 rounded-xl overflow-hidden border border-gray-200"
            style={{ aspectRatio: String(previewAspect) }}
          >
            {bg.previewPath ? (
              <img
                src={`/${bg.previewPath}?t=${imgCacheBust}`}
                alt={bg.name}
                className="absolute inset-0 w-full h-full object-contain"
                style={previewBgCrop ? {
                  transform: `translate(${previewBgCrop.offsetX * 100}%, ${previewBgCrop.offsetY * 100}%) scale(${previewBgCrop.scale})`,
                  transformOrigin: 'center center',
                } : undefined}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 gap-2">
                <span className="text-5xl">🖼️</span>
                <span className="text-xs">No image</span>
              </div>
            )}

            {/* Slot overlays */}
            {previewSlots.map(slot => (
              <div
                key={slot.id}
                className="absolute pointer-events-none"
                style={{
                  left: `${slot.x * 100}%`,
                  top: `${slot.y * 100}%`,
                  width: `${slot.w * 100}%`,
                  height: `${slot.h * 100}%`,
                  border: '2px dashed rgba(255,255,255,0.85)',
                  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.35)',
                  ...slotOverlayStyle(slot),
                }}
              />
            ))}

            {/* Layout badge */}
            {previewLayout && (
              <div className="absolute bottom-2 left-2 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded pointer-events-none">
                {previewLayout.sizeCode} {previewLayout.orientation}
              </div>
            )}

            {uploading && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                <span className="text-sm text-gray-500">Uploading…</span>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, e.target) }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="mt-3 w-full py-2 border border-dashed border-gray-300 text-sm text-gray-500 rounded-lg hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
          >
            {bg.sourcePath ? 'Replace image' : '+ Upload image'}
          </button>
          {bg.sourcePath && (
            <p className="mt-1 text-[10px] text-gray-400 truncate px-1">{bg.sourcePath}</p>
          )}
        </div>

        {/* ── Right columns: metadata + layouts ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Metadata card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-4">Background Metadata</h2>
            <form onSubmit={handleSaveMetadata} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Occasion Type</label>
                <select
                  value={occasion}
                  onChange={e => setOccasion(e.target.value as OccasionType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="ml-auto px-3 py-2 text-red-500 text-sm rounded-lg hover:bg-red-50 border border-red-200"
                >
                  Delete template
                </button>
              </div>
            </form>
          </div>

          {/* Layouts card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-sm">
                Layouts
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  ({bg.layouts.length})
                </span>
              </h2>
              <button
                onClick={handleAddLayout}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                + Add Layout
              </button>
            </div>

            {bg.layouts.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                No layouts yet. Add one to define subject placement slots.
              </p>
            ) : (
              <div className="space-y-2">
                {bg.layouts.map(layout => (
                  <div
                    key={layout.id}
                    onClick={() => setSelectedPreviewLayoutId(layout.id)}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      previewLayout?.id === layout.id
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {layout.sizeCode} {layout.orientation}
                        <span className="ml-2 text-xs text-gray-400 font-normal">
                          {layout.widthMm}×{layout.heightMm}mm
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        v{layout.version} ·{' '}
                        {tryParseCount(layout.subjectSlotsJson)} slot(s)
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => setPreviewLayoutId(layout.id)}
                        className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => setEditingLayout(layout)}
                        className="px-2.5 py-1 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                      >
                        Edit slots
                      </button>
                      <button
                        onClick={() => handleDeleteLayout(layout.id)}
                        className="px-2.5 py-1 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Layout editor modal */}
      {editingLayout && (
        <LayoutEditorModal
          layout={editingLayout}
          backgroundImageUrl={bg.sourcePath ? `/${bg.sourcePath}` : null}
          onSave={req => handleSaveLayout(editingLayout.id, req)}
          onClose={() => setEditingLayout(null)}
        />
      )}

      {/* Preview modal */}
      {previewLayoutId && (
        <PreviewPanel layoutId={previewLayoutId} onClose={() => setPreviewLayoutId(null)} />
      )}
    </div>
  )
}

function tryParseCount(json: string | null | undefined): number {
  if (!json) return 0
  try { return (JSON.parse(json) as unknown[]).length } catch { return 0 }
}

function parseBgCrop(json: string | null | undefined): BgCrop | null {
  if (!json) return null
  try { return JSON.parse(json) as BgCrop } catch { return null }
}

function parseSlots(json: string | null | undefined): SlotRect[] {
  if (!json) return []
  try { return JSON.parse(json) as SlotRect[] } catch { return [] }
}

function slotOverlayStyle(slot: SlotRect): React.CSSProperties {
  const shape = slot.shape ?? 'rect'
  if (shape === 'ellipse') return { borderRadius: '50%' }
  if (shape === 'polygon' && slot.points && slot.points.length >= 3) {
    const pts = slot.points
      .map(([px, py]) =>
        `${((px - slot.x) / slot.w * 100).toFixed(2)}% ${((py - slot.y) / slot.h * 100).toFixed(2)}%`
      )
      .join(', ')
    return { clipPath: `polygon(${pts})` }
  }
  return {}
}
