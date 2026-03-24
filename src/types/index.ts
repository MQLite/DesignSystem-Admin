export type OccasionType = 'Funeral' | 'Birthday' | 'Others'

/** Admin-defined background crop transform stored per layout. */
export interface BgCrop {
  scale: number    // 1.0 = cover-fit; > 1 zooms in
  offsetX: number  // fraction of canvas width; 0 = centred
  offsetY: number  // fraction of canvas height; 0 = centred
}

export interface BackgroundLayout {
  id: string
  sizeCode: string
  widthMm: number
  heightMm: number
  orientation: string
  subjectSlotsJson: string
  textZonesJson: string | null
  bgCropJson?: string | null
  version: number
}

export interface Background {
  id: string
  name: string
  occasionType: OccasionType
  previewPath: string | null
  sourcePath: string | null
  layouts: BackgroundLayout[]
}

// ── Visual editor rect types ──────────────────────────────────────────────────

/** A text zone — safe area for a text layer on the final canvas (normalised 0..1). */
export interface TextZoneRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** Mask shape of a subject slot. */
export type SlotShape = 'rect' | 'ellipse' | 'polygon'

/** A placement slot — where the subject image lands on the final canvas (normalised 0..1). */
export interface SlotRect {
  id: string
  /** Mask shape; defaults to "rect" when omitted. */
  shape: SlotShape
  x: number
  y: number
  w: number
  h: number
  /**
   * Polygon vertices in canvas-normalised [x, y] pairs.
   * Required when shape === "polygon". The bounding box (x/y/w/h) is derived from these.
   */
  points?: [number, number][]
  anchor: string
  fitMode: string
  allowUserMove: boolean
  allowUserScale: boolean
  minScale: number
  maxScale: number
}

// ── API request types ─────────────────────────────────────────────────────────

export interface CreateBackgroundRequest {
  name: string
  occasionType: OccasionType
}

export interface UpdateBackgroundRequest {
  name: string
  occasionType: OccasionType
}

export interface CreateLayoutRequest {
  sizeCode: string
  widthMm: number
  heightMm: number
  orientation: string
  subjectSlotsJson: string
  textZonesJson: string | null
}

export interface UpdateLayoutRequest {
  sizeCode: string
  widthMm: number
  heightMm: number
  orientation: string
  subjectSlotsJson: string
  textZonesJson: string | null
  bgCropJson: string | null
}
