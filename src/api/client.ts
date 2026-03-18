import type {
  Background,
  BackgroundLayout,
  CreateBackgroundRequest,
  UpdateBackgroundRequest,
  CreateLayoutRequest,
  UpdateLayoutRequest,
} from '../types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}${text ? ': ' + text : ''}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// ── Backgrounds ───────────────────────────────────────────────────────────────

export const getBackgrounds = (): Promise<Background[]> =>
  req('/api/admin/backgrounds')

export const getBackground = (id: string): Promise<Background> =>
  req(`/api/admin/backgrounds/${id}`)

export const createBackground = (body: CreateBackgroundRequest): Promise<Background> =>
  req('/api/admin/backgrounds', { method: 'POST', ...json(body) })

export const uploadBackgroundImage = (id: string, file: File): Promise<Background> => {
  const form = new FormData()
  form.append('file', file)
  return req(`/api/admin/backgrounds/${id}/image`, { method: 'POST', body: form })
}

export const updateBackground = (id: string, body: UpdateBackgroundRequest): Promise<Background> =>
  req(`/api/admin/backgrounds/${id}`, { method: 'PATCH', ...json(body) })

export const deleteBackground = (id: string): Promise<void> =>
  req(`/api/admin/backgrounds/${id}`, { method: 'DELETE' })

// ── Layouts ───────────────────────────────────────────────────────────────────

export const createLayout = (bgId: string, body: CreateLayoutRequest): Promise<BackgroundLayout> =>
  req(`/api/admin/backgrounds/${bgId}/layouts`, { method: 'POST', ...json(body) })

export const updateLayout = (bgId: string, layoutId: string, body: UpdateLayoutRequest): Promise<BackgroundLayout> =>
  req(`/api/admin/backgrounds/${bgId}/layouts/${layoutId}`, { method: 'PATCH', ...json(body) })

export const deleteLayout = (bgId: string, layoutId: string): Promise<void> =>
  req(`/api/admin/backgrounds/${bgId}/layouts/${layoutId}`, { method: 'DELETE' })

// ── Compose preview (reuses public endpoint) ──────────────────────────────────

export const composePreview = (body: {
  backgroundLayoutId: string
  textConfigJson: string
  canvasLayoutJson: string
}): Promise<{ previewRelativePath: string; widthPx: number; heightPx: number }> =>
  req('/api/compose/preview', { method: 'POST', ...json(body) })
