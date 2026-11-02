# SWCC

SWCC is an offline desktop app for social workers and social service workers to organize their annual continuing competence portfolios. It brings standards review, self-assessment, learning goals, activities and supporting evidence together in one place.

Built with Electron, React, TypeScript and SQLite, it runs on Windows and macOS. Your records stay on your computer; there is no account or cloud sync.

## What it does

- Keep separate annual portfolios with autosaved assessment and development-plan drafts.
- Review the bundled standards document and track annual step completion.
- Connect learning goals to activities, reflections, evidence files and links.
- Export annual forms as a PDF or a complete portfolio ZIP with original evidence files.
- Back up all years and evidence, preview a backup, and restore the complete dataset.

SWCC records declaration dates but does not submit declarations or verify current College compliance. Its bundled sources use the September 2018 ethics document and a 2023 assessment-tool reference; check the [College's current requirements](https://www.ocswssw.org/registrants/continuing-competence-program/) for your year.

## Get the app

Check the [releases page](https://github.com/andreaskinga-lgtm/SWCC/releases) for published installers. Release targets are Windows 11 (x64) and macOS 14+ (Apple Silicon or Intel). You do not need Node.js or npm to use an installer.

Records and evidence are stored locally. Use **Backup and restore → Create full backup** to save a copy outside the app's storage, preferably on another device. Backups are not encrypted; annual PDF and portfolio exports are not restorable full-app backups.

## Build and run from source

Install Node.js 22.12+ or 24+ with npm, then clone the repository:

```sh
git clone https://github.com/andreaskinga-lgtm/SWCC.git
cd SWCC
npm ci
npm run build
npm start
```

For development, use `npm run dev` instead of building and starting. It runs the Vite renderer and Electron together; restart it after main-process or preload changes.

`npm ci` also rebuilds the native SQLite dependency for Electron. Let the install finish before running the app.

### Build an app bundle or installer

Run these from the repository directory after `npm ci`:

| Command | Output |
| --- | --- |
| `npm run package:dir` | Unpacked app for your current platform |
| `npm run package:mac` | macOS DMG for your current Mac architecture |
| `npm run package:win` | Windows x64 NSIS installer |

Each command builds the app first and writes output to `release/`. Build macOS installers on macOS and Windows installers on Windows. macOS signing and notarization require additional setup; Windows installers are currently unsigned.

Detailed development checks, signing setup, release publishing and implementation notes live in the [maintainer documentation](docs/maintainers.md).
