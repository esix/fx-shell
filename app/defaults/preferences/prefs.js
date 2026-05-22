// Entry chrome window. Loaded by toolkit because we're in -app mode.
pref("toolkit.defaultChromeURI", "chrome://myapp/content/main.xhtml");
// Set an explicit, screen-safe initial size. Without width/height the
// window is sized to content, which on a tall card layout can exceed
// the screen and clip top + bottom.
pref("toolkit.defaultChromeFeatures",
     "chrome,resizable,centerscreen,dialog=no,width=900,height=700");

// Disable bits we don't need in an app shell.
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("app.update.enabled", false);
pref("app.update.auto", false);
pref("browser.shell.checkDefaultBrowser", false);
pref("extensions.autoDisableScopes", 15);
pref("extensions.enabledScopes", 0);

// Let our chrome page open file:// URIs and load local resources without
// CORS pain. This is what classic XULRunner apps got for free.
pref("security.fileuri.strict_origin_policy", false);

// Single-process makes early experimentation simpler (no e10s sandbox in
// child for chrome). Comment out to test with the default multi-process
// model once your app is working.
pref("dom.ipc.processCount", 1);
