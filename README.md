# DJ WYS — your AI-powered virtual DJ booth

A web app that runs a **continuous, dynamic music set** for your event. Two decks, a crossfader, animated waveforms, and an AI DJ you steer by chatting naturally:

> *"It's my mom's birthday — multigenerational crowd, start with 70s soul."*
> *"Bring the energy up!"* · *"Play Suavemente next."* · *"Slow it down, dinner's served."*

The AI builds and continuously reshapes the queue, auto-crossfades between tracks like a live DJ, and tops the queue up before it ever runs dry. Music streams through the **official YouTube player** — with your YouTube Premium account signed in, playback is ad-free.

Works on laptop, tablet, and phone. Installable as an app (PWA). No backend, no accounts: your API keys live only in your browser.

---

## Quick start

1. Open the app (your GitHub Pages URL, e.g. `https://YOUR-USERNAME.github.io/dj-wys/`).
2. Click **▶ Load the demo set** and press play — that works with **zero setup**.
3. For the real thing, add two free-tier keys in **Settings ⚙** (one-time, ~10 minutes — see below).
4. Tell the DJ about your event in the chat. Run the party.

## The two keys

Both are entered in Settings and stored **only in your browser's localStorage**. They are sent only to Google / Anthropic APIs — never to the repo or any other server.

### 1. Anthropic API key — the DJ brain

1. Go to [console.anthropic.com](https://console.anthropic.com) → sign up / sign in.
2. **API keys** → **Create key** → copy the `sk-ant-…` value.
3. Add a few dollars of credit under **Billing** (a typical event costs roughly a dollar, model-dependent).
4. Paste into Settings → *Anthropic API key* → **Test**.

You can pick the brain model in Settings: Opus 4.8 (default, best), Sonnet 4.6 (cheaper), Haiku 4.5 (cheapest), Fable 5 (maximum).

### 2. YouTube Data API key — track search

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. `dj-wys`).
2. **APIs & Services → Library** → search **"YouTube Data API v3"** → **Enable**.
3. **APIs & Services → Credentials** → **Create credentials → API key** → copy the `AIza…` value.
4. Recommended: click the key → **Application restrictions → Websites** → add `https://YOUR-USERNAME.github.io/*` (and `http://localhost:5174/*` for local dev). Under **API restrictions**, limit it to *YouTube Data API v3*.
5. Paste into Settings → *YouTube Data API key* → **Test**.

The free quota allows ~100 fresh searches per day; the app caches results for 30 days, which is comfortably enough for an event.

## Gig-night checklist

- ✅ Use **Chrome or Edge, signed into the Google account with YouTube Premium** — that's what makes embedded playback ad-free. (Safari/iOS sometimes drops the signed-in state inside embeds due to tracking prevention; ads may reappear there.)
- ✅ Plug the device into your speakers, open the app, **press play once** — the first tap unlocks audio, after that the AI drives.
- ✅ Leave **AUTO DJ** and **auto-refill** on: tracks crossfade themselves and the DJ keeps the queue 5–10 deep.
- ✅ The screen stays awake while music plays (wake lock) — keep the device on power.
- ✅ Brief the DJ early ("wedding, 80 guests, no explicit lyrics") — everything it picks flows from that.
- 🎛 You can always ride the crossfader, channel faders, and transport yourself — manual moves never fight the AI.

## How it works (and honest limitations)

- **Playback** uses the official **YouTube IFrame Player API** — the only terms-of-service-compliant way to stream YouTube/YouTube Music in a web app. The player must stay visible, so the video IS the deck platter (toggle to 16:9 cinema mode in Settings).
- **Crossfades** are timed, equal-power volume fades between two players, triggered automatically as each track's outro approaches (length configurable, 2–20s). True beatmatching/BPM-sync is **not possible**: browsers cannot access the raw audio of a YouTube stream. The AI compensates by sequencing tracks so blends feel intentional.
- **Waveforms** are simulated visuals driven by track energy and playback position (same browser limitation), not true audio analysis.
- **Track search** prefers the official "Artist – Topic" / VEVO uploads (the actual YouTube Music catalog) and skips non-embeddable videos; if an upload still refuses to play, the app auto-falls back to the next candidate or skips.
- **The AI** (Claude) gets a live snapshot of both decks, the queue, and history on every message, and controls the booth through tools: `queue_tracks`, `play_now`, `skip_track`, `pause/resume`, `set_crossfade`, `set_energy`. When the queue drops below 3 tracks it's automatically asked to extend the set in the current vibe.
- **Costs**: YouTube key — free tier. Anthropic — pay-per-use, typically around $1 per event with the default model.

## Run it yourself

```bash
npm install
npm run dev        # http://localhost:5174/dj-wys/
npm run build      # production build in dist/
```

### Deploy to GitHub Pages

1. Create a **public repo named `dj-wys`** and push this code to `main`.
2. The included GitHub Action ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) builds and publishes Pages automatically on every push.
3. **First push only:** if that run fails at `configure-pages` with *"Resource not accessible by integration"*, the workflow token wasn't allowed to create the Pages site. Enable it once — repo **Settings → Pages → Source: GitHub Actions**, or:
   ```bash
   gh api -X POST repos/YOUR-USERNAME/dj-wys/pages -f build_type=workflow
   gh run rerun --failed -R YOUR-USERNAME/dj-wys
   ```
4. Your app appears at `https://YOUR-USERNAME.github.io/dj-wys/`.

> Using a different repo name? Change `base` in [vite.config.js](vite.config.js) to `'/your-repo-name/'`.

## Roadmap ideas

- 📱 Phone-as-remote-control for the laptop's audio (realtime sync layer)
- 📚 Import your own YouTube Music playlists (Google OAuth)
- 🎙 Voice input — talk to the DJ hands-free
- 🥁 BPM-aware sequencing hints from public tempo databases

## Fine print

Personal/hobby project, MIT licensed. Streams content exclusively through the official YouTube embedded player in accordance with YouTube's Terms of Service — nothing is downloaded, proxied, or re-hosted. Ad-free playback requires your own YouTube Premium subscription; AI features require your own Anthropic API key.
