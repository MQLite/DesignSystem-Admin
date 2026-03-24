import { useEffect, useRef, useState } from 'react'
import type { BgCrop, SlotRect, SlotShape, TextZoneRect } from '../types'

interface Props {
  imageUrl: string | null
  /** width / height ratio of the layout canvas. */
  aspectRatio: number
  slots: SlotRect[]
  textZones: TextZoneRect[]
  onSlotsChange: (s: SlotRect[]) => void
  onTextZonesChange: (t: TextZoneRect[]) => void
  /** Current draw mode from parent toolbar. */
  drawMode: 'select' | 'rect' | 'ellipse' | 'polygon'
  /** Called after a new shape is drawn so parent can switch back to 'select'. */
  onDrawComplete: () => void
  /** Background crop transform (scale + pan). Default: scale=1, centred. */
  bgCrop: BgCrop
  onBgCropChange: (crop: BgCrop) => void
}

type RectKind = 'slot' | 'text'
type ApplyHandle = 'body' | 'nw' | 'ne' | 'sw' | 'se' | `v${number}`

type RectDraft = { mode: 'rect' | 'ellipse'; nx0: number; ny0: number; nx1: number; ny1: number }
type PolyDraft = { mode: 'polygon'; pts: [number, number][]; previewNx: number; previewNy: number }
type Draft = RectDraft | PolyDraft | null

interface ActiveDrag {
  kind: RectKind
  id: string
  handle: ApplyHandle
  startNx: number
  startNy: number
  startRect: { x: number; y: number; w: number; h: number }
  startPts?: [number, number][]
}

const MIN = 0.02
const POLY_CLOSE_DIST = 0.028
const VERTEX_R = 6

