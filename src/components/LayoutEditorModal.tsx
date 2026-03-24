import { useState } from 'react'
import type { BackgroundLayout, BgCrop, SlotRect, SlotShape, TextZoneRect, UpdateLayoutRequest } from '../types'
import RectCanvas from './RectCanvas'

const DEFAULT_BG_CROP: BgCrop = { scale: 1, offsetX: 0, offsetY: 0 }

function parseBgCrop(json: string | null | undefined): BgCrop {
  if (!json) return DEFAULT_BG_CROP
  try { return { ...DEFAULT_BG_CROP, ...JSON.parse(json) } } catch { return DEFAULT_BG_CROP }
}

type DrawMode = 'select' | 'rect' | 'ellipse' | 'polygon'

const DRAW_TOOLS: { mode: DrawMode; label: string; title: string }[] = [
  { mode: 'select',  label: '↖',  title: 'Select / move' },
  { mode: 'rect',    label: '▣',  title: 'Draw rect slot' },
  { mode: 'ellipse', label: '⬭',  title: 'Draw ellipse slot' },
  { mode: 'polygon', label: '⬡',  title: 'Draw polygon slot (click vertices, dbl-click to close)' },
]

interface Props {
  layout: BackgroundLayout
  backgroundImageUrl: string | null
  onSave: (req: UpdateLayoutRequest) => Promise<void>
  onClose: () => void
}

function parseRects<T>(json: string | null | undefined, fallback: T[]): T[] {
  if (!json) return fallback
  try { return JSON.parse(json) as T[] } catch { return fallback }
}

