export function formatAppVersion(value: string | null | undefined): string {
  const version = value?.trim() ?? "";
  if (!version) return "...";

  const withoutPrefix = version.replace(/^v+/i, "");
  if (/^\d/.test(withoutPrefix)) {
    return `v${withoutPrefix}`;
  }

  return version;
}