const COLORS = {
  slot: { stroke: '#60a5fa', strokeSel: '#2563eb', fill: 'rgba(59,130,246,0.15)', fillSel: 'rgba(59,130,246,0.28)' },
  text: { stroke: '#34d399', strokeSel: '#059669', fill: 'rgba(52,211,153,0.15)', fillSel: 'rgba(52,211,153,0.28)' },
}

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function polyBounds(pts: [number, number][]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function dist2d(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export default function RectCanvas({
  imageUrl, aspectRatio, slots, textZones,
  onSlotsChange, onTextZonesChange,
  drawMode, onDrawComplete,
  bgCrop, onBgCropChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef       = useRef<SVGSVGElement>(null)
  const [size, setSize]       = useState({ w: 0, h: 0 })
  const [selected, setSelected] = useState<{ kind: RectKind; id: string } | null>(null)
  const [draft, setDraft]     = useState<Draft>(null)
  const draftRef   = useRef<Draft>(null)
  const dragRef    = useRef<ActiveDrag | null>(null)
  const bgCropRef  = useRef(bgCrop)
  bgCropRef.current = bgCrop

  // bg pan drag state
  const bgDragRef = useRef({ active: false, startX: 0, startY: 0, startOx: 0, startOy: 0, hasMoved: false })

  function updateDraft(d: Draft) {
    draftRef.current = d
    setDraft(d)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => ro.disconnect()
  }, [])

  // Scroll wheel → zoom background (select mode only)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (drawMode !== 'select') return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.08 : 0.08
      onBgCropChange({ ...bgCropRef.current, scale: Math.max(0.1, Math.min(10, bgCropRef.current.scale + delta)) })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [drawMode, onBgCropChange])

  // Discard any in-progress draft when switching draw mode
  useEffect(() => { updateDraft(null) }, [drawMode])

  function toNorm(e: { clientX: number; clientY: number }): [number, number] {
    const r = svgRef.current!.getBoundingClientRect()
    return [
      clamp((e.clientX - r.left) / r.width, 0, 1),
      clamp((e.clientY - r.top) / r.height, 0, 1),
    ]
  }

  // ── Patches ───────────────────────────────────────────────────────────────

  function patchSlot(id: string, patch: Partial<SlotRect>) {
    onSlotsChange(slots.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  function patchZone(id: string, patch: Partial<TextZoneRect>) {
    onTextZonesChange(textZones.map(t => t.id === id ? { ...t, ...patch } : t))
  }

  // ── Drag (select mode) ────────────────────────────────────────────────────

  function startDrag(kind: RectKind, id: string, handle: ApplyHandle, e: React.PointerEvent) {
    e.stopPropagation()
    if (drawMode !== 'select') return
    const [nx, ny] = toNorm(e)
    const r = kind === 'slot' ? slots.find(s => s.id === id) : textZones.find(t => t.id === id)
    if (!r) return
    setSelected({ kind, id })
    dragRef.current = {
      kind, id, handle, startNx: nx, startNy: ny,
      startRect: { x: r.x, y: r.y, w: r.w, h: r.h },
      startPts: kind === 'slot' && (r as SlotRect).points
        ? ([...(r as SlotRect).points!] as [number, number][])
        : undefined,
    }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  // ── Pointer move ──────────────────────────────────────────────────────────

  function handlePointerMove(e: React.PointerEvent) {
    // bg pan drag
    const bd = bgDragRef.current
    if (bd.active) {
      const rect = svgRef.current!.getBoundingClientRect()
      const dx = e.clientX - bd.startX
      const dy = e.clientY - bd.startY
      if (Math.hypot(dx, dy) > 3) bd.hasMoved = true
      onBgCropChange({
        ...bgCropRef.current,
        offsetX: bd.startOx + dx / rect.width,
        offsetY: bd.startOy + dy / rect.height,
      })
      return
    }

    const [nx, ny] = toNorm(e)

    // Rect/ellipse draw preview
    const d = draftRef.current
    if (d && (d.mode === 'rect' || d.mode === 'ellipse')) {
      updateDraft({ ...d, nx1: nx, ny1: ny })
      return
    }
    // Polygon preview cursor
    if (d && d.mode === 'polygon') {
      updateDraft({ ...d, previewNx: nx, previewNy: ny })
      return
    }

    // Existing shape drag
    const drag = dragRef.current
    if (!drag) return
    const { startNx, startNy, startRect: { x, y, w, h } } = drag
    const ddx = nx - startNx, ddy = ny - startNy

    if (drag.handle === 'body') {
      const slot = drag.kind === 'slot' ? slots.find(s => s.id === drag.id) : null
      if (slot?.shape === 'polygon' && drag.startPts) {
        const newPts = drag.startPts.map(([px, py]) => [
          clamp(px + ddx, 0, 1), clamp(py + ddy, 0, 1),
        ] as [number, number])
        patchSlot(drag.id, { points: newPts, ...polyBounds(newPts) })
      } else if (drag.kind === 'slot') {
        patchSlot(drag.id, { x: clamp(x + ddx, 0, 1 - w), y: clamp(y + ddy, 0, 1 - h) })
      } else {
        patchZone(drag.id, { x: clamp(x + ddx, 0, 1 - w), y: clamp(y + ddy, 0, 1 - h) })
      }
    } else if (drag.handle.startsWith('v')) {
      const vi = Number(drag.handle.slice(1))
      if (!drag.startPts) return
      const newPts = drag.startPts.map((p, i) =>
        i === vi ? [clamp(p[0] + ddx, 0, 1), clamp(p[1] + ddy, 0, 1)] as [number, number] : p
      )
      patchSlot(drag.id, { points: newPts, ...polyBounds(newPts) })
    } else {
      // Corner resize
      let rx = x, ry = y, rw = w, rh = h
      if (drag.handle === 'nw') { rw = Math.max(MIN, w - ddx); rh = Math.max(MIN, h - ddy); rx = x + w - rw; ry = y + h - rh }
      else if (drag.handle === 'ne') { rw = Math.max(MIN, w + ddx); rh = Math.max(MIN, h - ddy); ry = y + h - rh }
      else if (drag.handle === 'sw') { rw = Math.max(MIN, w - ddx); rh = Math.max(MIN, h + ddy); rx = x + w - rw }
      else if (drag.handle === 'se') { rw = Math.max(MIN, w + ddx); rh = Math.max(MIN, h + ddy) }
      rx = Math.max(0, rx); ry = Math.max(0, ry)
      rw = Math.min(1 - rx, rw); rh = Math.min(1 - ry, rh)
      if (drag.kind === 'slot') patchSlot(drag.id, { x: rx, y: ry, w: rw, h: rh })
      else patchZone(drag.id, { x: rx, y: ry, w: rw, h: rh })
    }
  }

  // ── Pointer up ────────────────────────────────────────────────────────────

  function handlePointerUp(_e: React.PointerEvent) {
    // End bg drag; if no movement treat as click-to-deselect
    const bd = bgDragRef.current
    if (bd.active) {
      if (!bd.hasMoved) setSelected(null)
      bd.active = false
    }

    const d = draftRef.current
    if (d && (d.mode === 'rect' || d.mode === 'ellipse')) {
      const x0 = Math.min(d.nx0, d.nx1), x1 = Math.max(d.nx0, d.nx1)
      const y0 = Math.min(d.ny0, d.ny1), y1 = Math.max(d.ny0, d.ny1)
      const w = x1 - x0, h = y1 - y0
      if (w >= MIN && h >= MIN) {
        const newSlot: SlotRect = {
          id: `slot-${slots.length + 1}`,
          shape: d.mode as SlotShape,
          x: x0, y: y0, w, h,
          anchor: 'Center', fitMode: 'Contain',
          allowUserMove: true, allowUserScale: true,
          minScale: 0.8, maxScale: 1.4,
        }
        onSlotsChange([...slots, newSlot])
        setSelected({ kind: 'slot', id: newSlot.id })
        onDrawComplete()
      }
      updateDraft(null)
    }
    dragRef.current = null
  }

  // ── SVG pointer down — start draw, bg pan, or deselect ───────────────────

  function handleSvgPointerDown(e: React.PointerEvent) {
    if (drawMode === 'select') {
      if (e.target === svgRef.current) {
        // Start bg pan drag; deselect only if no meaningful drag occurs
        bgDragRef.current = {
          active: true,
          startX: e.clientX, startY: e.clientY,
          startOx: bgCropRef.current.offsetX,
          startOy: bgCropRef.current.offsetY,
          hasMoved: false,
        }
        svgRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }
    if (drawMode === 'polygon') return // polygon handled via onClick
    const [nx, ny] = toNorm(e)
    updateDraft({ mode: drawMode as 'rect' | 'ellipse', nx0: nx, ny0: ny, nx1: nx, ny1: ny })
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  // ── Polygon click / dblclick ──────────────────────────────────────────────

  function handleSvgClick(e: React.MouseEvent) {
    if (drawMode !== 'polygon') return
    if (e.detail >= 2) return // let dblclick handle close

    const [nx, ny] = toNorm(e)
    const d = draftRef.current as PolyDraft | null

    if (!d || d.mode !== 'polygon') {
      updateDraft({ mode: 'polygon', pts: [[nx, ny]], previewNx: nx, previewNy: ny })
      return
    }
    if (d.pts.length >= 3 && dist2d([nx, ny], d.pts[0]) < POLY_CLOSE_DIST) {
      finishPolygon(d.pts)
      return
    }
    updateDraft({ ...d, pts: [...d.pts, [nx, ny]] })
  }

  function handleSvgDblClick(_e: React.MouseEvent) {
    if (drawMode !== 'polygon') return
    const d = draftRef.current as PolyDraft | null
    if (!d || d.pts.length < 3) return
    finishPolygon(d.pts)
  }

  function finishPolygon(pts: [number, number][]) {
    const bounds = polyBounds(pts)
    const newSlot: SlotRect = {
      id: `slot-${slots.length + 1}`,
      shape: 'polygon',
      points: pts,
      ...bounds,
      anchor: 'Center', fitMode: 'Contain',
      allowUserMove: true, allowUserScale: true,
      minScale: 0.8, maxScale: 1.4,
    }
    onSlotsChange([...slots, newSlot])
    setSelected({ kind: 'slot', id: newSlot.id })
    updateDraft(null)
    onDrawComplete()
  }

  // ── Rendering helpers ─────────────────────────────────────────────────────

  const interactive = drawMode === 'select'
  const CORNER_HANDLES: [ApplyHandle, (s: SlotRect | TextZoneRect) => number, (s: SlotRect | TextZoneRect) => number][] = [
    ['nw', s => s.x,       s => s.y],
    ['ne', s => s.x + s.w, s => s.y],
    ['sw', s => s.x,       s => s.y + s.h],
    ['se', s => s.x + s.w, s => s.y + s.h],
  ]

  function renderSlot(slot: SlotRect) {
    if (size.w === 0) return null
    const isSel = selected?.kind === 'slot' && selected?.id === slot.id
    const c = COLORS.slot
    const stroke = isSel ? c.strokeSel : c.stroke
    const fill   = isSel ? c.fillSel   : c.fill
    const shape  = slot.shape ?? 'rect'
    const ptrStyle = { pointerEvents: (interactive ? 'auto' : 'none') as React.CSSProperties['pointerEvents'] }

    let shapeEl: React.ReactNode
    if (shape === 'ellipse') {
      const cx = (slot.x + slot.w / 2) * size.w
      const cy = (slot.y + slot.h / 2) * size.h
      shapeEl = (
        <ellipse
          cx={cx} cy={cy}
          rx={slot.w / 2 * size.w} ry={slot.h / 2 * size.h}
          fill={fill} stroke={stroke} strokeWidth={2}
          style={{ ...ptrStyle, cursor: interactive ? 'move' : 'default' }}
          onPointerDown={e => startDrag('slot', slot.id, 'body', e)}
        />
      )
    } else if (shape === 'polygon' && slot.points) {
      const pts = slot.points.map(([px, py]) => `${px * size.w},${py * size.h}`).join(' ')
      shapeEl = (
        <polygon
          points={pts}
          fill={fill} stroke={stroke} strokeWidth={2}
          style={{ ...ptrStyle, cursor: interactive ? 'move' : 'default' }}
          onPointerDown={e => startDrag('slot', slot.id, 'body', e)}
        />
      )
    } else {
      shapeEl = (
        <rect
          x={slot.x * size.w} y={slot.y * size.h}
          width={slot.w * size.w} height={slot.h * size.h}
          fill={fill} stroke={stroke} strokeWidth={2}
          style={{ ...ptrStyle, cursor: interactive ? 'move' : 'default' }}
          onPointerDown={e => startDrag('slot', slot.id, 'body', e)}
        />
      )
    }

    const labelIcon = shape === 'ellipse' ? '⬭' : shape === 'polygon' ? '⬡' : '▣'

    return (
      <g
        key={`slot-${slot.id}`}
        onClick={e => { e.stopPropagation(); if (interactive) setSelected({ kind: 'slot', id: slot.id }) }}
      >
        {shapeEl}
        <text
          x={slot.x * size.w + 4} y={slot.y * size.h + 14}
          fontSize={10} fontWeight={600} fill={stroke}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {labelIcon} {slot.id}
        </text>

        {/* Corner resize handles for rect/ellipse */}
        {interactive && isSel && shape !== 'polygon' && CORNER_HANDLES.map(([h, hx, hy]) => (
          <rect
            key={h}
            x={hx(slot) * size.w - 5} y={hy(slot) * size.h - 5}
            width={10} height={10}
            fill="#fff" stroke={stroke} strokeWidth={2} rx={2}
            style={{ cursor: `${h}-resize` }}
            onPointerDown={e => startDrag('slot', slot.id, h, e)}
          />
        ))}

        {/* Vertex handles for polygon */}
        {interactive && isSel && shape === 'polygon' && slot.points?.map((p, vi) => (
          <circle
            key={`v${vi}`}
            cx={p[0] * size.w} cy={p[1] * size.h}
            r={VERTEX_R}
            fill="#fff" stroke={stroke} strokeWidth={2}
            style={{ cursor: 'crosshair' }}
            onPointerDown={e => startDrag('slot', slot.id, `v${vi}` as ApplyHandle, e)}
          />
        ))}
      </g>
    )
  }

  function renderTextZone(zone: TextZoneRect) {
    if (size.w === 0) return null
    const isSel = selected?.kind === 'text' && selected?.id === zone.id
    const c = COLORS.text
    const stroke = isSel ? c.strokeSel : c.stroke
    const fill   = isSel ? c.fillSel   : c.fill
    const ptrStyle = { pointerEvents: (interactive ? 'auto' : 'none') as React.CSSProperties['pointerEvents'] }

    return (
      <g
        key={`text-${zone.id}`}
        onClick={e => { e.stopPropagation(); if (interactive) setSelected({ kind: 'text', id: zone.id }) }}
      >
        <rect
          x={zone.x * size.w} y={zone.y * size.h}
          width={zone.w * size.w} height={zone.h * size.h}
          fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray="5,3"
          style={{ ...ptrStyle, cursor: interactive ? 'move' : 'default' }}
          onPointerDown={e => startDrag('text', zone.id, 'body', e)}
        />
        <text
          x={zone.x * size.w + 4} y={zone.y * size.h + 14}
          fontSize={10} fontWeight={600} fill={stroke}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          T {zone.id}
        </text>
        {interactive && isSel && CORNER_HANDLES.map(([h, hx, hy]) => (
          <rect
            key={h}
            x={hx(zone) * size.w - 5} y={hy(zone) * size.h - 5}
            width={10} height={10}
            fill="#fff" stroke={stroke} strokeWidth={2} rx={2}
            style={{ cursor: `${h}-resize` }}
            onPointerDown={e => startDrag('text', zone.id, h, e)}
          />
        ))}
      </g>
    )
  }

  function renderDraft() {
    if (!draft || size.w === 0) return null

    if (draft.mode === 'rect' || draft.mode === 'ellipse') {
      const x0 = Math.min(draft.nx0, draft.nx1) * size.w
      const y0 = Math.min(draft.ny0, draft.ny1) * size.h
      const w  = Math.abs(draft.nx1 - draft.nx0) * size.w
      const h  = Math.abs(draft.ny1 - draft.ny0) * size.h
      if (draft.mode === 'ellipse') {
        return <ellipse cx={x0 + w / 2} cy={y0 + h / 2} rx={w / 2} ry={h / 2}
          fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth={2} strokeDasharray="6,3"
          style={{ pointerEvents: 'none' }} />
      }
      return <rect x={x0} y={y0} width={w} height={h}
        fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth={2} strokeDasharray="6,3"
        style={{ pointerEvents: 'none' }} />
    }

    if (draft.mode === 'polygon') {
      const { pts, previewNx, previewNy } = draft
      const allPts = [...pts, [previewNx, previewNy] as [number, number]]
      const polyStr = allPts.map(([px, py]) => `${px * size.w},${py * size.h}`).join(' ')
      const nearClose = pts.length >= 3 && dist2d([previewNx, previewNy], pts[0]) < POLY_CLOSE_DIST

      return (
        <g style={{ pointerEvents: 'none' }}>
          {pts.length >= 1 && (
            <polyline
              points={polyStr}
              fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth={2} strokeDasharray="6,3"
            />
          )}
          {pts.map(([px, py], i) => (
            <circle
              key={i}
              cx={px * size.w} cy={py * size.h}
              r={i === 0 ? (nearClose ? 9 : 5) : 4}
              fill={i === 0 && nearClose ? '#6366f1' : '#fff'}
              stroke="#6366f1" strokeWidth={2}
            />
          ))}
        </g>
      )
    }

    return null
  }

  const svgCursor = drawMode === 'select' ? 'default' : 'crosshair'

  const bgImgTransform = size.w > 0
    ? `translate(-50%, -50%) translate(${bgCrop.offsetX * size.w}px, ${bgCrop.offsetY * size.h}px) scale(${bgCrop.scale})`
    : undefined

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded-lg select-none bg-gray-100"
      style={{ aspectRatio: String(aspectRatio), position: 'relative', boxShadow: '0 0 0 2px #cbd5e1, 0 4px 24px 0 rgba(0,0,0,0.18)' }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{
            position: 'absolute', top: '50%', left: '50%',
            minWidth: '100%', minHeight: '100%',
            width: 'auto', height: 'auto', maxWidth: 'none',
            transform: bgImgTransform,
            transformOrigin: 'center center',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-gray-300 text-xs">
          No image uploaded
        </div>
      )}

      <svg
        ref={svgRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: svgCursor, overflow: 'visible' }}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleSvgClick}
        onDoubleClick={handleSvgDblClick}
      >
        {textZones.map(renderTextZone)}
        {slots.map(renderSlot)}
        {renderDraft()}
      </svg>

      {/* Legend */}
      <div style={{ position: 'absolute', bottom: 6, right: 6, display: 'flex', gap: 6, pointerEvents: 'none' }}>
        <span style={{ fontSize: 10, background: 'rgba(59,130,246,0.85)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>
          ▣ Slot
        </span>
        <span style={{ fontSize: 10, background: 'rgba(5,150,105,0.85)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>
          T Text Zone
        </span>
      </div>
    </div>
  )
}
