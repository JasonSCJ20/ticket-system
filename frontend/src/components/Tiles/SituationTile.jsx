import React, { useRef, useEffect } from 'react'

/**
 * SituationTile Component
 * Floating, draggable alert summary tile that can be positioned and snapped to corners
 * 
 * @param {Object} props - Component props
 * @param {Object} props.position - Current position {x, y}
 * @param {Function} props.onPositionChange - Callback when position changes
 * @param {boolean} props.isDragging - Whether tile is currently being dragged
 * @param {Function} props.onDraggingChange - Callback when dragging state changes
 * @param {boolean} props.expanded - Whether tile is expanded
 * @param {Function} props.onExpandChange - Callback to toggle expanded state
 * @param {number} props.criticalCount - Count of critical alerts
 * @param {number} props.highCount - Count of high severity alerts
 * @param {string} props.topAction - Top priority action description
 * @param {string} props.lastUpdated - Timestamp of last refresh (ISO string or Date)
 * @param {boolean} props.criticalPulse - Whether critical alert should pulse
 * @param {boolean} props.snapToCorner - Whether tile should snap to corners
 * @param {Function} props.onSnapToggle - Callback to toggle snap setting
 * @param {Function} props.onMoveTo - Callback to move tile to corner (e.g., 'top-left')
 * @param {string} props.presentationMode - Current view mode (executive, analyst)
 * @param {Function} props.onPresentationModeChange - Callback for presentation mode
 * @returns {JSX.Element}
 */
function SituationTile({
  position = { x: null, y: 14 },
  onPositionChange,
  isDragging = false,
  onDraggingChange,
  expanded = false,
  onExpandChange,
  criticalCount = 0,
  highCount = 0,
  topAction = 'No critical actions',
  lastUpdated = null,
  criticalPulse = false,
  snapToCorner = true,
  onSnapToggle,
  onMoveTo,
  presentationMode = 'analyst',
  onPresentationModeChange,
}) {
  const tileRef = useRef(null)
  const dragOffsetRef = useRef({ x: 0, y: 0 })

  /**
   * Handle mouse down on drag handle to initiate drag
   */
  const handleDragStart = (event) => {
    if (window.innerWidth <= 1100) return
    const rect = tileRef.current?.getBoundingClientRect()
    if (!rect) return
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    onDraggingChange(true)
  }

  /**
   * Handle drag movement and snapping
   */
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (event) => {
      const width = tileRef.current?.offsetWidth || 520
      const height = tileRef.current?.offsetHeight || 160
      const maxX = Math.max(8, window.innerWidth - width - 8)
      const maxY = Math.max(8, window.innerHeight - height - 8)
      const nextX = Math.min(Math.max(8, event.clientX - dragOffsetRef.current.x), maxX)
      const nextY = Math.min(Math.max(8, event.clientY - dragOffsetRef.current.y), maxY)
      onPositionChange({ x: nextX, y: nextY })
    }

    const handleMouseUp = () => {
      onDraggingChange(false)
      if (!snapToCorner) return

      // Auto-snap to nearest corner
      const width = tileRef.current?.offsetWidth || 280
      const height = tileRef.current?.offsetHeight || 120
      const leftX = 8
      const rightX = Math.max(8, window.innerWidth - width - 8)
      const topY = 8
      const bottomY = Math.max(8, window.innerHeight - height - 8)
      const midX = window.innerWidth / 2
      const midY = window.innerHeight / 2

      onPositionChange((currentPos) => {
        const useRight = (currentPos.x + width / 2) >= midX
        const useBottom = (currentPos.y + height / 2) >= midY
        return {
          x: useRight ? rightX : leftX,
          y: useBottom ? bottomY : topY,
        }
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, snapToCorner, onPositionChange, onDraggingChange])

  /**
   * Format last updated time
   */
  const formatLastUpdated = () => {
    if (!lastUpdated) return 'n/a'
    const date = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated
    return date.toLocaleTimeString()
  }

  return (
    <div
      ref={tileRef}
      className={`situation-float ${expanded ? 'expanded' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        left: position.x === null ? undefined : `${position.x}px`,
        top: `${position.y}px`,
        right: 'auto',
      }}
    >
      {/* Tile Header - Contains drag handle and expand/collapse button */}
      <div className="situation-float-head">
        <button
          className="situation-drag-handle"
          onMouseDown={handleDragStart}
          type="button"
          title="Drag to move"
        >
          Drag
        </button>
        <button
          className="situation-toggle"
          onClick={() => onExpandChange(!expanded)}
          type="button"
        >
          {expanded ? 'Collapse' : 'Expand'} Alerts
        </button>
      </div>

      {/* Alert Summary Row - Shows critical and high severity counts */}
      <div className="situation-float-row">
        <span className={`situation-alert-chip critical ${criticalPulse ? 'pulse' : ''}`}>
          Critical <strong>{criticalCount}</strong>
        </span>
        <span className="situation-alert-chip high">
          High <strong>{highCount}</strong>
        </span>
      </div>

      {/* Expanded Details - Position controls, snap settings, presentation mode */}
      {expanded && (
        <div className="situation-float-details">
          <p>
            <strong>Top action:</strong> {topAction}
          </p>
          <p>Updated: {formatLastUpdated()}</p>

          <button
            className={`situation-snap-toggle ${snapToCorner ? 'on' : ''}`}
            onClick={() => onSnapToggle(!snapToCorner)}
            type="button"
          >
            Snap To Corner: {snapToCorner ? 'On' : 'Off'}
          </button>

          {/* Corner preset buttons for quick positioning */}
          <div className="situation-corner-presets">
            <button type="button" onClick={() => onMoveTo('top-left')}>
              Top Left
            </button>
            <button type="button" onClick={() => onMoveTo('top-right')}>
              Top Right
            </button>
            <button type="button" onClick={() => onMoveTo('bottom-left')}>
              Bottom Left
            </button>
            <button type="button" onClick={() => onMoveTo('bottom-right')}>
              Bottom Right
            </button>
          </div>

          {/* Presentation mode toggle for different views */}
          <div className="presentation-controls">
            <button
              className={`ghost-btn ${presentationMode === 'executive' ? 'active-toggle' : ''}`}
              onClick={() => onPresentationModeChange('executive')}
              type="button"
            >
              Executive View
            </button>
            <button
              className={`ghost-btn ${presentationMode === 'analyst' ? 'active-toggle' : ''}`}
              onClick={() => onPresentationModeChange('analyst')}
              type="button"
            >
              Analyst View
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default SituationTile
