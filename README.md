<<<<<<< HEAD
# Smart Screenshot Search Engine

A desktop app for finding screenshots, images, and documents quickly. It can index folders, read text from images with OCR, search by keywords, find visual matches, detect duplicates, and keep useful search history.

## Quick Start

Run these commands from the project root.

```powershell
npm install
cd client; npm install; cd ..
cd backend_node; npm install; cd ..
```

Create or update `backend_node/.env`:

```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/smart_screenshot_db
CLIENT_ORIGIN=
JWT_SECRET=replace_with_secure_secret
TOKEN_EXPIRES_IN=7d
EMAIL_VERIFICATION_REQUIRED=false
```

Start MongoDB locally, then run the desktop app:

```powershell
npm run dev:desktop
```

The app will build the React renderer, start the backend, wait for the backend health check, and open the Electron window.

## Requirements

- Node.js 18 or newer
- npm
- MongoDB running locally at `mongodb://localhost:27017`
- Windows is the main tested desktop target

## Useful Commands

Install everything:

```powershell
npm install
cd client; npm install; cd ..
cd backend_node; npm install; cd ..
```

Run the desktop app in development:

```powershell
npm run dev:desktop
```

Run the production desktop app:

```powershell
npm start
```

Run only the backend:

```powershell
cd backend_node
npm run dev
```

Build the Windows installer:

```powershell
npm run dist
```

The installer output is created in `dist/`.

## What You Can Do

- Index folders that contain screenshots, images, PDFs, and documents
- Search indexed files by text
- Use OCR text from images and screenshots
- Filter by file type, extension, size, date, and OCR availability
- Search using an image from your gallery or camera capture
- Crop an image before visual search
- Detect duplicate files
- Save important results
- Review grouped search history
- Ask AI questions about a selected preview when an LLM provider is configured

## Project Structure

```text
Smart_Screenshot_Search_Engine/
|-- backend_node/      Node API, MongoDB models, routes, and services
|-- client/            React renderer used inside Electron
|-- electron/          Electron main process, preload, and app resources
|-- dist/              Generated installer/build output
|-- package.json       Root scripts for desktop orchestration
|-- requirements.txt   Python-related dependencies, if needed locally
`-- README.md
```

## Environment Setup

The backend reads settings from `backend_node/.env`.

For local development, this is enough:

```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/smart_screenshot_db
CLIENT_ORIGIN=
JWT_SECRET=replace_with_secure_secret
TOKEN_EXPIRES_IN=7d
EMAIL_VERIFICATION_REQUIRED=false
```

Keep `EMAIL_VERIFICATION_REQUIRED=false` if you want local register/login to work without configuring email.

## Optional Email Setup

Use Resend:

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=your_resend_api_key
RESEND_FROM=noreply@yourdomain.com
RESEND_BASE_URL=https://api.resend.com
SERVER_BASE_URL=http://127.0.0.1:5001
```

Or use SMTP:

```env
EMAIL_PROVIDER=smtp
SMTP_USER=your_sender@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_sender@gmail.com
SERVER_BASE_URL=http://127.0.0.1:5001
```

## Optional Google Login

Add these values to `backend_node/.env`:

```env
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:5001/api/auth/google/desktop/callback
GOOGLE_OAUTH_SCOPES=openid email profile
```

In Google Cloud Console, add this redirect URI exactly:

```text
http://127.0.0.1:5001/api/auth/google/desktop/callback
```

## Optional AI Features

Choose one LLM provider if you want preview chat or AI-assisted search.

