/// <reference lib="dom" />

// Minimal node:* declarations for IDE type resolution (Deno provides these natively)
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:fs" {
  export function existsSync(path: string | URL | number): boolean;
  export function copyFileSync(src: string | URL, dest: string | URL): void;
}

// @std/assert declarations for IDE type resolution (Deno resolves via import map)
declare module "@std/assert" {
  export function assert(condition: unknown, msg?: string): asserts condition;
  export function assertEquals(
    actual: unknown,
    expected: unknown,
    msg?: string,
  ): void;
}
