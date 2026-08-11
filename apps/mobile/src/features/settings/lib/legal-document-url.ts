const REPOSITORY_LICENSE_URL = "https://github.com/KB-Helios/t3code/blob/main/LICENSE";
const REPOSITORY_SECURITY_URL = "https://github.com/KB-Helios/t3code/security";

function resolveMarketingSiteUrl(override: string | undefined): URL | null {
  if (!override?.trim()) return null;
  try {
    const url = new URL(override.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
  } catch {
    return null;
  }
}

const MARKETING_SITE_URL = resolveMarketingSiteUrl(process.env.EXPO_PUBLIC_MARKETING_SITE_URL);

function marketingSiteDocumentUrl(path: string, fallback: string): string {
  return MARKETING_SITE_URL === null ? fallback : new URL(path, MARKETING_SITE_URL).toString();
}

export const PRIVACY_POLICY_URL = marketingSiteDocumentUrl(
  "privacy-policy",
  REPOSITORY_LICENSE_URL,
);
export const SECURITY_POLICY_URL = marketingSiteDocumentUrl(
  "security-policy",
  REPOSITORY_SECURITY_URL,
);
export const TERMS_OF_SERVICE_URL = marketingSiteDocumentUrl(
  "terms-of-service",
  REPOSITORY_LICENSE_URL,
);
export const LEGAL_URL = marketingSiteDocumentUrl("legal", REPOSITORY_LICENSE_URL);

export const ALLOWED_LEGAL_DOCUMENT_URLS = [
  LEGAL_URL,
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
  SECURITY_POLICY_URL,
] as const;

function webDocumentIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

const ALLOWED_LEGAL_DOCUMENT_IDENTITIES = new Set(
  ALLOWED_LEGAL_DOCUMENT_URLS.map(webDocumentIdentity).filter(
    (value): value is string => value !== null,
  ),
);

export function isLegalDocumentUrl(value: string): boolean {
  const identity = webDocumentIdentity(value);
  return identity !== null && ALLOWED_LEGAL_DOCUMENT_IDENTITIES.has(identity);
}
