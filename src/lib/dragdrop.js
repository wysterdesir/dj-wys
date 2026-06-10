// Tiny shared drag state for HTML5 drag & drop (same-window only).
// dataTransfer payloads aren't readable during dragover, so the dragged
// track id lives here instead.
export const drag = { id: null }