OpenAI or OpenAI-compatible provider:

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key
LLM_API_KEY=your_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Gemini:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
LLM_MODEL=gemini-1.5-flash
```

AI query assist:

```env
AI_QUERY_ASSIST=true
AI_QUERY_TIMEOUT_MS=12000
AI_QUERY_MIN_CHARS=4
```

AI semantic search:

```env
AI_SEMANTIC_SEARCH=true
AI_SEMANTIC_MODEL=text-embedding-3-small
AI_SEMANTIC_MAX_CANDIDATES=220
AI_SEMANTIC_TIMEOUT_MS=12000
```

## Maintenance

Preview cleanup without deleting anything:

```powershell
cd backend_node
npm run maintenance:dry
```

Apply cleanup:

```powershell
cd backend_node
npm run maintenance:apply
```

To enable automatic cleanup, add this to `backend_node/.env` and restart the backend:

```env
CLEANUP_ENABLED=true
CLEANUP_DRY_RUN=false
CLEANUP_INTERVAL_HOURS=24
CLEANUP_UPLOADS_DAYS=30
CLEANUP_THUMBS_DAYS=14
CLEANUP_HISTORY_DAYS=30
```

## Troubleshooting

Check backend health:

```text
http://localhost:5001/health
```

Common things to check:

- MongoDB is running before starting the app.
- `backend_node/.env` has the correct `MONGO_URI`.
- Port `5001` is free.
- LLM keys and model names are correct if preview chat fails.
- OneDrive folders may need files to be available offline before indexing.

## Notes

- Do not commit `.env` files or real API keys.
- `npm run dev:desktop` is the recommended command for normal development.
- `npm start` also builds the client and starts the backend plus Electron in production mode.
=======
🧠 Smart Screenshot Search Engine
React + Electron + Python (CustomTkinter) Desktop App

Author: Sakshi Mishra

A cross-platform desktop app that lets users search screenshots/documents using OCR + NLP + Machine Learning.
The system integrates:

React → Login, Register, Welcome Page (GSAP animations)

Electron → Desktop shell, connects React ↔ Python

Python (CustomTkinter) → Screenshot/document search engine

Node.js + MongoDB → Authentication + search history storage

The Python app launches automatically when the user clicks Search Screenshots inside the Electron UI.

📁 Project Structure
Smart_ScreenShot_Search_engine/
│
├── app/                # Python desktop application (main.py, engines)
├── client/             # React frontend (login, signup, welcome)
├── backend_node/       # Node.js server (auth, DB)
├── electron/           # main.js + preload.js
├── requirements.txt    # Python dependencies
├── start-dev.ps1       # Runs React + Electron together
└── package.json        # Electron configuration + scripts

🚀 How to Run the Project (Complete Setup Guide)

This guide ensures the whole system runs properly:

React Frontend

Electron Desktop App

Python Desktop App

Node.js Backend

MongoDB

✅ 1. Install Prerequisites
✔ Install Node.js

https://nodejs.org

✔ Install Python 3.10+

https://www.python.org/downloads/

✔ Install MongoDB

https://www.mongodb.com/try/download/community

✅ 2. Setup Python Environment

Open PowerShell in project root:

# Activate venv
.\.venv\Scripts\Activate.ps1

# Install all Python dependencies
pip install -r requirements.txt

✅ 3. Install Node Dependencies
React Client
cd client
npm install
cd ..

Node.js Backend
cd backend_node
npm install
cd ..

Electron + Root Dependencies
npm install

✅ 4. Start MongoDB

Check if running:

Get-Service MongoDB


If stopped:

Start-Service MongoDB

🚀 5. Run the Entire Project (Development Mode)
⭐ Recommended (one command)

This starts React + Electron automatically.

powershell -ExecutionPolicy Bypass -File .\start-dev.ps1


Then:

React opens at http://localhost:3000

Electron loads React UI

Click Search Screenshots → Python app starts automatically

🔧 Manual Method (if you don't want to use the script)
Step A — Run React Frontend
cd client
npm start

Step B — Run Electron App

Open new terminal:

npm run dev


Electron opens → click the button → Python GUI launches.

Step C — Run Backend (optional but required for login)
cd backend_node
npm start

🐍 6. (Optional) Run Python App Directly
.\.venv\Scripts\Activate.ps1
python app/main.py


or with Electron integration flag:

python app/main.py --from-electron

📦 7. Build the Desktop Installer (Production)

Electron Builder will:

Build React

Bundle the Python EXE

Create a Windows installer

Run:

npm run dist


Your installer appears in:

dist/
   Smart Screenshot Search Engine Setup.exe
   win-unpacked/

🎉 Done!

You now have a fully running desktop application combining React + Electron + Python.
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
