// Test-only preload: lets node load modules guarded by `import "server-only"` (Next.js enforces that guard at build time).
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "server-only" ? require.resolve("./empty.cjs") : orig.call(this, req, ...rest); };
