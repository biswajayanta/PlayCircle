# PlayCircleApp

The PlayCircle frontend, built with Expo + Expo Router so the same code runs as
a web app now and as an iOS/Android app later with no rewrite.

## Setup (first time)

```bash
cd PlayCircleApp
npm install
cp .env.example .env
```

Make sure your FastAPI backend is running first (`uvicorn app.main:app --reload`
from `PlayCode`), with CORS enabled (already added to `main.py`).

## Run it as a web app

```bash
npx expo start --web
```

This opens a browser tab. If the page shows a connection error instead of
"Hey, Dev User", double check the backend is running and `.env`'s
`EXPO_PUBLIC_API_URL` matches its address.

## Project layout

- `app/` — screens, using Expo Router's file-based routing (`app/index.tsx` is
  the Home screen, showing "My Circles")
- `lib/api.ts` — typed fetch wrapper for the backend, reads the base URL from
  `EXPO_PUBLIC_API_URL`
- `lib/types.ts` — TypeScript types mirroring the backend's Pydantic response
  models (`UserMe`, `Circle`) — keep these in sync as the backend evolves

## What's built so far

- Home screen: greets the current user, lists circles you belong to (name,
  your role, member count), and lets you create a new circle inline

## Later: running on your phone

1. Install the **Expo Go** app from the Play Store / App Store
2. Change `.env`'s `EXPO_PUBLIC_API_URL` to your laptop's LAN IP (not
   `127.0.0.1` — on a phone that means the phone itself), e.g.
   `http://192.168.1.5:8000`
3. Run `npx expo start` (no `--web`) and scan the QR code with Expo Go

No code changes needed for this — that's the point of Expo Router being
universal.
