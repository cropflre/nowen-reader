// Shim for next/font/google — returns a no-op font config
interface FontOptions {
  variable?: string;
  subsets?: string[];
  weight?: string | string[];
  display?: string;
}

interface FontResult {
  variable: string;
  className: string;
  style: { fontFamily: string };
}

function createFontShim(name: string) {
  return function (options: FontOptions = {}): FontResult {
    return {
      variable: options.variable || `--font-${name.toLowerCase()}`,
      className: "",
      style: { fontFamily: `${name}, system-ui, sans-serif` },
    };
  };
}

export const Geist = createFontShim("Geist");
export const Geist_Mono = createFontShim("Geist Mono");
export const Inter = createFontShim("Inter");
export const Roboto = createFontShim("Roboto");
export const Roboto_Mono = createFontShim("Roboto Mono");