function SlotRow({
  slot, index, onChange, onDelete,
}: {
  slot: SlotRect
  index: number
  onChange: (s: SlotRect) => void
  onDelete: () => void
}) {
  return (
    <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-blue-800">Slot {index + 1}</span>
          <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
            slot.shape === 'ellipse' ? 'bg-purple-100 text-purple-700' :
            slot.shape === 'polygon' ? 'bg-orange-100 text-orange-700' :
            'bg-blue-100 text-blue-700'
          }`}>
            {slot.shape ?? 'rect'}
          </span>
        </div>
        <button onClick={onDelete} className="text-red-400 hover:text-red-600">✕</button>
      </div>
      <div>
        <label className="block text-gray-400 mb-0.5">ID</label>
        <input
          value={slot.id}
          onChange={e => onChange({ ...slot, id: e.target.value })}
          className="w-full px-1.5 py-0.5 border border-blue-200 rounded text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-1 text-gray-500 font-mono">
        <span>x: {slot.x.toFixed(3)}</span>
        <span>y: {slot.y.toFixed(3)}</span>
        <span>w: {slot.w.toFixed(3)}</span>
        <span>h: {slot.h.toFixed(3)}</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div>
          <label className="block text-gray-400 mb-0.5">Anchor</label>
          <select
            value={slot.anchor}
            onChange={e => onChange({ ...slot, anchor: e.target.value })}
            className="w-full px-1 py-0.5 border border-blue-200 rounded text-xs"
          >
            {['Center', 'TopCenter', 'BottomCenter', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(a =>
              <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-gray-400 mb-0.5">Fit Mode</label>
          <select
            value={slot.fitMode}
            onChange={e => onChange({ ...slot, fitMode: e.target.value })}
            className="w-full px-1 py-0.5 border border-blue-200 rounded text-xs"
          >
            {['Contain', 'Cover', 'Fill'].map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}

function TextZoneRow({
  zone, index, onChange, onDelete,
}: {
  zone: TextZoneRect
  index: number
  onChange: (z: TextZoneRect) => void
  onDelete: () => void
}) {
  return (
    <div className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-emerald-800">Text Zone {index + 1}</span>
        <button onClick={onDelete} className="text-red-400 hover:text-red-600">✕</button>
      </div>
      <div>
        <label className="block text-gray-400 mb-0.5">ID</label>
        <input
          value={zone.id}
          onChange={e => onChange({ ...zone, id: e.target.value })}
          className="w-full px-1.5 py-0.5 border border-emerald-200 rounded text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-1 text-gray-500 font-mono">
        <span>x: {zone.x.toFixed(3)}</span>
        <span>y: {zone.y.toFixed(3)}</span>
        <span>w: {zone.w.toFixed(3)}</span>
        <span>h: {zone.h.toFixed(3)}</span>
      </div>
    </div>
  )
}

export default function LayoutEditorModal({ layout, backgroundImageUrl, onSave, onClose }: Props) {
  const [sizeCode, setSizeCode]       = useState(layout.sizeCode)
  const [widthMm, setWidthMm]         = useState(layout.widthMm)
  const [heightMm, setHeightMm]       = useState(layout.heightMm)
  const [orientation, setOrientation] = useState(layout.orientation)

  const [slots, setSlots]         = useState<SlotRect[]>(parseRects(layout.subjectSlotsJson, []))
  const [textZones, setTextZones] = useState<TextZoneRect[]>(parseRects(layout.textZonesJson, []))

  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [drawMode, setDrawMode] = useState<DrawMode>('select')
  const [bgCrop, setBgCrop]     = useState<BgCrop>(() => parseBgCrop(layout.bgCropJson))

  const aspectRatio = widthMm / heightMm

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        sizeCode,
        widthMm,
        heightMm,
        orientation,
        subjectSlotsJson: JSON.stringify(slots),
        textZonesJson: textZones.length > 0 ? JSON.stringify(textZones) : null,
        bgCropJson: JSON.stringify(bgCrop),
      })
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  function addSlot(shape: SlotShape = 'rect') {
    setSlots(prev => [...prev, {
      id: `slot-${prev.length + 1}`,
      shape,
      x: 0.25, y: 0.20, w: 0.50, h: 0.55,
      anchor: 'BottomCenter', fitMode: 'Contain',
      allowUserMove: true, allowUserScale: true,
      minScale: 0.8, maxScale: 1.4,
    }])
  }

  function addTextZone() {
    const ids = ['title', 'subtitle', 'footer']
    const usedIds = new Set(textZones.map(z => z.id))
    const nextId = ids.find(id => !usedIds.has(id)) ?? `text-${textZones.length + 1}`
    setTextZones(prev => [...prev, {
      id: nextId,
      x: 0.05, y: 0.75, w: 0.90, h: 0.08,
    }])
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="font-semibold text-gray-900">
            Layout Editor — {sizeCode} {orientation}
            <span className="ml-2 text-xs text-gray-400 font-normal">
              use toolbar to draw slots · drag to move · drag corners to resize
            </span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Canvas */}
          <div className="flex-1 bg-gray-50 p-6 overflow-auto flex flex-col items-center gap-3">
            {/* Draw mode toolbar */}
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm self-start">
              {DRAW_TOOLS.map(tool => (
                <button
                  key={tool.mode}
                  title={tool.title}
                  onClick={() => setDrawMode(tool.mode)}
                  className={`w-8 h-8 rounded text-sm font-bold transition-colors ${
                    drawMode === tool.mode
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {tool.label}
                </button>
              ))}
              {drawMode !== 'select' && (
                <span className="ml-1 text-[10px] text-indigo-500 font-medium pr-1">
                  {drawMode === 'polygon' ? 'click vertices · dbl-click to close' : 'drag to draw'}
                </span>
              )}
            </div>

            <div className="w-full max-w-xs">
              <RectCanvas
                imageUrl={backgroundImageUrl}
                aspectRatio={aspectRatio}
                slots={slots}
                textZones={textZones}
                onSlotsChange={setSlots}
                onTextZonesChange={setTextZones}
                drawMode={drawMode}
                onDrawComplete={() => setDrawMode('select')}
                bgCrop={bgCrop}
                onBgCropChange={setBgCrop}
              />
              <p className="text-[10px] text-gray-400 text-center mt-2">
                {sizeCode} {orientation} — {widthMm}×{heightMm} mm
              </p>
              <p className="text-[10px] text-gray-400 text-center">
                Blue = subject slot · Green = text zone · drag empty area to pan bg
              </p>
            </div>
          </div>

          {/* Properties panel */}
          <div className="w-72 border-l border-gray-200 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              {/* Layout Metadata */}
              <section>
                <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Layout Metadata
                </h3>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Size Code</label>
                    <input
                      value={sizeCode}
                      onChange={e => setSizeCode(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Width mm</label>
                      <input
                        type="number"
                        value={widthMm}
                        onChange={e => setWidthMm(Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Height mm</label>
                      <input
                        type="number"
                        value={heightMm}
                        onChange={e => setHeightMm(Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Orientation</label>
                    <select
                      value={orientation}
                      onChange={e => setOrientation(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      <option>Portrait</option>
                      <option>Landscape</option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Background Crop */}
              <section>
                <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Background Crop
                </h3>
                <p className="text-[10px] text-gray-400 mb-2">
                  Drag canvas to pan · scroll wheel to zoom
                </p>
                <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-12 flex-shrink-0">Scale</span>
                    <button
                      onClick={() => setBgCrop(c => ({ ...c, scale: Math.max(0.1, c.scale - 0.1) }))}
                      className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 font-bold flex items-center justify-center flex-shrink-0"
                    >−</button>
                    <input
                      type="range" min={0.1} max={5} step={0.05}
                      value={bgCrop.scale}
                      onChange={e => setBgCrop(c => ({ ...c, scale: Number(e.target.value) }))}
                      className="flex-1 accent-indigo-500"
                    />
                    <button
                      onClick={() => setBgCrop(c => ({ ...c, scale: Math.min(5, c.scale + 0.1) }))}
                      className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 font-bold flex items-center justify-center flex-shrink-0"
                    >+</button>
                    <input
                      type="number"
                      min={10} max={500} step={1}
                      value={Math.round(bgCrop.scale * 100)}
                      onChange={e => {
                        const pct = Number(e.target.value)
                        if (!isNaN(pct) && pct >= 10 && pct <= 500)
                          setBgCrop(c => ({ ...c, scale: pct / 100 }))
                      }}
                      className="w-14 px-1 py-0.5 border border-gray-300 rounded text-xs font-mono text-right flex-shrink-0"
                    />
                    <span className="text-gray-400 flex-shrink-0">%</span>
                  </div>
                  <div className="flex items-center justify-between text-gray-400 font-mono text-[10px]">
                    <span>x: {bgCrop.offsetX.toFixed(3)}</span>
                    <span>y: {bgCrop.offsetY.toFixed(3)}</span>
                    <button
                      onClick={() => setBgCrop(DEFAULT_BG_CROP)}
                      className="text-red-400 hover:text-red-600 text-[10px] ml-2"
                    >Reset</button>
                  </div>
                </div>
              </section>

              {/* Subject Slots */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Subject Slots
                    <span className="ml-1 bg-blue-100 text-blue-700 px-1 rounded text-[9px]">{slots.length}</span>
                  </h3>
                  <button onClick={() => addSlot()} className="text-xs text-blue-600 hover:underline">+ Add</button>
                </div>
                <p className="text-[10px] text-gray-400 mb-2">
                  Use ▣ / ⬭ / ⬡ toolbar buttons to draw rect, ellipse, or polygon slots.
                </p>
                <div className="space-y-2">
                  {slots.map((s, i) => (
                    <SlotRow
                      key={i}
                      slot={s}
                      index={i}
                      onChange={updated => setSlots(prev => prev.map((x, j) => j === i ? updated : x))}
                      onDelete={() => setSlots(prev => prev.filter((_, j) => j !== i))}
                    />
                  ))}
                  {slots.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-2">No slots — click + Add</p>
                  )}
                </div>
              </section>

              {/* Text Zones */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Text Zones
                    <span className="ml-1 bg-emerald-100 text-emerald-700 px-1 rounded text-[9px]">{textZones.length}</span>
                  </h3>
                  <button onClick={addTextZone} className="text-xs text-emerald-600 hover:underline">+ Add</button>
                </div>
                <p className="text-[10px] text-gray-400 mb-2">
                  Safe areas for title, subtitle and footer text layers.
                </p>
                <div className="space-y-2">
                  {textZones.map((z, i) => (
                    <TextZoneRow
                      key={i}
                      zone={z}
                      index={i}
                      onChange={updated => setTextZones(prev => prev.map((x, j) => j === i ? updated : x))}
                      onDelete={() => setTextZones(prev => prev.filter((_, j) => j !== i))}
                    />
                  ))}
                  {textZones.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-2">No text zones — click + Add</p>
                  )}
                </div>
              </section>

            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 flex-shrink-0">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="ml-auto flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Layout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
