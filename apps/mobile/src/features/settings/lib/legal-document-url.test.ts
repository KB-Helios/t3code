import { describe, expect, it } from "vite-plus/test";

import { isLegalDocumentUrl } from "./legal-document-url";

describe("isLegalDocumentUrl", () => {
  it.each([
    "https://github.com/KB-Helios/t3code/blob/main/LICENSE",
    "https://github.com/KB-Helios/t3code/blob/main/LICENSE?source=app",
    "https://github.com/KB-Helios/t3code/security#reporting",
  ])("allows a configured legal document: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(true);
  });

  it.each([
    "https://t3.codes/legal",
    "https://github.com/KB-Helios/t3code/issues",
    "https://example.com/legal",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects a URL outside the legal-document allowlist: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(false);
  });
});
