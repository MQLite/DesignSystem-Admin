export type OccasionType = 'Funeral' | 'Birthday' | 'Others'

export interface BackgroundLayout {
  id: string
  sizeCode: string
  widthMm: number
  heightMm: number
  orientation: string
  subjectSlotsJson: string
  subjectCropFramesJson: string | null
  textZonesJson: string | null
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

/** A placement slot — where the subject image lands on the final canvas (normalised 0..1). */
export interface SlotRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  anchor: string
  fitMode: string
  allowUserMove: boolean
  allowUserScale: boolean
  minScale: number
  maxScale: number
}

/** A crop frame — the window shown to the user when they pan/zoom their photo (normalised 0..1). */
export interface CropFrameRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  shape: string
  aspectRatio: number | null
  allowUserMove: boolean
  allowUserScale: boolean
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
  subjectCropFramesJson: string | null
  textZonesJson: string | null
}

export interface UpdateLayoutRequest {
  sizeCode: string
  widthMm: number
  heightMm: number
  orientation: string
  subjectSlotsJson: string
  subjectCropFramesJson: string | null
  textZonesJson: string | null
}
