export type ReadingMode = "single" | "double" | "webtoon";
export type ReadingDirection = "ltr" | "rtl"; // left-to-right or right-to-left (manga style)

export interface ReaderSettings {
  mode: ReadingMode;
  direction: ReadingDirection;
  fitMode: "width" | "height" | "contain";
  showPageNumber: boolean;
}

export const defaultReaderSettings: ReaderSettings = {
  mode: "single",
  direction: "ltr",
  fitMode: "contain",
  showPageNumber: true,
};
