/** Repeated tags parameters preserve punctuation such as colons, ampersands and plus signs. */
export function tagFilterHref(name: string): string {
  return `/books?${new URLSearchParams({ tags: name })}`;
}

export function readTagFilters(search: string): string[] | null {
  const params = new URLSearchParams(search);
  if (!params.has("tags")) return null;
  return [...new Set(params.getAll("tags").flatMap((value) => value.split(","))
    .map((name) => name.trim()).filter(Boolean))];
}
