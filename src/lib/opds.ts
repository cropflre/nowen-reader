import { Builder } from "xml2js";

const OPDS_NS = "http://www.w3.org/2005/Atom";
const OPDS_CATALOG_NS = "http://opds-spec.org/2010/catalog";
const OPDS_MIME = "application/atom+xml;profile=opds-catalog;kind=navigation";
const OPDS_ACQUISITION_MIME = "application/atom+xml;profile=opds-catalog;kind=acquisition";

interface OPDSComic {
  id: string;
  title: string;
  author?: string;
  description?: string;
  language?: string;
  genre?: string;
  publisher?: string;
  year?: number;
  pageCount: number;
  addedAt: string;
  updatedAt: string;
  tags: { name: string }[];
  filename: string;
}

const builder = new Builder({
  xmldec: { version: "1.0", encoding: "UTF-8" },
  renderOpts: { pretty: true, indent: "  " },
});

function getBaseUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.protocol}//${url.host}`;
}

/**
 * Generate the OPDS root catalog (navigation feed)
 */
export function generateRootCatalog(baseUrl: string): string {
  const now = new Date().toISOString();

  const feed = {
    feed: {
      $: {
        xmlns: OPDS_NS,
        "xmlns:opds": OPDS_CATALOG_NS,
      },
      id: `${baseUrl}/api/opds`,
      title: "NowenReader OPDS Catalog",
      updated: now,
      author: {
        name: "NowenReader",
        uri: baseUrl,
      },
      link: [
        {
          $: {
            rel: "self",
            href: "/api/opds",
            type: OPDS_MIME,
          },
        },
        {
          $: {
            rel: "start",
            href: "/api/opds",
            type: OPDS_MIME,
          },
        },
        {
          $: {
            rel: "search",
            href: "/api/opds/search?q={searchTerms}",
            type: OPDS_ACQUISITION_MIME,
          },
        },
      ],
      entry: [
        {
          title: "All Comics",
          id: `${baseUrl}/api/opds/all`,
          updated: now,
          content: {
            $: { type: "text" },
            _: "Browse all comics in the library",
          },
          link: {
            $: {
              rel: "subsection",
              href: "/api/opds/all",
              type: OPDS_ACQUISITION_MIME,
            },
          },
        },
        {
          title: "Recently Added",
          id: `${baseUrl}/api/opds/recent`,
          updated: now,
          content: {
            $: { type: "text" },
            _: "Recently added comics",
          },
          link: {
            $: {
              rel: "subsection",
              href: "/api/opds/recent",
              type: OPDS_ACQUISITION_MIME,
            },
          },
        },
        {
          title: "Favorites",
          id: `${baseUrl}/api/opds/favorites`,
          updated: now,
          content: {
            $: { type: "text" },
            _: "Favorite comics",
          },
          link: {
            $: {
              rel: "subsection",
              href: "/api/opds/favorites",
              type: OPDS_ACQUISITION_MIME,
            },
          },
        },
      ],
    },
  };

  return builder.buildObject(feed);
}

/**
 * Generate an acquisition feed from a list of comics
 */
export function generateAcquisitionFeed(
  baseUrl: string,
  title: string,
  feedId: string,
  comics: OPDSComic[],
  selfHref: string
): string {
  const now = new Date().toISOString();

  const entries = comics.map((comic) => {
    const ext = comic.filename.split(".").pop()?.toLowerCase() || "zip";
    const mimeType = getMimeTypeForExtension(ext);

    const entry: Record<string, unknown> = {
      title: comic.title,
      id: `urn:nowen:${comic.id}`,
      updated: comic.updatedAt,
      published: comic.addedAt,
      content: {
        $: { type: "text" },
        _: comic.description || `${comic.pageCount} pages`,
      },
      link: [
        {
          $: {
            rel: "http://opds-spec.org/image",
            href: `/api/comics/${comic.id}/thumbnail`,
            type: "image/webp",
          },
        },
        {
          $: {
            rel: "http://opds-spec.org/image/thumbnail",
            href: `/api/comics/${comic.id}/thumbnail`,
            type: "image/webp",
          },
        },
        {
          $: {
            rel: "http://opds-spec.org/acquisition",
            href: `/api/opds/download/${comic.id}`,
            type: mimeType,
          },
        },
        {
          $: {
            rel: "http://opds-spec.org/acquisition/open-access",
            href: `/api/comics/${comic.id}/page/0`,
            type: "image/jpeg",
          },
        },
      ],
    };

    if (comic.author) {
      entry.author = { name: comic.author };
    }

    if (comic.tags && comic.tags.length > 0) {
      entry.category = comic.tags.map((t) => ({
        $: { term: t.name, label: t.name },
      }));
    }

    if (comic.language) {
      entry["dc:language"] = comic.language;
    }

    return entry;
  });

  const feed = {
    feed: {
      $: {
        xmlns: OPDS_NS,
        "xmlns:opds": OPDS_CATALOG_NS,
        "xmlns:dc": "http://purl.org/dc/elements/1.1/",
      },
      id: feedId,
      title,
      updated: now,
      link: [
        {
          $: {
            rel: "self",
            href: selfHref,
            type: OPDS_ACQUISITION_MIME,
          },
        },
        {
          $: {
            rel: "start",
            href: "/api/opds",
            type: OPDS_MIME,
          },
        },
        {
          $: {
            rel: "search",
            href: "/api/opds/search?q={searchTerms}",
            type: OPDS_ACQUISITION_MIME,
          },
        },
      ],
      entry: entries,
    },
  };

  return builder.buildObject(feed);
}

function getMimeTypeForExtension(ext: string): string {
  switch (ext) {
    case "cbz":
    case "zip":
      return "application/x-cbz";
    case "cbr":
    case "rar":
      return "application/x-cbr";
    case "cb7":
    case "7z":
      return "application/x-cb7";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

export { OPDS_MIME, OPDS_ACQUISITION_MIME, getBaseUrl };
