import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SizingProvider } from './state/SizingContext.jsx'
import TopBar from './components/TopBar.jsx'
import Stepper from './components/Stepper.jsx'
import SizingPage from './pages/SizingPage.jsx'
import SummaryPage from './pages/SummaryPage.jsx'

export default function App() {
  return (
    <SizingProvider>
      <BrowserRouter>
        <TopBar />
        <Stepper />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/"        element={<SizingPage />} />
            <Route path="/summary" element={<SummaryPage />} />
            <Route path="*"        element={<SizingPage />} />
          </Routes>
        </main>
        <footer style={{
          padding: '32px 0',
          textAlign: 'center',
          color: 'var(--text-4)',
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          borderTop: '1px solid var(--border-1)',
        }}>
          PT Sizing · Vertex AI Provisioned Throughput · Internal tool
        </footer>
      </BrowserRouter>
    </SizingProvider>
  )
}
