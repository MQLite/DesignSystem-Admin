import { useEffect, useState } from 'react'
import { composePreview } from '../api/client'

interface Props {
  layoutId: string
  onClose: () => void
}

const DEFAULT_CANVAS_LAYOUT = JSON.stringify({
  background: { x: 0, y: 0, scale: 1, rotation: 0 },
  subject:    { x: 0, y: 0, scale: 1, rotation: 0 },
  title:      { x: 0, y: 0, scale: 1, rotation: 0 },
  subtitle:   { x: 0, y: 0, scale: 1, rotation: 0 },
  footer:     { x: 0, y: 0, scale: 1, rotation: 0 },
})

export default function PreviewPanel({ layoutId, onClose }: Props) {
  const [status, setStatus]         = useState<'loading' | 'done' | 'error'>('loading')
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number>(3 / 4)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    composePreview({
      backgroundLayoutId: layoutId,
      textConfigJson: JSON.stringify({ title: 'Sample Title', subtitle: 'A subtitle line', footer: 'Footer text goes here' }),
      canvasLayoutJson: DEFAULT_CANVAS_LAYOUT,
    })
      .then(res => {
        setPreviewUrl(`/${res.previewRelativePath}`)
        if (res.widthPx > 0 && res.heightPx > 0)
          setAspectRatio(res.widthPx / res.heightPx)
        setStatus('done')
      })
      .catch(e => {
        setError((e as Error).message)
        setStatus('error')
      })
  }, [layoutId])

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900 text-sm">Layout Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="p-5">
          <div className="bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center" style={{ aspectRatio: String(aspectRatio) }}>
            {status === 'loading' && (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-xs">Generating 150 DPI preview…</span>
              </div>
            )}
            {status === 'error' && (
              <div className="text-center p-4">
                <p className="text-red-500 text-sm font-medium mb-1">Preview failed</p>
                <p className="text-xs text-gray-400">{error}</p>
              </div>
            )}
            {status === 'done' && previewUrl && (
              <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
            )}
          </div>
          <p className="text-[10px] text-gray-400 text-center mt-2">
            150 DPI · sample text · no subject image
          </p>
        </div>
      </div>
    </div>
  )
}
