// fxshell shell window: owns the native menu bar, the window icon, and
// app shutdown. The actual UI runs in the hosted <iframe> (main.xhtml).

/* global Components, ChromeUtils */

const { classes: Cc, interfaces: Ci } = Components;

// Pull in Services (modern ESM form first, classic JSM fallback for FF < 121).
let Services;
try {
  ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
} catch (_) {
  ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
}

// ---------- quit ----------
// eForceQuit (not eAttemptQuit) so nothing can veto the exit, and a re-entry
// guard because closing the window fires unload while we're already quitting.
let quitting = false;
function quitApp() {
  if (quitting) return;
  quitting = true;
  try {
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  } catch (e) {
    quitting = false;
    try { console.error("fxshell quit failed:", e); } catch (_) { /* ignore */ }
    try { window.close(); } catch (_) { /* ignore */ }
  }
}

// Wire the native menu. menu_FileQuitItem is relocated into the macOS
// application menu and bound to ⌘Q; menu_close stays in File as Close Window.
window.addEventListener("DOMContentLoaded", () => {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("command", fn); };
  const quitItem = document.getElementById("menu_FileQuitItem");
  if (quitItem) quitItem.setAttribute("label", "Quit " + Services.appinfo.name);
  on("menu_FileQuitItem", quitApp);
  on("key_quit", quitApp);
  on("menu_close", () => window.close());
  on("key_close", () => window.close());
});

// Closing the window quits the app. macOS keeps an app alive after its last
// window closes, which for a single-window shell means no way out otherwise.
window.addEventListener("unload", quitApp);

// ---------- window icon ----------
// macOS gets its title-bar/Dock icon from the bundle's .icns. On Windows the
// chrome window would otherwise show the host exe's icon resource, so push our
// own explicitly.
async function applyWindowIcon(iconUrl) {
  if (Services.appinfo.OS !== "WINNT") return;  // Win-only API
  try {
    const winUtils = Cc["@mozilla.org/windows-ui-utils;1"]
                       .getService(Ci.nsIWindowsUIUtils);
    const arrayBuf = await (await fetch(iconUrl)).arrayBuffer();
    const imgTools = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools);
    const container = imgTools.decodeImageFromArrayBuffer(
      arrayBuf, "image/vnd.microsoft.icon");
    winUtils.setWindowIcon(window, container, container);
  } catch (_) { /* non-fatal */ }
}

applyWindowIcon("chrome://myapp/skin/icon.ico");
