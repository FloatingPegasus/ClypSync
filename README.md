# ClypSync

A shared clipboard that works across any device. Enter the same 6-digit PIN and whatever you paste on one shows up on the others, instantly.

**Live:** https://clypsync.vercel.app/

## Features

- **Text Sharing** - Paste text and it syncs across all devices in real-time
- **Image Sharing** - Upload images via file picker or paste from clipboard (Ctrl+V)
- **Image Preview** - See a preview of images before uploading
- **Copy Options** - Copy image data (for apps) or copy image URL (for sharing)
- **Export** - Download all pastes as JSON or text file
- **Room Stats** - See paste count breakdown (text vs images) in the header
- **Auto-sync** - Real-time updates across all connected devices
- **Persistent PIN** - Your room PIN is saved locally for quick rejoining

## Clipboard regression tests

```sh
npm ci
npx playwright install chromium
npm test
```

The browser tests start a local development server with a stubbed Supabase API;
no real room, credentials, or storage bucket is needed.
