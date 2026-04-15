/// <reference types="vite/client" />

declare module '*.lua?raw' {
  const content: string;
  export default content;
}
