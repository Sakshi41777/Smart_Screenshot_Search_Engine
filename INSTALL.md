# Installing SmartShot

SmartShot (Smart Screenshot Search Engine) is a Windows app that finds your screenshots, photos, PDFs and documents by the words inside them. This guide covers installing, first use, updating and removing it.

## Requirements

- Windows 10 or 11 (64-bit)
- About 500 MB of free disk space
- Nothing else: the search service, OCR engine and database are all built in. You don't need Node.js, MongoDB, Python or an account.

## Install

1. Open the **[latest release](https://github.com/Sakshi41777/Smart_Screenshot_Search_Engine/releases/latest)** and download **`Smart Screenshot Search Engine Setup x.y.z.exe`** under **Assets**.
2. If Edge says the file isn't commonly downloaded, click **⋯ → Keep → Keep anyway**.
3. Open the downloaded file. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**.
   These warnings appear because SmartShot is a new app that isn't code-signed yet. They don't mean anything is wrong with it.
4. Choose **Only for me**, then **Install**.
5. Open **SmartShot** from the Start menu or the desktop shortcut.

The first start after installing can take up to a minute while Windows checks the new app. Later starts are quick.

## First use

1. A short **guided tour** shows you around. You can skip it and replay it later with the **?** button next to the logo, or from **Settings → Take the tour**.
2. Click **Add folder** and choose your Screenshots, Desktop, Downloads or any other folder. Everything inside it, including subfolders, is included.
3. The first time you add a folder, SmartShot reads every file once. For large folders this can take a few minutes. Newest files become searchable first, and you can keep using your computer.
4. Type any word you remember seeing in a file and press **Enter**. You can also search **By image** or with the camera.

After the first read, only new or changed files are read, so it stays quick.

## Update to a new version

1. Quit SmartShot: right-click its icon near the clock and choose **Quit SmartShot**, or simply close the window.
2. Download the new installer from the latest release and run it.

Your folders, saved files and search history are kept.

## Uninstall

1. Open **Settings → Apps → Installed apps**.
2. Find **Smart Screenshot Search Engine**, click **⋯ → Uninstall**.

Uninstalling keeps your index and settings in `%APPDATA%\smart-screenshot-desktop`, in case you reinstall. To remove them too, delete that folder after uninstalling. Your own screenshots and documents are never changed or deleted.

## Troubleshooting

**The app doesn't open when I click it.**
SmartShot can keep running in the background (icon near the clock) to index new files. From version 1.0.3, clicking the app always brings the window back, and a copy that stopped responding is closed and restarted automatically. On older versions: open Task Manager (**Ctrl + Shift + Esc**), end **Smart Screenshot Search Engine** and **smartshot-mongod**, then open the app again.

**"SmartShot couldn't start".**
Close the app and open it again. If it keeps happening, restart your computer.

**Some files aren't found.**
OneDrive files marked "online-only" must be downloaded before they can be read: right-click the folder → **Always keep on this device**.

**Reporting a problem.**
Please include these two files from `%APPDATA%\smart-screenshot-desktop` (paste that path into the File Explorer address bar): `main.log` and `backend.log`. You can [open an issue](https://github.com/Sakshi41777/Smart_Screenshot_Search_Engine/issues) on GitHub.

## Privacy

Everything runs on your computer. Your files and the text read from them are never uploaded anywhere.
