import { useCallback, useEffect, useRef, useState } from 'react'
import type { CropFrameRect, SlotRect } from '../types'

interface Props {
  imageUrl: string | null
  /** width / height ratio of the layout canvas (e.g. 297/420 for A3 portrait). */
  aspectRatio: number
  slots: SlotRect[]
  cropFrames: CropFrameRect[]
  onSlotsChange: (s: SlotRect[]) => void
  onCropFramesChange: (c: CropFrameRect[]) => void
}

type RectKind = 'slot' | 'crop'
type Handle = 'body' | 'nw' | 'ne' | 'sw' | 'se'

interface Interaction {
  kind: RectKind
  id: string
  handle: Handle
  startMouseX: number
  startMouseY: number
  startRect: { x: number; y: number; w: number; h: number }
}

const MIN = 0.04 // minimum rect size in normalised units

export default function RectCanvas({
  imageUrl, aspectRatio, slots, cropFrames, onSlotsChange, onCropFramesChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [selected, setSelected] = useState<{ kind: RectKind; id: string } | null>(null)
  const iaRef = useRef<Interaction | null>(null)

  // Observe container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => ro.disconnect()
  }, [])

  const getRect = useCallback((kind: RectKind, id: string) => {
    if (kind === 'slot') return slots.find(s => s.id === id) ?? null
    return cropFrames.find(c => c.id === id) ?? null
  }, [slots, cropFrames])

  const patchRect = useCallback((kind: RectKind, id: string, patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
    if (kind === 'slot') {
      onSlotsChange(slots.map(s => s.id === id ? { ...s, ...patch } : s))
    } else {
      onCropFramesChange(cropFrames.map(c => c.id === id ? { ...c, ...patch } : c))
    }
  }, [slots, cropFrames, onSlotsChange, onCropFramesChange])

  function startInteraction(kind: RectKind, id: string, handle: Handle, e: React.PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    const r = getRect(kind, id)
    if (!r) return
    setSelected({ kind, id })
    iaRef.current = {
      kind, id, handle,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startRect: { x: r.x, y: r.y, w: r.w, h: r.h },
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    const ia = iaRef.current
    if (!ia || size.w === 0) return

    const dx = (e.clientX - ia.startMouseX) / size.w
    const dy = (e.clientY - ia.startMouseY) / size.h
    const { x, y, w, h } = ia.startRect

    let nx = x, ny = y, nw = w, nh = h

    if (ia.handle === 'body') {
      nx = clamp(x + dx, 0, 1 - w)
      ny = clamp(y + dy, 0, 1 - h)
    } else {
      if (ia.handle === 'nw') {
        nw = Math.max(MIN, w - dx); nh = Math.max(MIN, h - dy)
        nx = x + w - nw;           ny = y + h - nh
      } else if (ia.handle === 'ne') {
        nw = Math.max(MIN, w + dx); nh = Math.max(MIN, h - dy)
        ny = y + h - nh
      } else if (ia.handle === 'sw') {
        nw = Math.max(MIN, w - dx); nh = Math.max(MIN, h + dy)
        nx = x + w - nw
      } else if (ia.handle === 'se') {
        nw = Math.max(MIN, w + dx); nh = Math.max(MIN, h + dy)
      }
      nx = Math.max(0, nx); ny = Math.max(0, ny)
      nw = Math.min(1 - nx, nw);  nh = Math.min(1 - ny, nh)
    }

    patchRect(ia.kind, ia.id, { x: nx, y: ny, w: nw, h: nh })
  }

  function renderRect(r: { id: string; x: number; y: number; w: number; h: number }, kind: RectKind) {
    const isSel = selected?.kind === kind && selected?.id === r.id
    const isSlot = kind === 'slot'

    const left   = r.x * size.w
    const top    = r.y * size.h
    const width  = r.w * size.w
    const height = r.h * size.h

    const borderColor = isSlot
      ? (isSel ? '#2563eb' : '#60a5fa')
      : (isSel ? '#ea580c' : '#fb923c')
    const bgColor = isSlot
      ? (isSel ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.12)')
      : (isSel ? 'rgba(249,115,22,0.25)' : 'rgba(249,115,22,0.12)')

    const handles: Handle[] = ['nw', 'ne', 'sw', 'se']

    return (
      <div
        key={`${kind}-${r.id}`}
        style={{
          position: 'absolute', left, top, width, height,
          border: `2px solid ${borderColor}`,
          background: bgColor,
          cursor: 'move',
          boxSizing: 'border-box',
        }}
        onPointerDown={e => startInteraction(kind, r.id, 'body', e)}
      >
        {/* Label */}
        <span style={{
          position: 'absolute', top: 3, left: 3,
          fontSize: 10, fontWeight: 600, lineHeight: 1,
          padding: '1px 4px', borderRadius: 3,
          background: borderColor, color: '#fff',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {isSlot ? '⬛' : '✂️'} {r.id}
        </span>

        {/* Resize corner handles */}
        {handles.map(handle => (
          <div
            key={handle}
            style={{
              position: 'absolute',
              width: 10, height: 10,
              background: '#fff',
              border: `2px solid ${borderColor}`,
              borderRadius: 2,
              cursor: `${handle}-resize`,
              zIndex: 10,
              ...(handle.includes('n') ? { top: -5 } : { bottom: -5 }),
              ...(handle.includes('w') ? { left: -5 } : { right: -5 }),
            }}
            onPointerDown={e => startInteraction(kind, r.id, handle, e)}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ aspectRatio: String(aspectRatio), position: 'relative' }}
      className="w-full overflow-hidden rounded-lg border border-gray-300 bg-gray-100 select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={() => { iaRef.current = null }}
      onPointerLeave={() => { iaRef.current = null }}
      onClick={e => { if (e.target === containerRef.current) setSelected(null) }}
    >
      {/* Background image */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-xs">
          No image uploaded
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 6, right: 6,
        display: 'flex', gap: 6, pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 10, background: 'rgba(59,130,246,0.8)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>
          ⬛ Slot
        </span>
        <span style={{ fontSize: 10, background: 'rgba(249,115,22,0.8)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>
          ✂️ Crop
        </span>
      </div>

      {/* Crop frames (lower z-order) */}
      {cropFrames.map(cf => renderRect(cf, 'crop'))}

      {/* Slots (higher z-order) */}
      {slots.map(s => renderRect(s, 'slot'))}
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
