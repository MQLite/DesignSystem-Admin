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
  /** When set, the canvas is in "draw arc circle" mode for this zone id. */
  arcDrawZoneId?: string | null
  /** Called when the arc draw interaction finishes (committed or cancelled). */
  onArcDrawComplete?: () => void
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

/** Arc ellipse drag: cx/cy in SVG-relative pixels, rx/ry in pixels */
interface ArcDraft { cx: number; cy: number; rx: number; ry: number }

export default function RectCanvas({
  imageUrl, aspectRatio, slots, textZones,
  onSlotsChange, onTextZonesChange,
  drawMode, onDrawComplete,
  bgCrop, onBgCropChange,
  arcDrawZoneId = null,
  onArcDrawComplete = () => {},
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

  // Arc circle draw state
  // arcDraft   = circle being actively dragged (live preview)
  // arcPending = circle drawn but awaiting user confirm/cancel
  const [arcDraft,   setArcDraft]   = useState<ArcDraft | null>(null)
  const [arcPending, setArcPending] = useState<ArcDraft | null>(null)
  const arcDraftRef = useRef<ArcDraft | null>(null)
  function updateArcDraft(d: ArcDraft | null) { arcDraftRef.current = d; setArcDraft(d) }

  function cancelArcDraw() {
    updateArcDraft(null)
    setArcPending(null)
    onArcDrawComplete()
  }

  // Cancel arc draw on ESC or when arcDrawZoneId clears
  useEffect(() => {
    if (!arcDrawZoneId) { updateArcDraft(null); setArcPending(null); return }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelArcDraw() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [arcDrawZoneId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Arc circle draw helpers ───────────────────────────────────────────────

  function svgXY(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function commitArcDraw(draft: ArcDraft) {
    const zone = textZones.find(z => z.id === arcDrawZoneId)
    if (zone) {
      const zoneCy = (zone.y + zone.h / 2) * size.h
      const arcDirection: 'up' | 'down' = draft.cy < zoneCy ? 'up' : 'down'
      const h = Math.max(1, size.h)
      const arcRx = Math.max(0.05, draft.rx / h)
      const arcRy = Math.max(0.05, draft.ry / h)
      patchZone(arcDrawZoneId!, { arcRx, arcRy, arcDirection })
    }
    updateArcDraft(null)
    setArcPending(null)
    onArcDrawComplete()
  }

  // ── Pointer move ──────────────────────────────────────────────────────────

  function handlePointerMove(e: React.PointerEvent) {
    // Arc circle draw
    if (arcDrawZoneId) {
      const ad = arcDraftRef.current
      if (ad) {
        const { x, y } = svgXY(e)
        updateArcDraft({ ...ad, rx: Math.abs(x - ad.cx), ry: Math.abs(y - ad.cy) })
      }
      return
    }

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

  function handlePointerUp(e: React.PointerEvent) {
    // Arc ellipse: finish drawing → move to pending (waiting for confirm)
    if (arcDrawZoneId) {
      const ad = arcDraftRef.current
      if (ad && (ad.rx >= 8 || ad.ry >= 8)) {
        setArcPending(ad)
        updateArcDraft(null)
      } else {
        updateArcDraft(null) // too small, discard
      }
      return
    }
    return _handlePointerUp(e)
  }
  function _handlePointerUp(_e: React.PointerEvent) {
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
    // Arc circle: start drag from click point as center
    if (arcDrawZoneId) {
      const { x, y } = svgXY(e)
      updateArcDraft({ cx: x, cy: y, rx: 0, ry: 0 })
      svgRef.current?.setPointerCapture(e.pointerId)
      return
    }
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

  function buildArcPath(zone: TextZoneRect, sw: number, sh: number): string {
    const zx    = zone.x * sw, zy = zone.y * sh
    const zw    = zone.w * sw, zh = zone.h * sh
    const cx    = zx + zw / 2, cy = zy + zh / 2
    const halfW = zw / 2
    const Rx    = Math.max(halfW + 1, (zone.arcRx ?? 0.7) * sh)
    const Ry    = Math.max(1,         (zone.arcRy ?? 0.5) * sh)
    const ratio = Math.min(1, halfW / Rx)
    const yOff  = Ry * (1 - Math.sqrt(1 - ratio * ratio))
    const isUp  = (zone.arcDirection ?? 'up') === 'up'
    const sx = cx - halfW, ex = cx + halfW
    const sy = isUp ? cy + yOff : cy - yOff
    const sweep = isUp ? 0 : 1
    return `M ${sx.toFixed(1)},${sy.toFixed(1)} A ${Rx.toFixed(1)},${Ry.toFixed(1)} 0 0 ${sweep} ${ex.toFixed(1)},${sy.toFixed(1)}`
  }

  function renderTextZone(zone: TextZoneRect) {
    if (size.w === 0) return null
    const isSel = selected?.kind === 'text' && selected?.id === zone.id
    const c = COLORS.text
    const borderStroke = isSel ? c.strokeSel : c.stroke
    const fill         = isSel ? c.fillSel   : c.fill
    const ptrStyle = { pointerEvents: (interactive ? 'auto' : 'none') as React.CSSProperties['pointerEvents'] }

    const zx = zone.x * size.w
    const zy = zone.y * size.h
    const zw = zone.w * size.w
    const zh = zone.h * size.h

    // Resolve typography
    const fontFamily     = zone.fontFamily  ?? 'Arial'
    const fontSizePct    = zone.fontSize    ?? 50
    const textColor      = zone.color       ?? '#ffffff'
    const strokeWidthPct = zone.strokeWidth ?? 0
    const strokeClr      = zone.strokeColor ?? '#000000'
    const align          = zone.align       ?? 'center'

    const fontPx     = Math.max(8, zh * fontSizePct / 100)
    const strokePx   = strokeWidthPct > 0 ? Math.max(0.5, fontPx * strokeWidthPct / 100) : 0
    const fontWeight = zone.id === 'title' ? 'bold' : 'normal'

    const displayText   = zone.defaultText ?? ''
    const isPlaceholder = !displayText
    const label         = displayText || zone.id

    const sharedTextAttrs = {
      fontFamily, fontWeight,
      fontSize: fontPx,
      style: { pointerEvents: 'none' as const, userSelect: 'none' as const },
      opacity: isPlaceholder ? 0.4 : 1,
    }

    // ── Compute text bounding box (tight, based on font metrics) ─────────────
    //
    // For straight text: text is centred vertically at zone-centre y.
    //   dominant-baseline="middle" places the em-box centre at textY.
    //   Approximate: ascent ≈ 0.75·fontPx above middle, descent ≈ 0.25·fontPx below.
    //
    // For arc text: baseline lies ON the arc path.
    //   Arc y ranges from the arc apex (cy, zone centre) to the endpoints (arcSy).
    //   Ascenders project 0.75·fontPx above the baseline; descenders 0.25·fontPx below.

    const cx = zx + zw / 2, cy = zy + zh / 2

    let tbx: number, tby: number, tbw: number, tbh: number

    if (zone.arcEnabled && arcDrawZoneId !== zone.id) {
      // Arc text bounding box
      const halfW = zw / 2
      const Rx    = Math.max(halfW + 1, (zone.arcRx ?? 0.7) * size.h)
      const Ry    = Math.max(1,          (zone.arcRy ?? 0.5) * size.h)
      const ratio = Math.min(1, halfW / Rx)
      const yOff  = Ry * (1 - Math.sqrt(1 - ratio * ratio))
      const isUp  = (zone.arcDirection ?? 'up') === 'up'
      const arcSy = isUp ? cy + yOff : cy - yOff

      // Apex (tightest point of arc) is at y = cy; endpoints at y = arcSy.
      // For 'up': apex above endpoints (cy < arcSy in screen coords).
      // For 'down': endpoints above apex (arcSy < cy).
      const apexY     = cy      // y of arc apex in both cases (it's always zone cy)
      const endpointY = arcSy

      const topBaseline    = Math.min(apexY, endpointY)
      const bottomBaseline = Math.max(apexY, endpointY)

      tbx = zx
      tbw = zw
      tby = topBaseline    - fontPx * 0.75
      tbh = (bottomBaseline + fontPx * 0.25) - tby
    } else {
      // Straight text bounding box
      const textY = cy  // dominant-baseline="middle" → em-box centre at zone cy
      tbx = zx
      tbw = zw
      tby = textY - fontPx * 0.5
      tbh = fontPx
    }

    // ── Shared rendering helpers ──────────────────────────────────────────────

    // Transparent full-zone rect — provides the drag target area (larger than text bbox)
    const zoneDragRect = (
      <rect
        x={zx} y={zy} width={zw} height={zh}
        fill="transparent" stroke="none"
        style={{ ...ptrStyle, cursor: interactive ? 'move' : 'default' }}
        onPointerDown={e => startDrag('text', zone.id, 'body', e)}
      />
    )

    // Tight text bounding box — the visible dashed outline
    const textBboxRect = (
      <rect
        x={tbx} y={tby} width={tbw} height={Math.max(4, tbh)}
        fill={fill} stroke={borderStroke} strokeWidth={2} strokeDasharray="5,3"
        style={{ pointerEvents: 'none' }}
      />
    )

    // Corner handles always at ZONE corners (resizing the zone = resizing font proportionally)
    const cornerHandles = interactive && isSel && CORNER_HANDLES.map(([h, hx, hy]) => (
      <rect key={h}
        x={hx(zone) * size.w - 5} y={hy(zone) * size.h - 5}
        width={10} height={10}
        fill="#fff" stroke={borderStroke} strokeWidth={2} rx={2}
        style={{ cursor: `${h}-resize` }}
        onPointerDown={e => startDrag('text', zone.id, h, e)}
      />
    ))

    // ── Arc text variant ──────────────────────────────────────────────────────
    if (zone.arcEnabled && arcDrawZoneId !== zone.id) {
      const arcPathId = `arcpath-tz-${zone.id}`
      const arcD      = buildArcPath(zone, size.w, size.h)

      const arcTextContent = (offsetX = 0, offsetY = 0, extraFill?: string) => (
        <text
          {...sharedTextAttrs}
          textAnchor="middle"
          fill={extraFill ?? textColor}
          {...(strokePx > 0 && !extraFill ? { stroke: strokeClr, strokeWidth: strokePx, paintOrder: 'stroke' } : {})}
          transform={offsetX || offsetY ? `translate(${offsetX},${offsetY})` : undefined}
        >
          <textPath href={`#${arcPathId}`} startOffset="50%">{label}</textPath>
        </text>
      )

      // Ellipse guide (selected only)
      const arcEllipseGuide = isSel && (() => {
        const Rx = Math.max(zw / 2 + 1, (zone.arcRx ?? 0.7) * size.h)
        const Ry = Math.max(1,           (zone.arcRy ?? 0.5) * size.h)
        const arcUp = (zone.arcDirection ?? 'up') === 'up'
        return (
          <ellipse cx={cx} cy={arcUp ? cy + Ry : cy - Ry} rx={Rx} ry={Ry}
            fill="none" stroke={borderStroke} strokeWidth={1.5}
            strokeDasharray="6,4" opacity={0.35}
            style={{ pointerEvents: 'none' }} />
        )
      })()

      return (
        <g
          key={`text-${zone.id}`}
          onClick={e => { e.stopPropagation(); if (interactive) setSelected({ kind: 'text', id: zone.id }) }}
        >
          {zoneDragRect}
          {textBboxRect}
          <defs><path id={arcPathId} d={arcD} /></defs>
          {strokePx > 0
            ? arcTextContent()
            : <>{arcTextContent(1, 1, 'rgba(0,0,0,0.65)')}{arcTextContent()}</>
          }
          {arcEllipseGuide}
          <text x={tbx + 4} y={tby + 11} fontSize={9} fontWeight={600} fill={borderStroke}
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            ⌢ {zone.id}
          </text>
          {cornerHandles}
        </g>
      )
    }

    // ── Straight text variant ─────────────────────────────────────────────────
    const textAnchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
    const textX = align === 'left' ? zx + 4 : align === 'right' ? zx + zw - 4 : cx
    const textY = cy

    return (
      <g
        key={`text-${zone.id}`}
        onClick={e => { e.stopPropagation(); if (interactive) setSelected({ kind: 'text', id: zone.id }) }}
      >
        {zoneDragRect}
        {textBboxRect}

        {strokePx > 0 ? (
          <text x={textX} y={textY} {...sharedTextAttrs}
            textAnchor={textAnchor} dominantBaseline="middle"
            fill={textColor} stroke={strokeClr} strokeWidth={strokePx} paintOrder="stroke">
            {label}
          </text>
        ) : (
          <>
            <text x={textX + 1} y={textY + 1} {...sharedTextAttrs}
              textAnchor={textAnchor} dominantBaseline="middle"
              fill="rgba(0,0,0,0.65)">
              {label}
            </text>
            <text x={textX} y={textY} {...sharedTextAttrs}
              textAnchor={textAnchor} dominantBaseline="middle"
              fill={textColor}>
              {label}
            </text>
          </>
        )}

        <text x={tbx + 4} y={tby + 11} fontSize={9} fontWeight={600} fill={borderStroke}
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          T {zone.id}
        </text>
        {cornerHandles}
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

  const svgCursor = arcDrawZoneId ? 'crosshair' : drawMode === 'select' ? 'default' : 'crosshair'

  const bgImgTransform =
    `translate(${bgCrop.offsetX * 100}%, ${bgCrop.offsetY * 100}%) scale(${bgCrop.scale})`

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
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'contain',
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

      {/* Dim overlay while in arc draw mode */}
      {arcDrawZoneId && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.52)',
          borderRadius: 8,
          pointerEvents: 'none',
          zIndex: 1,
        }} />
      )}

      <svg
        ref={svgRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: svgCursor, overflow: 'visible', zIndex: 2 }}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleSvgClick}
        onDoubleClick={handleSvgDblClick}
      >
        {textZones.map(renderTextZone)}
        {slots.map(renderSlot)}
        {!arcDrawZoneId && renderDraft()}

        {/* Arc live drag preview */}
        {arcDrawZoneId && arcDraft && (arcDraft.rx > 2 || arcDraft.ry > 2) && (
          <g style={{ pointerEvents: 'none' }}>
            <ellipse
              cx={arcDraft.cx} cy={arcDraft.cy} rx={Math.max(1, arcDraft.rx)} ry={Math.max(1, arcDraft.ry)}
              fill="rgba(16,185,129,0.12)"
              stroke="#10b981" strokeWidth={2} strokeDasharray="7,4"
            />
            <line x1={arcDraft.cx - 7} y1={arcDraft.cy} x2={arcDraft.cx + 7} y2={arcDraft.cy}
              stroke="#10b981" strokeWidth={1.5} />
            <line x1={arcDraft.cx} y1={arcDraft.cy - 7} x2={arcDraft.cx} y2={arcDraft.cy + 7}
              stroke="#10b981" strokeWidth={1.5} />
            <text x={arcDraft.cx + Math.max(1, arcDraft.rx) + 6} y={arcDraft.cy + 4}
              fontSize={10} fill="#6ee7b7" fontWeight={600}
              style={{ userSelect: 'none' }}>
              {(arcDraft.rx / Math.max(1, size.h)).toFixed(2)} × {(arcDraft.ry / Math.max(1, size.h)).toFixed(2)}
            </text>
          </g>
        )}

        {/* Pending ellipse (drawn, awaiting confirm) */}
        {arcDrawZoneId && arcPending && (
          <g style={{ pointerEvents: 'none' }}>
            <ellipse
              cx={arcPending.cx} cy={arcPending.cy} rx={Math.max(1, arcPending.rx)} ry={Math.max(1, arcPending.ry)}
              fill="rgba(16,185,129,0.14)"
              stroke="#10b981" strokeWidth={2.5} strokeDasharray="7,4"
            />
            <line x1={arcPending.cx - 7} y1={arcPending.cy} x2={arcPending.cx + 7} y2={arcPending.cy}
              stroke="#10b981" strokeWidth={1.5} />
            <line x1={arcPending.cx} y1={arcPending.cy - 7} x2={arcPending.cx} y2={arcPending.cy + 7}
              stroke="#10b981" strokeWidth={1.5} />
          </g>
        )}
      </svg>

      {/* Arc draw UI: instruction or confirm/cancel */}
      {arcDrawZoneId && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: 'rgba(5,120,85,0.92)',
          color: '#fff',
          padding: '6px 10px',
          fontSize: 11, fontWeight: 600,
          borderRadius: '8px 8px 0 0',
          letterSpacing: '0.01em',
        }}>
          {!arcPending ? (
            <>
              <span>⌢ 拖拽设置圆弧圆 — 中心点 + 半径</span>
              <button
                onClick={cancelArcDraw}
                style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 10 }}
              >取消</button>
            </>
          ) : (
            <>
              <span>确认使用此圆弧？</span>
              <button
                onClick={() => commitArcDraw(arcPending)}
                style={{ padding: '2px 12px', borderRadius: 4, border: 'none', background: '#fff', color: '#059669', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
              >确认</button>
              <button
                onClick={() => setArcPending(null)}
                style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 10 }}
              >重画</button>
              <button
                onClick={cancelArcDraw}
                style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 10 }}
              >取消</button>
            </>
          )}
        </div>
      )}

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
