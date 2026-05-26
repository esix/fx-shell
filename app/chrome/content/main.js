// myapp — entry script for the privileged chrome window.
//
// Loaded by chrome://myapp/content/main.xhtml as a plain <script>. Because
// the host page is chrome-privileged, we have direct access to Components,
// Services, ChromeUtils, IOUtils, PathUtils — the same surface XULRunner apps
// got in 2010, minus XPCOM-in-JS components.

/* global Components, Services, ChromeUtils, IOUtils, PathUtils, Ci, Cc, Cu */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

// Services is auto-injected into chrome XUL windows, but NOT into chrome HTML
// windows like this one — we have to pull it in explicitly. ChromeUtils.import
// returns the JSM's exports object; destructure to bind `Services` locally.
//
// Try the modern ESM form first (FF 121+ ships Services.sys.mjs), fall back
// to the classic JSM (FF <121, including FF 99).
let Services;
try {
  ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
} catch (_) {
  ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
}

const $  = (id) => document.getElementById(id);
const log = (el, text) => { el.textContent = text; };

// Show uncaught errors directly in the page so the user doesn't need to open
// the Browser Console to see them.
function showError(prefix, err) {
  const bar = $("error-bar");
  if (!bar) return;
  bar.hidden = false;
  const msg = (err && err.message) ? err.message : String(err);
  const stack = (err && err.stack) ? "\n" + err.stack.split("\n").slice(0, 4).join("\n") : "";
  bar.textContent = `${prefix}: ${msg}${stack}`;
}
window.addEventListener("error", (e) => showError("Uncaught", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => showError("Unhandled rejection", e.reason));

// The native menu bar, the window icon, and app-quit are owned by the XUL
// shell window that hosts this page (see shell.xhtml / shell.js).

// ---------- runtime info ----------
function renderInfo() {
  const app   = Services.appinfo;
  const sys   = Cc["@mozilla.org/system-info;1"].getService(Ci.nsIPropertyBag2);
  const dirs  = Services.dirsvc;

  // nsIPropertyBag2.getProperty throws NS_ERROR_FAILURE when the key isn't
  // present (it does not return null). Wrap every access.
  const sysGet = (key) => {
    try { return sys.hasKey(key) ? sys.getProperty(key) : null; }
    catch (_) { return null; }
  };

  $("ff-version").textContent = app.version;

  const memBytes = sysGet("memsize");
  const osName   = sysGet("name") || sysGet("os") || "?";
  const osVer    = sysGet("version") || "";

  const rows = [
    ["App name",         app.name],
    ["App vendor",       app.vendor],
    ["App ID",           app.ID],
    ["Gecko version",    app.platformVersion],
    ["Gecko build ID",   app.platformBuildID],
    ["XPCOM ABI",        app.XPCOMABI],
    ["OS",               (osName + " " + osVer).trim()],
    ["Arch",             sysGet("arch") || "?"],
    ["CPU count",        sysGet("cpucount") ?? sysGet("cpu_count") ?? "?"],
    ["Memory (MB)",      memBytes ? Math.round(memBytes / 1024 / 1024) : "?"],
    ["Profile dir",      dirs.get("ProfD", Ci.nsIFile).path],
    ["App dir",          dirs.get("XCurProcD", Ci.nsIFile).path],
    ["Gecko dir",        dirs.get("GreD", Ci.nsIFile).path],
  ];

  const table = $("info");
  for (const [k, v] of rows) {
    const tr = document.createElement("tr");
    const tdk = document.createElement("td"); tdk.textContent = k;
    const tdv = document.createElement("td"); tdv.textContent = String(v);
    tr.append(tdk, tdv);
    table.append(tr);
  }
}

// ---------- file I/O ----------
function projectRootPath() {
  // XCurProcD is the dir containing application.ini (i.e. <project>/app);
  // climb one level to reach the project root.
  const xcurProc = Services.dirsvc.get("XCurProcD", Ci.nsIFile);
  return xcurProc.parent.path;
}

$("read-btn").addEventListener("click", async () => {
  const out = $("read-out");
  try {
    // XCurProcD is the dir containing application.ini — fetch our own
    // metadata file. Lives at <project>/app/application.ini in dev and
    // <dist>/app/application.ini in a packaged build, so it always exists.
    const appDir = Services.dirsvc.get("XCurProcD", Ci.nsIFile).path;
    const path = PathUtils.join(appDir, "application.ini");
    const bytes = await IOUtils.read(path);
    const text  = new TextDecoder("utf-8").decode(bytes);
    log(out, `Read ${bytes.byteLength} bytes from\n  ${path}\n\n──────\n${text}`);
  } catch (e) {
    log(out, "Error: " + e.message);
  }
});

$("enum-btn").addEventListener("click", async () => {
  const out = $("enum-out");
  out.replaceChildren();
  try {
    const root = projectRootPath();
    const entries = await IOUtils.getChildren(root);
    for (const entry of entries) {
      let label = PathUtils.filename(entry);
      try {
        const stat = await IOUtils.stat(entry);
        if (stat.type === "directory") {
          label += "/";
        } else {
          const kb = (stat.size / 1024).toFixed(1);
          label += `  —  ${kb} KB`;
        }
      } catch (_) { /* unreadable entry — show name only */ }
      const li = document.createElement("li");
      li.textContent = label;
      out.append(li);
    }
    if (!entries.length) {
      const li = document.createElement("li");
      li.textContent = "(empty)";
      out.append(li);
    }
  } catch (e) {
    const li = document.createElement("li");
    li.textContent = "Error: " + e.message;
    out.append(li);
  }
});

// ---------- OS file picker (native dialog) ----------
$("pick-btn").addEventListener("click", () => {
  const out = $("pick-out");
  try {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, "Pick any file", Ci.nsIFilePicker.modeOpen);
    fp.appendFilters(Ci.nsIFilePicker.filterAll);
    fp.open((result) => {
      if (result === Ci.nsIFilePicker.returnOK && fp.file) {
        out.textContent = fp.file.path;
      } else {
        out.textContent = "(cancelled)";
      }
    });
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});

// ---------- ES module loader (replaces XPCOM JS components) ----------
$("mod-btn").addEventListener("click", () => {
  const out = $("mod-out");
  try {
    // Try modern importESModule first (FF 102+), fall back to JSM (FF <102).
    let mod;
    if (ChromeUtils.importESModule) {
      try {
        mod = ChromeUtils.importESModule("chrome://myapp/content/greeter.sys.mjs");
      } catch (eMjs) {
        mod = ChromeUtils.import("chrome://myapp/content/greeter.jsm");
      }
    } else {
      mod = ChromeUtils.import("chrome://myapp/content/greeter.jsm");
    }
    const greeter = mod.Greeter || mod;
    const result = greeter.greet(Services.appinfo.name);
    log(out, result);
  } catch (e) {
    log(out, "Error: " + e.message + "\n" + (e.stack || ""));
  }
});

// ---------- quit ----------
// The in-page button just asks the host shell window to quit. ⌘Q and the menu
// Quit item are handled natively by the shell (shell.js); this page only needs
// to forward its own button. eForceQuit so nothing can veto the exit.
$("quit-btn").addEventListener("click", () => {
  try {
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  } catch (e) {
    showError("quit failed", e);
  }
});

renderInfo();
