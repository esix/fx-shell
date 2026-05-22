# fx-shell

XULRunner-style desktop app shell built on top of a modern Firefox runtime.
Write your app as a chrome-privileged HTML / CSS / JS bundle and ship a
self-contained Windows binary — no Electron, no fork, no rebuild of Gecko.

---

## Requirements

- **Node.js 18+** and **npm**
- **Windows 10 / 11** (macOS + Linux are planned — currently the build
  scripts only handle Win64)
- **Optional, for `npm run build` with auto-downloaded runtime:**
  [7-Zip](https://www.7-zip.org/) (`winget install 7zip.7zip`).
  If you don't have it, the build falls back to your installed Firefox.
- **Optional, for `npm start`:** Firefox installed at the default location.
  If absent, `npm start` will download the pinned version to a cache.

---

## Quick start

```sh
git clone <repo>
cd fx-shell
npm start
```

That's it. The window opens; edit `app/chrome/content/*` and re-launch.

---

## Project layout

```
fx-shell/
├── package.json                 ← fxshell config (firefoxVersion, appName, …)
├── app/                         ← your application
│   ├── application.ini          ← XULRunner-style metadata
│   ├── chrome.manifest          ← chrome package registration
│   ├── defaults/preferences/
│   │   └── prefs.js             ← toolkit.defaultChromeURI lives here
│   └── chrome/
│       ├── content/
│       │   ├── main.xhtml       ← entry chrome window (HTML, not XUL)
│       │   ├── main.js          ← Services / IOUtils / nsIFilePicker / …
│       │   ├── greeter.jsm      ← classic JSM (FF < 102)
│       │   └── greeter.sys.mjs  ← modern ESM chrome module (FF 102+)
│       └── skin/
│           ├── main.css
│           └── icon.ico         ← used for window title bar + exe icon
├── scripts/                     ← framework tooling (not the app)
│   ├── start.js                 ← `npm start`
│   ├── build.js                 ← `npm run build`
│   └── lib/
│       ├── config.js            ← reads package.json#fxshell
│       ├── runtime.js           ← detect / download / extract Firefox
│       ├── tools.js             ← rcedit, csc.exe wrappers
│       ├── launcher.js          ← compiles native launcher stub
│       ├── launcher.cs.template ← the launcher's C# source
│       ├── branding.js          ← icon + version-info via rcedit
│       └── fs-utils.js
├── profile/                     ← created by `npm start` (gitignored)
├── tools/                       ← auto-downloaded rcedit lives here (gitignored)
└── dist/                        ← `npm run build` output (gitignored)
```

---

## `npm start`

Launches your app against either your **installed Firefox** (default —
fastest iteration) or the **pinned, cached** Firefox runtime if no system
copy is available. Forwards extra args to Gecko:

```sh
npm start                    # plain launch
npm start -- --jsconsole     # also open the Browser Console
npm start -- --jsdebugger    # attach the chrome debugger
```

The profile lives in `./profile/`.

---

## `npm run build`

Produces a self-contained distribution in `./dist/`:

```
dist/
├── fxshell.exe        ← native launcher (custom icon + version-info)
├── README.txt
├── app/               ← copy of your app
└── runtime/           ← pruned Firefox runtime (~200 MB)
    └── fxshell.exe     the engine, renamed and rebranded
```

The launcher exe is a tiny C# stub (compiled at build time by the
pre-installed `csc.exe`) that spawns `runtime\fxshell.exe` with the
correct `-app application.ini --no-remote --profile <…>` arguments.
It also intercepts `--reset-profile` and forwards everything else.

**Profile location** is chosen at runtime:

- If `dist/` is writable (USB stick, Desktop extract) → `dist\profile`.
- If not (Program Files install) → `%LOCALAPPDATA%\<appName>\profile`.

### Runtime source

The build tries each of these in order:

1. `FXSHELL_FIREFOX=C:\path\to\firefox.exe` env var.
2. The pinned `firefoxVersion` from `package.json#fxshell`, cached at
   `%LOCALAPPDATA%\fxshell-cache\runtimes\firefox-<ver>-win64\`.
   Downloaded from `archive.mozilla.org` and extracted with 7-Zip if absent.
3. If the pinned cache can't be populated (no 7-Zip), falls back to your
   installed Firefox with a loud warning. Install 7-Zip and re-run for a
   reproducible build:
   ```sh
   winget install 7zip.7zip
   ```

### Shipping

```sh
npm run build
Compress-Archive -Path dist\* -DestinationPath fxshell-windows.zip
```

~80–100 MB compressed. The recipient extracts, double-clicks the exe,
done — no Firefox install required on their machine.

---

## Configuration (`package.json#fxshell`)

```json
{
  "fxshell": {
    "firefoxVersion": "99.0.1",
    "appName":        "myapp",
    "displayName":    "My App",
    "companyName":    "My Company",
    "iconPath":       "app/chrome/skin/icon.ico",
    "appDir":         "app",
    "preferSystemFirefox": true
  }
}
```

> These are placeholders. The framework is `fxshell` (see `package.json#name`);
> the `fxshell.*` section is **your app's** identity — change it.

| key                  | default                       | meaning                                                                       |
|----------------------|-------------------------------|-------------------------------------------------------------------------------|
| `firefoxVersion`     | `99.0.1`                      | Pinned version for `npm run build` cache + download                          |
| `appName`            | `fxshell`                     | Used for exe basename, profile slot, `InternalName` version-info             |
| `displayName`        | = `appName`                   | Shown in window error dialogs, `FileDescription`, `ProductName`              |
| `companyName`        | = `displayName`               | `CompanyName` version-info                                                    |
| `iconPath`           | `app/chrome/skin/icon.ico`    | Used for window title bar AND patched into both exes via rcedit              |
| `appDir`             | `app`                         | Where `application.ini` and `chrome/` live                                   |
| `preferSystemFirefox`| `true`                        | `npm start` uses installed Firefox if found; `false` to always use cache     |

---

## What this is and isn't

- **Is**: a viable way to ship Mozilla-stack desktop apps today, on the
  installed-Firefox-99 (or pinned, downloaded) Gecko.
- **Isn't**: a port of XULRunner itself. XUL-as-layout is gone; you write
  HTML + CSS + JS for the UI. XPCOM JS components are gone; you use
  `ChromeUtils.importESModule` instead. RDF is gone.
- **Compatibility risk**: the `-app` flag is undocumented but still
  functional in FF 99. Mozilla *could* strip it in any future release.
  Pin a known-good version (default 99.0.1) and you control the upgrade.

---

## Roadmap

- [ ] macOS support (`.dmg` extraction, `csc.exe` → `dotnet build` or
      compiled Go stub, `.icns` for window/dock icons)
- [ ] Linux support (`tar.bz2` extraction, `.desktop` file generation)
- [ ] Inno Setup template for proper Windows installer with Start Menu /
      uninstall entries
- [ ] Pull out a reusable `create-fxshell` template for `npm init fxshell`
- [ ] Code-signing helpers
