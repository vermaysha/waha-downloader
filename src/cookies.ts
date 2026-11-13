import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { WahaMessagePayload } from "./types";

const WHATSAPP_JID_SUFFIX_RE = /@(c\.us|lid|s\.whatsapp\.net)$/i;
const VALID_DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

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
 * Validates and normalizes a raw domain argument (lowercase, leading `www.` stripped).
 * Rejects empty strings, paths, and traversal sequences.
 */
export function normalizeCookieDomain(rawDomain: string): string | null {
  const trimmed = rawDomain.trim();
  if (
    !trimmed ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    /\s/.test(trimmed)
  ) {
    return null;
  }

  const normalized = trimmed.toLowerCase().replace(/^www\./, "");
  if (!VALID_DOMAIN_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function resolveRequesterDir(
  cookiesDir: string,
  payload: Pick<WahaMessagePayload, "from" | "participant">,
): string | null {
  const requester = normalizeRequester(payload);
  if (!requester) {
    return null;
  }
  const rootDir = resolve(cookiesDir);
  const requesterDir = resolve(rootDir, requester);
  if (!requesterDir.startsWith(`${rootDir}${sep}`)) {
    return null;
  }
  return requesterDir;
}

function resolveCookieFileTarget(
  cookiesDir: string,
  payload: Pick<WahaMessagePayload, "from" | "participant">,
  rawDomain: string,
): { domain: string; requesterDir: string; filePath: string } | null {
  const requesterDir = resolveRequesterDir(cookiesDir, payload);
  const domain = normalizeCookieDomain(rawDomain);
  if (!requesterDir || !domain) {
    return null;
  }
  const filePath = resolve(requesterDir, `${domain}.txt`);
  if (!filePath.startsWith(`${requesterDir}${sep}`)) {
    return null;
  }
  return { domain, requesterDir, filePath };
}

/**
 * Saves a Requester's Cookie Profile for a validated, normalized domain.
 */
export async function saveCookieProfile(
  cookiesDir: string,
  payload: Pick<WahaMessagePayload, "from" | "participant">,
  rawDomain: string,
  content: string,
): Promise<string | null> {
  const target = resolveCookieFileTarget(cookiesDir, payload, rawDomain);
  if (!target) {
    return null;
  }
  await mkdir(target.requesterDir, { recursive: true });
  await writeFile(target.filePath, content, "utf8");
  return target.domain;
}

/**
 * Lists normalized domains for all Cookie Profiles stored for a Requester.
 */
export async function listCookieProfiles(
  cookiesDir: string,
  payload: Pick<WahaMessagePayload, "from" | "participant">,
): Promise<string[]> {
  const requesterDir = resolveRequesterDir(cookiesDir, payload);
  if (!requesterDir) {
    return [];
  }

  try {
    const entries = await readdir(requesterDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
      .map((entry) => entry.name.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

export type DeleteCookieResult =
  | { status: "deleted"; domain: string }
  | { status: "not_found"; domain: string }
  | { status: "invalid" };

/**
 * Deletes a Requester's Cookie Profile for a validated, normalized domain.
 */
export async function deleteCookieProfile(
  cookiesDir: string,
  payload: Pick<WahaMessagePayload, "from" | "participant">,
  rawDomain: string,
): Promise<DeleteCookieResult> {
  const target = resolveCookieFileTarget(cookiesDir, payload, rawDomain);
  if (!target) {
    return { status: "invalid" };
  }

  try {
    await stat(target.filePath);
    await rm(target.filePath);
    return { status: "deleted", domain: target.domain };
  } catch {
    return { status: "not_found", domain: target.domain };
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
