import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ReviewQueue from './components/ReviewQueue.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main className="mx-auto max-w-[1500px] p-4">
      <ReviewQueue />
    </main>
  </StrictMode>,
)
