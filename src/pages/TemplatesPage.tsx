import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Background, BgCrop, OccasionType, TextZoneRect } from '../types'
import { getBackgrounds, createBackground } from '../api/client'

function parseTextZones(json: string | null | undefined): TextZoneRect[] {
  if (!json) return []
  try { return JSON.parse(json) as TextZoneRect[] } catch { return [] }
}

/** Renders defaultText labels as an SVG overlay on a preview thumbnail. */
function TextZoneOverlay({ zones, widthMm, heightMm }: {
  zones: TextZoneRect[]
  widthMm: number
  heightMm: number
}) {
  const vw = widthMm, vh = heightMm
  const visible = zones.filter(z => z.defaultText)
  if (!visible.length) return null

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${vw} ${vh}`}
      preserveAspectRatio="none"
      overflow="visible"
    >
      <defs>
        {visible.filter(z => z.arcEnabled).map(zone => {
          const cx = (zone.x + zone.w / 2) * vw
          const cy = (zone.y + zone.h / 2) * vh
          const halfW = (zone.w / 2) * vw
          const Rx = Math.max(halfW + 0.1, (zone.arcRx ?? 0.7) * vh)
          const Ry = Math.max(0.1, (zone.arcRy ?? 0.5) * vh)
          const isUp = zone.arcDirection !== 'down'
          const ratio = Math.min(1, halfW / Rx)
          const yOff = Ry * (1 - Math.sqrt(1 - ratio * ratio))
          const sy = isUp ? cy + yOff : cy - yOff
          const sx = cx - halfW, ex = cx + halfW
          const sweep = isUp ? 0 : 1
          const d = `M ${sx.toFixed(2)},${sy.toFixed(2)} A ${Rx.toFixed(2)},${Ry.toFixed(2)} 0 0 ${sweep} ${ex.toFixed(2)},${sy.toFixed(2)}`
          return <path key={zone.id} id={`arc-${zone.id}`} d={d} fill="none" />
        })}
      </defs>
      {visible.map(zone => {
        const text = zone.defaultText!
        const fontSizeMm = (zone.fontSize ?? 50) / 100 * zone.h * vh
        const fill = zone.color ?? '#ffffff'
        const strokeW = zone.strokeWidth ? (zone.strokeWidth / 100) * zone.h * vh : 0
        const stroke = zone.strokeColor ?? '#000000'
        const fontFamily = zone.fontFamily ?? 'Arial'
        const anchor = zone.align === 'left' ? 'start' : zone.align === 'right' ? 'end' : 'middle'
        const cx = (zone.x + zone.w / 2) * vw
        const cy = (zone.y + zone.h / 2) * vh
        const textX = anchor === 'start' ? zone.x * vw : anchor === 'end' ? (zone.x + zone.w) * vw : cx

        const commonProps = {
          fontSize: fontSizeMm,
          fontFamily,
          fill,
          ...(strokeW > 0 ? { stroke, strokeWidth: strokeW, paintOrder: 'stroke fill' } : {}),
        }

        if (zone.arcEnabled) {
          return (
            <text key={zone.id} {...commonProps}>
              <textPath href={`#arc-${zone.id}`} startOffset="50%" textAnchor="middle">{text}</textPath>
            </text>
          )
        }

        return (
          <text key={zone.id} x={textX} y={cy} textAnchor={anchor} dominantBaseline="middle" {...commonProps}>
            {text}
          </text>
        )
      })}
    </svg>
  )
}

const OCCASIONS: OccasionType[] = ['Funeral', 'Birthday', 'Others']

const OCCASION_BADGE: Record<OccasionType, string> = {
  Funeral: 'bg-gray-100 text-gray-600',
  Birthday: 'bg-yellow-100 text-yellow-700',
  Others: 'bg-blue-100 text-blue-700',
}

export default function TemplatesPage() {
  const navigate = useNavigate()
  const [backgrounds, setBackgrounds] = useState<Background[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newOccasion, setNewOccasion] = useState<OccasionType>('Funeral')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      setBackgrounds(await getBackgrounds())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const bg = await createBackground({ name: newName.trim(), occasionType: newOccasion })
      navigate(`/backgrounds/${bg.id}`)
    } catch (e) {
      setError((e as Error).message)
      setCreating(false)
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Background Templates</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage templates, placement slots, and crop frames</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setNewName('') }}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
        >
          + New Template
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-5 bg-white border border-indigo-200 rounded-xl shadow-sm"
        >
          <h2 className="text-sm font-semibold text-gray-900 mb-4">New Template</h2>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Template name (e.g. Serene Lily — Funeral)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={newOccasion}
              onChange={e => setNewOccasion(e.target.value as OccasionType)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {OCCASIONS.map(o => <option key={o}>{o}</option>)}
            </select>
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-2 text-gray-500 text-sm rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading templates…</div>
      ) : backgrounds.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400 text-4xl mb-4">🖼️</p>
          <p className="text-gray-600 font-medium mb-1">No templates yet</p>
          <p className="text-gray-400 text-sm">Create a new template to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {backgrounds.map(bg => {
            const firstLayout = bg.layouts[0]
            const ar = firstLayout && firstLayout.widthMm > 0 && firstLayout.heightMm > 0
              ? firstLayout.widthMm / firstLayout.heightMm
              : 3 / 4
            const bgCrop: BgCrop | null = (() => {
              if (!firstLayout?.bgCropJson) return null
              try { return JSON.parse(firstLayout.bgCropJson) as BgCrop } catch { return null }
            })()
            const textZones = parseTextZones(firstLayout?.textZonesJson)
            return (
            <button
              key={bg.id}
              onClick={() => navigate(`/backgrounds/${bg.id}`)}
              className="text-left bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-indigo-300 transition-all group"
            >
              {/* Thumbnail — aspect ratio from first layout's mm dimensions */}
              <div
                className="relative bg-gray-100 overflow-hidden"
                style={{ aspectRatio: String(ar) }}
              >
                {bg.previewPath ? (
                  <img
                    src={`/${bg.previewPath}`}
                    alt={bg.name}
                    className="absolute inset-0 w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                    style={bgCrop ? {
                      transform: `translate(${bgCrop.offsetX * 100}%, ${bgCrop.offsetY * 100}%) scale(${bgCrop.scale})`,
                      transformOrigin: 'center center',
                    } : undefined}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-gray-300 text-5xl">🖼️</span>
                  </div>
                )}
                {firstLayout && (
                  <TextZoneOverlay
                    zones={textZones}
                    widthMm={firstLayout.widthMm}
                    heightMm={firstLayout.heightMm}
                  />
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <p className="font-medium text-gray-900 text-sm truncate">{bg.name}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${OCCASION_BADGE[bg.occasionType]}`}>
                    {bg.occasionType}
                  </span>
                  <span className="text-xs text-gray-400">
                    {bg.layouts.length} layout{bg.layouts.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </button>
          )
          })}
        </div>
      )}
    </div>
  )
}
