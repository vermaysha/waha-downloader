import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { WahaMessagePayload } from "./types";

const WHATSAPP_JID_SUFFIX_RE = /@(c\.us|lid|s\.whatsapp\.net)$/i;
const VALID_DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type RequesterPayload = Pick<WahaMessagePayload, "from" | "participant">;

export type DeleteCookieResult =
  | { status: "deleted"; domain: string }
  | { status: "not_found"; domain: string }
  | { status: "invalid" };

export interface CookieProfileStore {
  save(
    payload: RequesterPayload,
    rawDomain: string,
    content: string,
  ): Promise<string | null>;
  list(payload: RequesterPayload): Promise<string[]>;
  delete(
    payload: RequesterPayload,
    rawDomain: string,
  ): Promise<DeleteCookieResult>;
  resolvePathForUrl(
    payload: RequesterPayload,
    url: string,
  ): Promise<string | null>;
}

/**
 * Extracts and normalizes the Requester's phone number from DM or group payloads.
 */
export function normalizeRequester(payload: RequesterPayload): string | null {
  const raw = payload.participant?.trim() || payload.from?.trim();
  if (!raw) {
    return null;
  }
  const stripped = raw.replace(WHATSAPP_JID_SUFFIX_RE, "").trim();
  if (
    !stripped ||
    stripped.includes("/") ||
    stripped.includes("\\") ||
    stripped.includes("..")
  ) {
    return null;
  }
  return stripped;
}

/**
 * Validates and normalizes a domain or hostname (lowercase, leading `www.` stripped).
 * Rejects empty strings, paths, and traversal sequences.
 */
export function normalizeDomain(rawDomain: string): string | null {
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

/**
 * Extracts and normalizes the target URL's domain (lowercase, leading `www.` stripped).
 */
export function extractNormalizedDomain(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return normalizeDomain(parsed.hostname);
  } catch {
    return null;
  }
}

/**
 * Creates a Cookie Profile store scoped to a root `cookiesDir` directory.
 */
export function createCookieStore(cookiesDir: string): CookieProfileStore {
  const rootDir = resolve(cookiesDir);

  function resolveRequesterDir(payload: RequesterPayload): string | null {
    const requester = normalizeRequester(payload);
    if (!requester) {
      return null;
    }
    const requesterDir = resolve(rootDir, requester);
    if (!requesterDir.startsWith(`${rootDir}${sep}`)) {
      return null;
    }
    return requesterDir;
  }

  function resolveCookieFileTarget(
    payload: RequesterPayload,
    rawDomain: string,
  ): { domain: string; requesterDir: string; filePath: string } | null {
    const requesterDir = resolveRequesterDir(payload);
    const domain = normalizeDomain(rawDomain);
    if (!requesterDir || !domain) {
      return null;
    }
    const filePath = resolve(requesterDir, `${domain}.txt`);
    if (!filePath.startsWith(`${requesterDir}${sep}`)) {
      return null;
    }
    return { domain, requesterDir, filePath };
  }

  return {
    async save(payload, rawDomain, content) {
      const target = resolveCookieFileTarget(payload, rawDomain);
      if (!target) {
        return null;
      }
      await mkdir(target.requesterDir, { recursive: true });
      await writeFile(target.filePath, content, "utf8");
      return target.domain;
    },

    async list(payload) {
      const requesterDir = resolveRequesterDir(payload);
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
    },

    async delete(payload, rawDomain) {
      const target = resolveCookieFileTarget(payload, rawDomain);
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
    },

    async resolvePathForUrl(payload, url) {
      const domain = extractNormalizedDomain(url);
      if (!domain) {
        return null;
      }
      const target = resolveCookieFileTarget(payload, domain);
      if (!target) {
        return null;
      }

      try {
        const info = await stat(target.filePath);
        return info.isFile() ? target.filePath : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Copies a stored Cookie Profile to a unique temporary file (ADR-0001).
 */
export async function createTempCookieCopy(
  profilePath: string,
  tmpDir: string,
): Promise<string> {
  const tempCookiePath = join(tmpDir, `cookies-${crypto.randomUUID()}.txt`);
  await copyFile(profilePath, tempCookiePath);
  return tempCookiePath;
}
