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
 e602d9f76dae2518e38a65a9afec0f77ae0358a8
