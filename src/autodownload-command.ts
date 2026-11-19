import { type AutoDownloadStore } from "./autodownload";
import { normalizeRequester } from "./cookies";
import type { WahaClientPort, WahaMessageEvent } from "./types";

export interface AutoDownloadCommandDeps {
  waha: WahaClientPort;
  autoDownloadStore?: AutoDownloadStore;
}

/**
 * Handles `/autodl` and `/autodownload` commands (`on`, `off`, `status`, toggle).
 */
export async function handleAutoDownloadCommand(
  deps: AutoDownloadCommandDeps,
  payload: WahaMessageEvent["payload"],
  chatId: string,
  text: string,
): Promise<void> {
  if (!deps.autoDownloadStore) {
    await deps.waha.sendText({
      chatId,
      text: "Fitur auto download belum dikonfigurasi.",
      replyTo: payload.id,
    });
    return;
  }

  const requester = normalizeRequester(payload);
  if (!requester) {
    await deps.waha.sendText({
      chatId,
      text: "Gagal mengidentifikasi nomor WhatsApp pengirim.",
      replyTo: payload.id,
    });
    return;
  }

  const [firstLine] = text.split(/\r?\n/);
  const args = (firstLine ?? "").trim().split(/\s+/).slice(1);
  const action = (args[0] || "").toLowerCase();

  if (action === "" || action === "toggle") {
    const newState = await deps.autoDownloadStore.toggle(payload);
    const replyText = newState
      ? "Auto download berhasil DIAKTIFKAN untuk nomor ini.\nSekarang Anda cukup mengirim link video langsung tanpa perlu mengetik /dl.\n\nKetik /autodl off untuk menonaktifkan."
      : "Auto download DINONAKTIFKAN untuk nomor ini.\nGunakan /dl <link> jika ingin mendownload video.\n\nKetik /autodl on untuk mengaktifkan kembali.";
    await deps.waha.sendText({
      chatId,
      text: replyText,
      replyTo: payload.id,
    });
    return;
  }

  if (
    action === "on" ||
    action === "aktif" ||
    action === "enable" ||
    action === "1"
  ) {
    await deps.autoDownloadStore.enable(payload);
    await deps.waha.sendText({
      chatId,
      text: "Auto download berhasil DIAKTIFKAN untuk nomor ini.\nSekarang Anda cukup mengirim link video langsung tanpa perlu mengetik /dl.\n\nKetik /autodl off untuk menonaktifkan.",
      replyTo: payload.id,
    });
    return;
  }

  if (
    action === "off" ||
    action === "nonaktif" ||
    action === "mati" ||
    action === "disable" ||
    action === "0"
  ) {
    await deps.autoDownloadStore.disable(payload);
    await deps.waha.sendText({
      chatId,
      text: "Auto download DINONAKTIFKAN untuk nomor ini.\nGunakan /dl <link> jika ingin mendownload video.\n\nKetik /autodl on untuk mengaktifkan kembali.",
      replyTo: payload.id,
    });
    return;
  }

  if (action === "status" || action === "cek" || action === "check") {
    const isEnabled = await deps.autoDownloadStore.isEnabled(payload);
    const replyText = isEnabled
      ? "Status auto download: AKTIF.\nLink video yang Anda kirim akan otomatis didownload tanpa /dl.\n\nKetik /autodl off untuk menonaktifkan."
      : "Status auto download: NONAKTIF.\n\nKetik /autodl on untuk mengaktifkan auto download link tanpa /dl.";
    await deps.waha.sendText({
      chatId,
      text: replyText,
      replyTo: payload.id,
    });
    return;
  }

  await deps.waha.sendText({
    chatId,
    text: "Penggunaan perintah auto download:\n• /autodl on — Aktifkan auto download tanpa /dl\n• /autodl off — Nonaktifkan auto download\n• /autodl status — Cek status auto download\n• /autodl — Toggle aktif / nonaktif",
    replyTo: payload.id,
  });
}
