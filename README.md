<p align="center">
  <img src="docs/logo.png" alt="SmartShot logo" width="110" />
</p>

<h1 align="center">SmartShot: Smart Screenshot Search Engine</h1>

A Windows desktop app that finds any screenshot, image or document on your PC by **what's inside it**. Pick a folder (or your whole Desktop / Documents), and the app reads the text in every image with OCR, so you can search for a word you remember seeing instead of a file name.

Everything runs **locally**: your files and their text never leave your computer.

## Download

**[⬇ Download the latest Windows installer](https://github.com/Sakshi41777/Smart_Screenshot_Search_Engine/releases/latest)**

1. Download `Smart Screenshot Search Engine Setup x.y.z.exe` from the latest release.
2. Run it. Edge may say the file isn't commonly downloaded: click **⋯ → Keep → Keep anyway**. Windows may then show **"Windows protected your PC"** because the app isn't code-signed yet: click **More info → Run anyway**.
3. Choose **Only for me**, install, and open the app. A short guided tour shows you around.

The first time you add a folder, SmartShot reads every file once, which can take a few minutes for large folders (newest files become searchable first). After that, only new or changed files are read, so it stays quick.

No Node.js, MongoDB or Python setup needed. Everything the app needs is bundled.

**Requirements:** Windows 10 or 11 (64-bit), about 500 MB free disk space.

See **[INSTALL.md](INSTALL.md)** for the full guide: first use, updating, uninstalling and troubleshooting.

## Features

- **Search inside images.** OCR (Tesseract) extracts text from screenshots and photos, and text is read from PDFs and code/text files.
- **Whole-folder indexing.** Choose any folder, your Desktop or a whole drive: every subfolder is scanned, and junk like `node_modules`, `.git`, `AppData` and system folders is skipped automatically.
- **Search by image.** Upload or crop an image to find the same or similar screenshots (perceptual hashing) and screenshots containing the same text.
- **Duplicate detection** for identical files.
- **Filters** by file type, extension, size, date and whether text was found.
- **Ask about a file.** Get a summary, key points, dates and amounts, or action items from a file's text, right on your computer. No API key or account needed.
- **Saved files and search history**, with one-click re-run of past searches.
- **No sign-up.** Open the app and start searching. Adding your name is optional.
- **Guided tour** for new users, replayable any time from the **?** button or Settings.
- **Optional background indexing.** With your permission, new and changed files in watched folders are indexed automatically, with a tray icon near the clock to open or quit the app.
- **Self-healing.** If the app was left running in the background and stopped responding, opening it again restarts it automatically; after the PC wakes from sleep, the database and search service are checked and restarted if needed.

## How it works

```text
Electron app
├── React UI (client/)                  search, filters, previews, history
├── Node.js + Express API (backend_node/)  started by the app on 127.0.0.1:5001
│   ├── Tesseract.js OCR, pdf-parse     text extraction
│   ├── sharp                           thumbnails + perceptual image hashes
│   └── MongoDB (bundled)               index, saved items, history; private port 27027
└── Optional: python/vision_service.py  PyTorch BLIP captions + CLIP embeddings
```

The installer ships its own MongoDB server (`smartshot-mongod.exe`). It starts with the app on a private port, stores data in `%APPDATA%\smart-screenshot-desktop\mongo-data`, and stops when the app quits. It never interferes with a MongoDB you may already have installed.

## Build from source

**Prerequisites:** Windows 10/11, [Node.js 20+](https://nodejs.org) and Git.

```powershell
git clone https://github.com/Sakshi41777/Smart_Screenshot_Search_Engine.git
cd Smart_Screenshot_Search_Engine
npm install
```

**Build the Windows installer:**

```powershell
npm run dist
```

This installs the client and backend dependencies, builds the React UI, downloads MongoDB once (into `vendor/`, which is git-ignored), and creates `Smart Screenshot Search Engine Setup x.y.z.exe` in `dist/`.

> **Build tips.** Turn on Windows **Developer Mode** (Settings → System → Advanced). If your project folder is inside OneDrive and the build fails with "file is being used by another process", send the output elsewhere:
> `npx electron-builder --win nsis --publish never "--config.directories.output=$env:USERPROFILE\smartshot-dist"`

**Run in development mode:**

Development uses your own MongoDB. Copy `backend_node/.env.example` to `backend_node/.env` and set `MONGO_URI` (a local MongoDB or a MongoDB Atlas connection string), then:

```powershell
cd client; npm install; cd ..
cd backend_node; npm install; cd ..
npm run dev:desktop
```

## Optional configuration

These settings go in `backend_node/.env` for development. See `backend_node/.env.example` for the full list.

| Feature | Settings |
|---|---|
| Cloud AI answers for developers (OpenAI) | `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `LLM_MODEL` |
| Cloud AI answers for developers (Gemini) | `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `LLM_MODEL` |
| Local vision service (captions + CLIP) | `pip install -r requirements.txt`, then run `python python/vision_service.py` (port 5055) |
| Automatic cleanup | `CLEANUP_ENABLED=true`, `CLEANUP_DRY_RUN=false` and the `CLEANUP_*_DAYS` values |

Never commit your `.env` file. It's git-ignored and is never included in the installer.

## Project structure

```text
├── backend_node/   Express API: routes, MongoDB models, OCR / hashing services
├── client/         React UI rendered inside Electron
├── docs/           Logo and images for this README
├── electron/       Main process (starts MongoDB + backend), preload, installer hook, app icon
├── python/         Optional PyTorch vision service (BLIP + CLIP)
├── scripts/        Build helpers (fetch-mongod.js downloads MongoDB for the installer)
└── package.json    Desktop scripts and electron-builder config
```

## Troubleshooting

- **App doesn't open when clicked:** fixed in 1.0.3 (the app now recovers by itself). On older versions, end **Smart Screenshot Search Engine** and **smartshot-mongod** in Task Manager, then open it again.
- **First start after installing is slow:** Windows scans new apps once. Wait a minute; later starts are fast.
- **"SmartShot couldn't start":** check `%APPDATA%\smart-screenshot-desktop\backend.log` and `main.log`.
- **OneDrive folders:** files marked "online-only" must be downloaded before they can be indexed (right-click → *Always keep on this device*).
- **Backend health check:** open `http://127.0.0.1:5001/health` while the app is running.

## License

MIT
