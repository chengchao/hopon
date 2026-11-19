// What game.ts may import besides its own modules: esbuild's loaders in helpers.js. An image, sound or font is its URL
// next to the page, a stylesheet is linked by the page, and text is its value.
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.jpg" {
  const url: string;
  export default url;
}
declare module "*.jpeg" {
  const url: string;
  export default url;
}
declare module "*.gif" {
  const url: string;
  export default url;
}
declare module "*.webp" {
  const url: string;
  export default url;
}
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.mp3" {
  const url: string;
  export default url;
}
declare module "*.ogg" {
  const url: string;
  export default url;
}
declare module "*.opus" {
  const url: string;
  export default url;
}
declare module "*.woff2" {
  const url: string;
  export default url;
}
declare module "*.ttf" {
  const url: string;
  export default url;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
declare module "*.css";
