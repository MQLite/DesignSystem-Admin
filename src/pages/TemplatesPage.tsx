import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Background, OccasionType } from '../types'
import { getBackgrounds, createBackground } from '../api/client'

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
          {backgrounds.map(bg => (
            <button
              key={bg.id}
              onClick={() => navigate(`/backgrounds/${bg.id}`)}
              className="text-left bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-indigo-300 transition-all group"
            >
              {/* Thumbnail */}
              <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center overflow-hidden">
                {bg.previewPath ? (
                  <img
                    src={`/${bg.previewPath}`}
                    alt={bg.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <span className="text-gray-300 text-5xl">🖼️</span>
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
          ))}
        </div>
      )}
    </div>
  )
}
