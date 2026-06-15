import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Gallery from './pages/Gallery'
import Timeline from './pages/Timeline'
import NotFound from './pages/NotFound'
import './index.css'

// URL structure: rotary.pikt.ag/{code}
//   "/"       → manual code entry (QR fallback)
//   "/:code"  → photo gallery
//
// Backward-compat routes for the legacy /rotary/* paths in case any old QR
// got out into the wild. Static "/rotary" wins over dynamic "/:code" in
// react-router-dom precedence, so no ambiguity.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<Timeline />} />
        <Route path="/:code" element={<Gallery />} />
        <Route path="/rotary" element={<Home />} />
        <Route path="/rotary/:code" element={<Gallery />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
