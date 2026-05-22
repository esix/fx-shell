// Modern ESM-style chrome module — used on Firefox 102+.
// On Firefox <102 main.js falls back to greeter.jsm.

export const Greeter = {
  greet(name) {
    const now = new Date().toISOString();
    return `Hello, ${name}!\n` +
           `This message was produced by greeter.sys.mjs, loaded via\n` +
           `ChromeUtils.importESModule("chrome://myapp/content/greeter.sys.mjs").\n\n` +
           `Time: ${now}\n` +
           `This is the modern (FF 102+) chrome-module format.`;
  },
};
