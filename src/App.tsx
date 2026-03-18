import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import TemplatesPage from './pages/TemplatesPage'
import BackgroundDetailPage from './pages/BackgroundDetailPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <Link to="/" className="text-base font-bold text-gray-900 hover:text-indigo-600">
              Design System
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-xs font-medium text-white bg-indigo-500 px-2 py-0.5 rounded">
              Admin
            </span>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">
          <Routes>
            <Route path="/" element={<TemplatesPage />} />
            <Route path="/backgrounds/:id" element={<BackgroundDetailPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
