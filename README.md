# Smart Screenshot Search Engine

A Windows desktop app that finds any screenshot, image or document on your PC by **what's inside it**. Pick a folder (or your whole Desktop / Documents), and the app reads the text in every image with OCR, so you can search for a word you remember seeing instead of a file name.

Everything runs **locally**: your files and their text never leave your computer.

![Smart Screenshot Search Engine](docs/app-screenshot.png)

## Download

**[⬇ Download the latest Windows installer](https://github.com/Sakshi41777/Smart_Screenshot_Search_Engine/releases/latest)**

1. Download `Smart Screenshot Search Engine Setup x.y.z.exe` from the latest release.
2. Run it. Windows may show **"Windows protected your PC"** because the app isn't code-signed (a paid certificate). Click **More info → Run anyway**.
3. Choose **Only for me**, install, and open the app.

No Node.js, MongoDB or Python setup needed. Everything the app needs is bundled.

**Requirements:** Windows 10 or 11 (64-bit), about 500 MB free disk space.

## Features

- **Search inside images.** OCR (Tesseract) extracts text from screenshots and photos, and text is read from PDFs and code/text files.
- **Whole-folder indexing.** Choose any folder, your Desktop or a whole drive: every subfolder is scanned, and junk like `node_modules`, `.git`, `AppData` and system folders is skipped automatically.
- **Search by image.** Upload or crop an image to find the same or similar screenshots (perceptual hashing) and screenshots containing the same text.
- **Duplicate detection** for identical files.
- **Filters** by file type, extension, size, date and whether text was found.
- **Saved results and grouped search history** per account. Guest mode works too.
- **Optional background indexing.** With your permission, new and changed files in watched folders are indexed automatically.
- **Optional AI:** ask questions about a selected file, or get AI-assisted search, using your own OpenAI or Gemini key.

## How it works

```text
Electron app
├── React UI (client/)                  search, filters, previews, history
├── Node.js + Express API (backend_node/)  started by the app on 127.0.0.1:5001
│   ├── Tesseract.js OCR, pdf-parse     text extraction
│   ├── sharp                           thumbnails + perceptual image hashes
│   └── MongoDB (bundled)               index, accounts, history; private port 27027
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

This installs the client and backend dependencies, builds the React UI, downloads MongoDB once (into `vendor/`, which is git-ignored), and creates the installer in `dist/`.

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
| AI questions / AI search (OpenAI) | `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `LLM_MODEL` |
| AI questions / AI search (Gemini) | `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `LLM_MODEL` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, redirect URI `http://127.0.0.1:5001/api/auth/google/desktop/callback` |
| Email verification | `EMAIL_VERIFICATION_REQUIRED=true` plus Resend (`RESEND_API_KEY`) or SMTP (`SMTP_USER`, `SMTP_PASS`) |
| Local vision service (captions + CLIP) | `pip install -r requirements.txt`, then run `python python/vision_service.py` (port 5055) |
| Automatic cleanup | `CLEANUP_ENABLED=true`, `CLEANUP_DRY_RUN=false` and the `CLEANUP_*_DAYS` values |

Never commit your `.env` file. It's git-ignored and is never included in the installer.

## Project structure

```text
├── backend_node/   Express API: routes, MongoDB models, OCR / hashing services
├── client/         React UI rendered inside Electron
├── electron/       Main process (starts MongoDB + backend), preload, installer hook
├── python/         Optional PyTorch vision service (BLIP + CLIP)
├── scripts/        Build helpers (fetch-mongod.js downloads MongoDB for the installer)
└── package.json    Desktop scripts and electron-builder config
```

## Troubleshooting

- **"Backend Unavailable" on start:** check `%APPDATA%\smart-screenshot-desktop\backend.log` and `main.log`.
- **OneDrive folders:** files marked "online-only" must be downloaded before they can be indexed (right-click → *Always keep on this device*).
- **Backend health check:** open `http://127.0.0.1:5001/health` while the app is running.

## License

MIT
