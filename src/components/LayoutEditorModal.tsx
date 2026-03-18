import { useState } from 'react'
import type { BackgroundLayout, CropFrameRect, SlotRect, UpdateLayoutRequest } from '../types'
import RectCanvas from './RectCanvas'

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
        <span className="font-medium text-blue-800">Slot {index + 1}</span>
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
      <div className="grid grid-cols-2 gap-1 text-gray-500">
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

function CropRow({
  cf, index, onChange, onDelete,
}: {
  cf: CropFrameRect
  index: number
  onChange: (c: CropFrameRect) => void
  onDelete: () => void
}) {
  return (
    <div className="p-2.5 bg-orange-50 border border-orange-100 rounded-lg text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-orange-800">Crop Frame {index + 1}</span>
        <button onClick={onDelete} className="text-red-400 hover:text-red-600">✕</button>
      </div>
      <div>
        <label className="block text-gray-400 mb-0.5">ID</label>
        <input
          value={cf.id}
          onChange={e => onChange({ ...cf, id: e.target.value })}
          className="w-full px-1.5 py-0.5 border border-orange-200 rounded text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-1 text-gray-500">
        <span>x: {cf.x.toFixed(3)}</span>
        <span>y: {cf.y.toFixed(3)}</span>
        <span>w: {cf.w.toFixed(3)}</span>
        <span>h: {cf.h.toFixed(3)}</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <div>
          <label className="block text-gray-400 mb-0.5">Shape</label>
          <select
            value={cf.shape}
            onChange={e => onChange({ ...cf, shape: e.target.value })}
            className="w-full px-1 py-0.5 border border-orange-200 rounded text-xs"
          >
            {['rect', 'circle', 'oval'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-gray-400 mb-0.5">Aspect ratio</label>
          <input
            type="number"
            step="0.001"
            placeholder="free"
            value={cf.aspectRatio ?? ''}
            onChange={e => onChange({ ...cf, aspectRatio: e.target.value ? Number(e.target.value) : null })}
            className="w-full px-1 py-0.5 border border-orange-200 rounded text-xs"
          />
        </div>
      </div>
    </div>
  )
}

export default function LayoutEditorModal({ layout, backgroundImageUrl, onSave, onClose }: Props) {
  // Layout metadata
  const [sizeCode, setSizeCode]     = useState(layout.sizeCode)
  const [widthMm, setWidthMm]       = useState(layout.widthMm)
  const [heightMm, setHeightMm]     = useState(layout.heightMm)
  const [orientation, setOrientation] = useState(layout.orientation)
  const [textZonesJson, setTextZonesJson] = useState(layout.textZonesJson ?? '')

  // Rect state (edited visually in RectCanvas)
  const [slots, setSlots]           = useState<SlotRect[]>(parseRects(layout.subjectSlotsJson, []))
  const [cropFrames, setCropFrames] = useState<CropFrameRect[]>(parseRects(layout.subjectCropFramesJson, []))

  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

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
        subjectCropFramesJson: cropFrames.length > 0 ? JSON.stringify(cropFrames) : null,
        textZonesJson: textZonesJson.trim() || null,
      })
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  function addSlot() {
    setSlots(prev => [...prev, {
      id: `slot-${prev.length + 1}`,
      x: 0.25, y: 0.20, w: 0.50, h: 0.55,
      anchor: 'BottomCenter', fitMode: 'Contain',
      allowUserMove: true, allowUserScale: true,
      minScale: 0.8, maxScale: 1.4,
    }])
  }

  function addCropFrame() {
    setCropFrames(prev => [...prev, {
      id: `crop-${prev.length + 1}`,
      x: 0.15, y: 0.10, w: 0.70, h: 0.75,
      shape: 'rect', aspectRatio: null,
      allowUserMove: true, allowUserScale: true,
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
              drag rects to reposition · drag corners to resize
            </span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Body: canvas + properties panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Canvas area */}
          <div className="flex-1 bg-gray-50 p-6 overflow-auto flex items-start justify-center">
            <div className="w-full max-w-xs">
              <RectCanvas
                imageUrl={backgroundImageUrl}
                aspectRatio={aspectRatio}
                slots={slots}
                cropFrames={cropFrames}
                onSlotsChange={setSlots}
                onCropFramesChange={setCropFrames}
              />
              <p className="text-[10px] text-gray-400 text-center mt-2">
                Blue = placement slot · Orange = crop frame (normalised 0..1)
              </p>
            </div>
          </div>

          {/* Properties panel */}
          <div className="w-72 border-l border-gray-200 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              {/* Metadata */}
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

              {/* Subject Slots */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Subject Slots
                    <span className="ml-1 bg-blue-100 text-blue-700 px-1 rounded text-[9px]">{slots.length}</span>
                  </h3>
                  <button onClick={addSlot} className="text-xs text-blue-600 hover:underline">+ Add</button>
                </div>
                <div className="space-y-2">
                  {slots.map((s, i) => (
                    <SlotRow
                      key={s.id + i}
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

              {/* Crop Frames */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Crop Frames
                    <span className="ml-1 bg-orange-100 text-orange-700 px-1 rounded text-[9px]">{cropFrames.length}</span>
                  </h3>
                  <button onClick={addCropFrame} className="text-xs text-orange-600 hover:underline">+ Add</button>
                </div>
                <div className="space-y-2">
                  {cropFrames.map((cf, i) => (
                    <CropRow
                      key={cf.id + i}
                      cf={cf}
                      index={i}
                      onChange={updated => setCropFrames(prev => prev.map((x, j) => j === i ? updated : x))}
                      onDelete={() => setCropFrames(prev => prev.filter((_, j) => j !== i))}
                    />
                  ))}
                  {cropFrames.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-2">No crop frames — click + Add</p>
                  )}
                </div>
              </section>

              {/* Text zones JSON */}
              <section>
                <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Text Zones JSON
                </h3>
                <textarea
                  value={textZonesJson}
                  onChange={e => setTextZonesJson(e.target.value)}
                  rows={4}
                  placeholder="[]"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs font-mono resize-y"
                />
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
