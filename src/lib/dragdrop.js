// Tiny shared drag state for HTML5 drag & drop (same-window only).
// dataTransfer payloads aren't readable during dragover, so the dragged
// track id lives here instead.
export const drag = { id: null }

// If the dragged card unmounts mid-drag (the queue re-renders when the DJ
// refills it), the element's own dragend never fires and the ghost id would
// stick — arming phantom drop targets. These global hooks always clear it.
if (typeof window !== 'undefined') {
  window.addEventListener('dragend', () => {
    drag.id = null
  })
  window.addEventListener('drop', () => {
    // element-level onDrop handlers read drag.id first, then this clears it
    setTimeout(() => {
      drag.id = null
    }, 0)
  })
}
