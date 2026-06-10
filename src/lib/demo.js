// No-keys demo set. Every videoId verified via YouTube oEmbed — these are
// the official uploads, all embeddable. Durations are approximate; the
// engine corrects them from the player once a track loads.

import { uid } from '../store'
import * as engine from './engine'

const DEMO = [
  ['Earth, Wind & Fire', 'September', 'Gs069dndIYk', 215, 4],
  ['Daft Punk ft. Pharrell', 'Get Lucky', '5NV6Rdv1a3I', 367, 4],
  ['Toto', 'Africa', 'FTQbiNvZqaY', 272, 3],
  ['a-ha', 'Take On Me', 'djV11Xbc914', 243, 4],
  ['Mark Ronson ft. Bruno Mars', 'Uptown Funk', 'OPf0YbXqDm0', 271, 5],
  ['PSY', 'Gangnam Style', '9bZkp7q19f0', 253, 5],
  ['Nirvana', 'Smells Like Teen Spirit', 'hTWKbfoikeg', 278, 5],
  ['Queen', 'Bohemian Rhapsody', 'fJ9rUzIMcZQ', 359, 3],
  ['Luis Fonsi ft. Daddy Yankee', 'Despacito', 'kJQP7kiw5Fk', 282, 4],
  ['Rick Astley', 'Never Gonna Give You Up', 'dQw4w9WgXcQ', 212, 4],
]

export function demoTracks() {
  return DEMO.map(([artist, title, videoId, durationSec, energy]) => ({
    id: uid(),
    videoId,
    title,
    artist,
    channel: 'Demo set',
    durationSec,
    energy,
    candidates: [videoId],
    note: 'demo',
  }))
}

export function loadDemoSet() {
  engine.queueTracks(demoTracks(), 'append')
}
