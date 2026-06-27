import { Routes, Route } from 'react-router-dom'

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-brand-red">BTEC LMS v2</h1>
              <p className="mt-2 text-gray-600">ศูนย์บริการโลหิตแห่งชาติ สภากาชาดไทย</p>
              <p className="mt-4 text-sm text-gray-400">Phase 0 — Foundation ready</p>
            </div>
          </div>
        }
      />
    </Routes>
  )
}
