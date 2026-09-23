declare module 'bwip-js' {
  interface BwipOptions {
    bcid: string;
    text: string;
    scale?: number;
    includetext?: boolean;
    textxalign?: string;
    textyalign?: string;
    padding?: number;
    backgroundcolor?: string;
    barcolor?: string;
    height?: number;
    widthratio?: number;
    eclevel?: string;
    [key: string]: any;
  }
  const bwipjs: {
    toCanvas(canvas: HTMLCanvasElement, opts: BwipOptions): void;
  };
  export default bwipjs;
}
