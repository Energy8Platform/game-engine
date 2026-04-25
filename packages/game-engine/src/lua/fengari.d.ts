declare module 'fengari' {
  const fengari: {
    lua: any;
    lauxlib: any;
    lualib: any;
    to_luastring: (str: string) => Uint8Array;
    to_jsstring: (str: Uint8Array) => string;
  };
  export default fengari;
}
