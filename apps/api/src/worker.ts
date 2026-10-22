// The Worker's entry point: the API, plus the classes Cloudflare binds by export name. index.ts stays importable in
// Node, where the tests run it; these need `cloudflare:workers`.
export { ContainerProxy } from "@cloudflare/containers";
export { Coder } from "./coder.ts";
export { default } from "./index.ts";
