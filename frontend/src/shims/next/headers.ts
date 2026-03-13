// Shim for next/headers - not used in client-side code
export async function cookies() {
  return {
    get: (_name: string) => undefined,
    set: (_name: string, _value: string) => {},
    delete: (_name: string) => {},
  };
}

export async function headers() {
  return new Headers();
}
