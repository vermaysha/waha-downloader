import { type CookieProfileStore, normalizeDomain } from "./cookies";
import type { WahaClientPort, WahaMessageEvent } from "./types";

export interface CookiesCommandDeps {
  waha: WahaClientPort;
  cookieStore?: CookieProfileStore;
}

/**
 * Handles `/cookies` subcommands (`list`, `del <domain>`, and `<domain>` upload/inline save).
 */
export async function handleCookiesCommand(
  deps: CookiesCommandDeps,
  payload: WahaMessageEvent["payload"],
  chatId: string,
  text: string,
): Promise<void> {
  if (!deps.cookieStore) {
    await deps.waha.sendText({
      chatId,
      text: "Cookie storage is not configured.",
      replyTo: payload.id,
    });
    return;
  }

  const [firstLine, ...restLines] = text.split(/\r?\n/);
  const args = (firstLine ?? "").trim().split(/\s+/).slice(1);
  const subcommand = args[0] ?? "";

  if (subcommand === "list" && args.length === 1) {
    const domains = await deps.cookieStore.list(payload);
    const replyText =
      domains.length > 0
        ? `Stored Cookie Profiles:\n${domains.map((d) => `- ${d}`).join("\n")}`
        : "No Cookie Profiles stored.";
    await deps.waha.sendText({
      chatId,
      text: replyText,
      replyTo: payload.id,
    });
    return;
  }

  if (subcommand === "del") {
    const targetDomain = args[1] ?? "";
    const result = await deps.cookieStore.delete(payload, targetDomain);
    const replyText =
      result.status === "deleted"
        ? `Deleted Cookie Profile for ${result.domain}.`
        : result.status === "not_found"
          ? `No Cookie Profile found for ${result.domain}.`
          : `Invalid domain "${targetDomain}".`;
    await deps.waha.sendText({
      chatId,
      text: replyText,
      replyTo: payload.id,
    });
    return;
  }

  const rawDomain = subcommand;
  if (!rawDomain) {
    await deps.waha.sendText({
      chatId,
      text: "Usage: /cookies <domain>, /cookies list, or /cookies del <domain>.",
      replyTo: payload.id,
    });
    return;
  }

  const normalizedDomain = normalizeDomain(rawDomain);
  if (!normalizedDomain) {
    await deps.waha.sendText({
      chatId,
      text: `Invalid domain "${rawDomain}".`,
      replyTo: payload.id,
    });
    return;
  }

  let cookieContent: string | null = null;
  const mediaUrl = payload.media?.url?.trim();
  if (mediaUrl) {
    const filename = payload.media?.filename;
    if (filename && !filename.toLowerCase().endsWith(".txt")) {
      await deps.waha.sendText({
        chatId,
        text: "Cookie attachment must be a .txt Netscape cookie file.",
        replyTo: payload.id,
      });
      return;
    }

    try {
      cookieContent = await deps.waha.downloadMedia(mediaUrl);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown error occurred";
      await deps.waha.sendText({
        chatId,
        text: `Failed to download cookie attachment: ${reason}`,
        replyTo: payload.id,
      });
      return;
    }
  } else if (payload.hasMedia || payload.media) {
    await deps.waha.sendText({
      chatId,
      text: "Cookie attachment URL is unavailable. Please re-upload the .txt file or paste the cookie text inline.",
      replyTo: payload.id,
    });
    return;
  } else {
    const inlineContent = restLines.join("\n").trim();
    if (inlineContent) {
      cookieContent = `${inlineContent}\n`;
    }
  }

  if (!cookieContent) {
    await deps.waha.sendText({
      chatId,
      text: `Please attach a .txt Netscape cookie file or include cookie lines after "/cookies ${normalizedDomain}".`,
      replyTo: payload.id,
    });
    return;
  }

  const savedDomain = await deps.cookieStore.save(
    payload,
    normalizedDomain,
    cookieContent,
  );
  if (!savedDomain) {
    await deps.waha.sendText({
      chatId,
      text: `Invalid domain "${rawDomain}".`,
      replyTo: payload.id,
    });
    return;
  }

  await deps.waha.sendText({
    chatId,
    text: `Saved Cookie Profile for ${savedDomain}.`,
    replyTo: payload.id,
  });
}
