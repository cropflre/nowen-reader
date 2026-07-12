import "pdfjs-dist";

declare module "pdfjs-dist" {
  interface PDFDocumentLoadingTask {
    onProgress: ((progress: { loaded: number; total: number }) => void) | null;
  }
}
