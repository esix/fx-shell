// Classic JSM module — the format Firefox 99 understands.
// On modern Firefox (102+) the preferred format is greeter.sys.mjs.
// main.js falls back to this file automatically when the .mjs load fails.

var EXPORTED_SYMBOLS = ["Greeter"];

const Greeter = {
  greet(name) {
    const now = new Date().toISOString();
    return `Hello, ${name}!\n` +
           `This message was produced by greeter.jsm, loaded via\n` +
           `ChromeUtils.import("chrome://myapp/content/greeter.jsm").\n\n` +
           `Time: ${now}\n` +
           `This is what XPCOM-in-JS components became: a plain ES module\n` +
           `living behind a chrome:// URL, importable from any chrome script.`;
  },
};
