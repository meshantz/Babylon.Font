import * as loader from '@assemblyscript/loader'

//
// Opentypejs PathCommand interface
//

interface IPathCommand {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

//
// API
//

type Header = {
  compile(bytesUsed: number, fmt: string, ppc: number, eps: number): number;
};
type Instaniated = loader.ResultObject & {
  exports: loader.ASUtil & Header
};

//
// Shape - Compiled result
//

type Vertex = [number, number];
type Polygon = Vertex[];
export type Shape = {
  fill: Polygon;
  holes: Polygon[];
};

//
// Compiler
//

export class Compiler {

  constructor(
    private wasm: Instaniated
  ) { }

  static async Build(wasmUrl?: string) {
    wasmUrl ??= new URL('optimized.wasm', import.meta.url).toString();

    const imports = {
      // env: {
      //   abort(_msg, _file, line, column) {
      //     console.error("abort called at" + line + ":" + column);
      //   },
      // },
    };

    const wasm = await loader.instantiate<Header>(fetch(wasmUrl), imports);
    return new Compiler(wasm);
  }

  bytesForCommand(cmd: IPathCommand) {
    let b = 1
    switch (cmd.type) {
      case 'M':
      case 'L':
        b += 16
        break
      case 'Q':
        b += 48
        break
      case 'C':
        b += 64
        break
    }
    return b
  }

  //
  // Encode OpentypeJS IPathCommand[], put into {buffer}
  //

  encode(cmds: IPathCommand[], buffer: ArrayBuffer) {

    const view = new DataView(buffer);

    let i = 0;
    let x = 0;
    let y = 0;

    const M = 'M'.codePointAt(0);
    const L = 'L'.codePointAt(0);
    const Q = 'Q'.codePointAt(0);
    const C = 'C'.codePointAt(0);

    for (const cmd of cmds) {
      let code = cmd.type.codePointAt(0);
      view.setUint8(i, code);
      i++;

      switch (code) {
        case M:
        case L:
          view.setFloat64(i, cmd.x, true);
          i += 8;
          view.setFloat64(i, cmd.y, true);
          i += 8;
          x = cmd.x;
          y = cmd.y;
          break;
        case Q:
          view.setFloat64(i, x, true);
          i += 8;
          view.setFloat64(i, y, true);
          i += 8;
          view.setFloat64(i, cmd.x1, true);
          i += 8;
          view.setFloat64(i, cmd.y1, true);
          i += 8;
          view.setFloat64(i, cmd.x, true);
          i += 8;
          view.setFloat64(i, cmd.y, true);
          i += 8;
          x = cmd.x;
          y = cmd.y;
          break;
        case C:
          view.setFloat64(i, x, true);
          i += 8;
          view.setFloat64(i, y, true);
          i += 8;
          view.setFloat64(i, cmd.x1, true);
          i += 8;
          view.setFloat64(i, cmd.y1, true);
          i += 8;
          view.setFloat64(i, cmd.x2, true);
          i += 8;
          view.setFloat64(i, cmd.y2, true);
          i += 8;
          view.setFloat64(i, cmd.x, true);
          i += 8;
          view.setFloat64(i, cmd.y, true);
          i += 8;
          x = cmd.x;
          y = cmd.y;
          break;
      }
    }

    return i;
  }

  //
  // Compile encoded IPathCommand[] in {buffer}
  //

  compileEncoded(
    buffer: ArrayBuffer, bytesUsed: number,
    fmt: string, ppc: number, eps: number
  ) {

    ppc = Math.max(0, Math.min(255, Math.round(ppc)));
    eps = Math.abs(eps);

    //
    // Load into memory if needed
    //

    if (buffer !== this.wasm.exports.memory.buffer) {
      const heap = this.wasm.exports.memory.buffer;
      for (let i = 0, L = buffer.byteLength; i < L; ++i) {
        heap[i] = buffer[i];
      }
    }

    const shapesPtr = this.wasm.exports.compile(bytesUsed, fmt, ppc, eps);

    //
    // Map to JS Objects
    //

    const F64 = new Float64Array(this.wasm.exports.memory.buffer);
    const shapesIn = this.wasm.exports.__getUint32Array(shapesPtr);
    const shapesOut: Shape[] = [];
    for (let i = 0; i < shapesIn.length; i++) {
      const shape: Shape = { fill: [], holes: [] };
      if (shapesIn[i] === 0) break;
      const polygons = this.wasm.exports.__getUint32Array(shapesIn[i]);
      for (const polygonPtr of polygons) {
        if (polygonPtr === 0) break;
        const vertices = this.wasm.exports.__getUint32Array(polygonPtr);
        let arr: Polygon;
        if (shape.fill.length === 0) {
          arr = shape.fill;
        } else {
          shape.holes.push(arr = []);
        }
        for (const vertexPtr of vertices) {
          if (vertexPtr === 0) break;
          arr.push([
            F64[(vertexPtr >>> 3)], // x
            F64[(vertexPtr >>> 3) + 1]  // y
          ]);
        }
      }
      shapesOut.push(shape);
    }
    return shapesOut;
  }

  //
  // Compile non-encoded IPathCommand[]
  //

  compile(cmds: IPathCommand[], fmt: string, ppc: number, eps: number) {
    const buffer = this.wasm.exports.memory.buffer;
    const bytesUsed = this.encode(cmds, this.wasm.exports.memory.buffer);
    return this.compileEncoded(buffer, bytesUsed, fmt, ppc, eps);
  }
}
