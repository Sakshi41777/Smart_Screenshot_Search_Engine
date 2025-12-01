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