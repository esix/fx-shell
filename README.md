# fx-shell

XULRunner-style desktop app shell built on top of a modern Firefox runtime.
Write your app as a chrome-privileged HTML / CSS / JS bundle and ship a
self-contained app — a Windows `.exe` or a macOS `.app`/`.dmg` — no Electron,
no fork, no rebuild of Gecko.

---

## Requirements

- **Node.js 18+** and **npm**
- **Windows 10 / 11** or **macOS 11+** (Linux is planned). Win64 + the
  universal macOS build are wired up.
- **For `npm start`:** by default it uses the pinned Firefox version, which it
  downloads to a cache on first run (~50 MB, once). Set
  `fxshell.preferSystemFirefox` to `true` to use your installed Firefox instead
  — faster, but only reliable if that's ~FF 99 (newer Firefox breaks `-app`).
- **For `npm run build` with the auto-downloaded pinned runtime:**
  - *Windows:* [7-Zip](https://www.7-zip.org/) (`winget install 7zip.7zip`) to
    extract the installer. Without it, the build falls back to your installed
    Firefox.
  - *macOS:* nothing extra — `hdiutil`, `sips`, `iconutil`, `codesign`, and
    `PlistBuddy` all ship with macOS. No Xcode / compiler required.

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
│       │   ├── shell.xhtml      ← XUL shell window: native menu bar, hosts ↓
│       │   ├── shell.js         ← menu wiring (Quit/⌘Q), window icon, shutdown
│       │   ├── main.xhtml       ← your UI — plain chrome HTML, run in the shell
│       │   ├── main.js          ← Services / IOUtils / nsIFilePicker / …
│       │   ├── greeter.jsm      ← classic JSM (FF < 102)
│       │   └── greeter.sys.mjs  ← modern ESM chrome module (FF 102+)
│       └── skin/
│           ├── main.css
│           └── icon.ico         ← window icon, exe icon (Win), .icns (macOS)
├── scripts/                     ← framework tooling (not the app)
│   ├── start.js                 ← `npm start`
│   ├── build.js                 ← `npm run build` (dispatches per platform)
│   └── lib/
│       ├── config.js            ← reads package.json#fxshell
│       ├── runtime.js           ← detect / download / extract Firefox (Win+mac)
│       ├── pack-win.js          ← Windows packager (exe launcher + runtime)
│       ├── pack-mac.js          ← macOS packager (.app/.dmg, ad-hoc signed)
│       ├── icns.js              ← .ico → .icns via sips/iconutil
│       ├── launcher.sh.template ← the macOS launcher (/bin/sh stub)
│       ├── tools.js             ← rcedit, csc.exe wrappers
│       ├── launcher.js          ← compiles the Windows native launcher stub
│       ├── launcher.cs.template ← the Windows launcher's C# source
│       ├── branding.js          ← icon + version-info via rcedit
│       └── fs-utils.js
├── profile/                     ← created by `npm start` (gitignored)
├── tools/                       ← auto-downloaded rcedit lives here (gitignored)
└── dist/                        ← `npm run build` output (gitignored)
```

---

## `npm start`

Launches your app against the **pinned, cached** Firefox runtime by default
(downloaded on first run), so dev matches what `npm run build` ships. Set
`fxshell.preferSystemFirefox: true` to use your **installed Firefox** instead
for a faster loop — safe only if it's ~FF 99. Forwards extra args to Gecko:

```sh
npm start                    # plain launch
npm start -- --jsconsole     # also open the Browser Console
npm start -- --jsdebugger    # attach the chrome debugger
```

The profile lives in `./profile/`.

---

## `npm run build`

Produces a self-contained distribution in `./dist/`. The layout and launcher
are platform-specific; the build runs for whichever OS you're on.

### Windows

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

### macOS

```
dist/
├── My App.app/        ← double-clickable bundle (ad-hoc signed)
│   └── Contents/
│       ├── Info.plist        rebranded: your name + icon, launcher executable
│       ├── MacOS/
│       │   ├── myapp          ← shell-script launcher (CFBundleExecutable)
│       │   └── firefox        ← bundled Gecko runtime + its dylibs/XUL
│       └── Resources/
│           ├── app/           ← copy of your app
│           └── myapp.icns     ← icon, converted from your .ico
├── My App.dmg         ← drag-to-Applications installer
└── README.txt
```

The launcher is a `/bin/sh` stub set as the bundle's `CFBundleExecutable`. On
double-click it runs invisibly (no Terminal window), picks a profile dir,
handles `--reset-profile`, then `exec`s the bundled `firefox` with the same
`-app … --no-remote --profile …` arguments. No compiler is needed at build
time — the `.icns` comes from `sips`/`iconutil` and the bundle is **ad-hoc
signed** with `codesign` so it launches (mandatory on Apple Silicon once
Mozilla's signed bundle is modified).

**Profile location** is chosen at runtime:

- If the app's folder is writable → `./profile` beside the `.app`.
- If not → `~/Library/Application Support/<appName>/profile`.

> **Gatekeeper / distribution.** Ad-hoc signing is enough to run on the build
> machine, and on others after clearing quarantine
> (`xattr -dr com.apple.quarantine "My App.app"` or right-click → Open once).
> Letting an arbitrary user download-and-run with zero friction needs a paid
> Apple **Developer ID** signature + **notarization** — see the roadmap.

> **Wrong/generic icon for `dist/My App.app` in Finder?** That's a Finder
> per-path icon-cache artifact from rebuilding to the same path — the bundle
> itself is correct (the running app, the `.dmg`, and a fresh copy all show
> your icon). To refresh the build-dir view: drag the `.app` somewhere and
> back, rename it, or run `killall Finder`. The shipped `.dmg` is unaffected.

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

**Windows:**

```sh
npm run build
Compress-Archive -Path dist\* -DestinationPath fxshell-windows.zip
```

~80–100 MB compressed. The recipient extracts, double-clicks the exe,
done — no Firefox install required on their machine.

**macOS:**

```sh
npm run build
# dist/My App.dmg is already the shippable artifact — hand it over directly.
```

The recipient opens the `.dmg` and drags the app to Applications (or just
double-clicks the `.app`). No Firefox install required. See the Gatekeeper
note above for the first-launch caveat on machines that didn't build it.

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
    "preferSystemFirefox": false
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
| `iconPath`           | `app/chrome/skin/icon.ico`    | Window title bar; patched into the exes via rcedit (Win) / converted to `.icns` for the bundle (macOS) |
| `appDir`             | `app`                         | Where `application.ini` and `chrome/` live                                   |
| `preferSystemFirefox`| `false`                       | `false` (default): `npm start` uses the pinned runtime, matching the build. `true`: use installed Firefox if found — faster, but only safe if it's ~FF 99 (newer Firefox breaks the native menu + privileged iframe under `-app`). |

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

### The window: a XUL shell hosting your HTML

`shell.xhtml` is a tiny XUL `<window>` that does two things you can't get from
a plain HTML chrome window:

- **The native macOS menu bar** (the top-of-screen menu with “Quit <App>” / ⌘Q).
  Gecko only builds it for a XUL window with a `<menubar>`. Your `<menuitem
  id="menu_FileQuitItem">` is automatically relocated into the application menu
  on macOS (which is why `File` keeps a separate *Close Window*).
- A privileged `<iframe>` that loads **your** UI (`main.xhtml`) — still plain
  chrome HTML/CSS/JS with full `Services`/`IOUtils`/… access. You edit
  `main.xhtml`; you rarely touch the shell.

> **Why this matters for the version pin.** On the pinned **FF 99** this works:
> the menu bar promotes and the hosted iframe stays chrome-privileged. On much
> newer Firefox (e.g. 147) under `-app`, both regress — the menu bar isn't
> built and the iframe loses privileges. So the 99.0.1 pin isn't just about the
> `-app` flag surviving; it's about the chrome/menu behaviour too.

---

## Roadmap

- [x] macOS support (`.dmg` extraction, `/bin/sh` launcher stub, `.icns` icon,
      `.app` + `.dmg` output, ad-hoc signing)
- [ ] Linux support (`tar.bz2` extraction, `.desktop` file generation)
- [ ] Inno Setup template for proper Windows installer with Start Menu /
      uninstall entries
- [ ] Pull out a reusable `create-fxshell` template for `npm init fxshell`
- [ ] Code-signing helpers (Windows Authenticode; macOS Developer ID +
      `notarytool` notarization for friction-free distribution)
