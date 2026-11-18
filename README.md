# SlotPicker — Calendar Availability Helper

A Vite + React + Base UI web app for visualizing all your calendars, dragging to highlight available time windows, and generating a clean bullet-point list of available times per day in any time zone.

## Features
- **Multi-Calendar Visualization**: Toggle individual calendars on/off and view overlapping events side-by-side.
- **Drag-to-Highlight Availability**: Click and drag across 15-minute slots on any day column (or click once for a 30-minute block).
- **Local Persistence**: Connected Google Calendars, cached events, and highlighted blocks are stored locally in `localStorage`.
- **One-Click Refresh**: Re-sync calendars and events anytime with the **Refresh** button if things go out of sync or your OAuth token expires.
- **Time Zone Conversion**: Uses the `Temporal` API (`temporal-polyfill` fallback) to convert and format your available windows into any IANA time zone.

## Connecting Google Calendar on GitHub Pages
1. Open [Google Cloud Console](https://console.cloud.google.com/) and enable the **Google Calendar API**.
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID** (Web application).
3. Add `https://sbeleidy.github.io` (and `http://localhost:5173` for local dev) under **Authorized JavaScript origins**.
4. In SlotPicker, click **Connect Google / iCal**, paste your Client ID, and click **Sign in with Google**.

## Local Development
```sh
npm install
npm run dev
```
