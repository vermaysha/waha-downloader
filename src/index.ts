import { R2Archive } from "./archive";
import { loadConfig } from "./config";
import { YtDlpDownloader } from "./downloader";
import { createMessageHandler } from "./handler";
import { WahaClient, connectWahaWebSocket } from "./waha";

async function main(): Promise<void> {
  const config = loadConfig();
  const waha = new WahaClient(config.waha);
  const downloader = new YtDlpDownloader();
  const archive = new R2Archive(config.r2);

  await waha.ensureSessionStarted();
  console.log(`WAHA session "${config.waha.session}" is ready.`);

  const handleEvent = createMessageHandler({
    waha,
    downloader,
    archive,
    downloadConcurrency: config.downloadConcurrency,
    maxWhatsappMediaBytes: config.maxWhatsappMediaBytes,
    tmpDir: config.tmpDir,
    cookiesDir: config.cookiesDir,
    logger: console,
  });

  const listener = connectWahaWebSocket({
    config: config.waha,
    onEvent: handleEvent,
    logger: console,
    onError: (err) => {
      console.error("WAHA WebSocket / handler error:", err);
    },
  });

  const shutdown = () => {
    listener.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
