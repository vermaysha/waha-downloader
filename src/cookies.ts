import { copyFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { WahaMessagePayload } from "./types";

const WHATSAPP_JID_SUFFIX_RE = /@(c\.us|lid|s\.whatsapp\.net)$/i;

/**
 * Extracts and normalizes the Requester's phone number from DM or group payloads.
 */
export function normalizeRequester(
  payload: Pick<WahaMessagePayload, "from" | "participant">,
): string | null {
  const raw = payload.participant?.trim() || payload.from?.trim();
  if (!raw) {
    return null;
  }
  const stripped = raw.replace(WHATSAPP_JID_SUFFIX_RE, "").trim();
  if (!stripped || stripped.includes("/") || stripped.includes("\\") || stripped.includes("..")) {
    return null;
  }
  return stripped;
}

/**
 * Extracts and normalizes the target URL's domain (lowercase, leading `www.` stripped).
 */
export function normalizeDomain(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.includes("/") || host.includes("\\") || host.includes("..")) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

/**
 * Resolves the stored Cookie Profile path for a Requester and domain if it exists on disk.
 */
export async function resolveCookieProfilePath(
  cookiesDir: string,
  payload: Pick<WahaMessagePayload, "from" | "participant">,
  url: string,
): Promise<string | null> {
  const requester = normalizeRequester(payload);
  const domain = normalizeDomain(url);
  if (!requester || !domain) {
    return null;
  }

  const rootDir = resolve(cookiesDir);
  const candidate = resolve(rootDir, requester, `${domain}.txt`);
  if (!candidate.startsWith(`${rootDir}${sep}`)) {
    return null;
  }

  try {
    const info = await stat(candidate);
    return info.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Copies a stored Cookie Profile to a unique per-job temporary file (ADR-0001).
 */
export async function createTempCookieCopy(
  profilePath: string,
  tmpDir: string,
): Promise<string> {
  const tempCookiePath = join(tmpDir, `cookies-${crypto.randomUUID()}.txt`);
  await copyFile(profilePath, tempCookiePath);
  return tempCookiePath;
}
