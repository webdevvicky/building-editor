import { useEffect, useState } from 'react'
import './DesktopGate.css'

const MIN_WIDTH = 1024

export function DesktopGate({ children }) {
  const [tooNarrow, setTooNarrow] = useState(
    typeof window !== 'undefined' && window.innerWidth < MIN_WIDTH
  )

  useEffect(() => {
    const onResize = () => setTooNarrow(window.innerWidth < MIN_WIDTH)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (tooNarrow) {
    return (
      <div className="desktop-gate">
        <div className="desktop-gate__card">
          <div className="desktop-gate__title">Desktop browser required</div>
          <div className="desktop-gate__body">
            This building editor is designed for desktop work. It needs a wider
            screen than your current viewport
            ({typeof window !== 'undefined' ? window.innerWidth : '—'}px)
            to lay out plans, panels, and the BOQ side by side.
          </div>
          <div className="desktop-gate__hint">
            Open this page on a monitor at least 1024px wide.
          </div>
        </div>
      </div>
    )
  }

  return children
}
