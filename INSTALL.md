# Smart Screenshot Search Engine - Installation Guide

## Installation

Your **Smart Screenshot Search Engine** application has been built and is ready to install!

### Installer Information
- **Installer Location**: `dist/Smart Screenshot Search Engine Setup 1.0.0.exe`
- **File Size**: 118.73 MB
- **Platform**: Windows (x64)

### How to Install

#### Option 1: Simple Installation (Recommended)
1. Go to the `dist` folder in this project directory
2. Double-click `Smart Screenshot Search Engine Setup 1.0.0.exe`
3. Follow the installer wizard prompts
4. Choose installation location (default: `C:\Users\{YourUsername}\AppData\Local\Programs\Smart Screenshot Search Engine`)
5. Wait for installation to complete
6. A shortcut will be created in your Start Menu

#### Option 2: Command Line Installation
```powershell
# Open PowerShell and run:
& "dist\Smart Screenshot Search Engine Setup 1.0.0.exe"
```

### Features Included in Installation

✅ **Main Application** - Full Electron desktop app with React UI  
✅ **Backend Service** - Local Node.js backend running on `http://127.0.0.1:5000`  
✅ **Database** - MongoDB integration for search history and settings  
✅ **OCR Engine** - Tesseract for text extraction from screenshots  
✅ **Auto-updates** - Built-in update checking mechanism  
✅ **Start Menu Shortcuts** - Quick access to the application  

### System Requirements

- **OS**: Windows 10 or later (x64)
- **RAM**: 2 GB minimum
- **Disk Space**: 500 MB+ for installation
- **MongoDB**: Will be used if available locally
- **Node.js**: Not required (bundled in the app)

### First Launch

After installation:
1. Look for "Smart Screenshot Search Engine" in your Start Menu
2. Click to launch the application
3. The backend service will start automatically
4. Wait 3-5 seconds for the UI to fully load
5. The app will prompt for folder selection on first run

### Features

- 🔍 **Fast Screenshot Search** - Search through thousands of screenshots
- 📸 **Image Recognition** - AI-powered image matching
- 🏷️ **OCR Text Extraction** - Find text within screenshots
- 💾 **Auto-indexing** - Background file monitoring
- 🔐 **Privacy Focused** - All processing done locally
- ⚡ **Desktop Integration** - System tray support, keyboard shortcuts

### Troubleshooting

#### App won't start
- Make sure port 5000 is not in use by another application
- Check Windows Firewall hasn't blocked the app
- Try restarting your computer

#### Backend connection error
- Verify the backend service is running (should start automatically)
- Check that `http://127.0.0.1:5000/health` is accessible
- Check ports 5000 and 3000 are available

#### Performance issues
- Reduce the number of indexed folders
- Close other applications to free up memory
- Check your hard drive has adequate space

### Uninstallation

To uninstall the application:
1. Open **Settings** → **Apps** → **Apps & features**
2. Search for "Smart Screenshot Search Engine"
3. Click the app and select **Uninstall**
4. Follow the uninstall wizard
5. App data in `AppData\Local\smart-screenshot-desktop` will be preserved

### Support

For issues or questions:
- Check the application logs in `%APPDATA%/smart-screenshot-desktop/logs`
- Verify backend is running: `curl http://127.0.0.1:5000/health`

---

**Installation Complete!** Enjoy searching your screenshots. 🎉
