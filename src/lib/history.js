// Conversation-history helpers shared by the store (rehydration) and the
// DJ brain. Dependency-free so both can import it without a cycle.

// Opus 5.5 binds each thinking block to the exact conversation before it,
// so after any rewrite of that conversation the blocks must go.
const REASONING = new Set(['thinking', 'redacted_thinking'])

export function stripThinking(msg) {
  if (msg?.role !== 'assistant' || !Array.isArray(msg.content)) return msg
  const content = msg.content.filter((b) => !REASONING.has(b.type))
  return content.length ? { ...msg, content } : null
}

export const hasThinking = (msg) =>
  msg?.role === 'assistant' && Array.isArray(msg.content) && msg.content.some((b) => REASONING.has(b.type))

// A user message that opens a turn (host text or [AUTO] note), as opposed
// to one carrying tool results.
export const isTurnStart = (m) =>
  m?.role === 'user' &&
  (typeof m.content === 'string' ||
    (Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === 'text')))
