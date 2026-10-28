/** Disposable browser-test server. Never loads the operator's environment credentials or data. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
const port = 8788;
const dataDir = mkdtempSync(join(tmpdir(), "sticker-browser-fixture-"));
const instance = createApp({
  dataDir,
  ownerPassword: "ephemeral-sticker-test-password",
  appOrigin: `http://127.0.0.1:${port}`,
  clientDir: "dist/client",
});
const server = instance.app.listen(port, "127.0.0.1", () =>
  console.log(`Disposable Sticker test fixture: http://127.0.0.1:${port}`),
);
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  server.close(() => {
    instance.close();
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
server.on("error", (error) => {
  instance.close();
  rmSync(dataDir, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
