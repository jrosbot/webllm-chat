import onnxProto from "onnx-proto";
import type { onnx as Onnx } from "onnx-proto";

const { onnx } = onnxProto;
const BLOCK_SIZE = 32;
const Q4_BITS = 4;
const FLOAT = onnx.TensorProto.DataType.FLOAT;
const FLOAT16 = onnx.TensorProto.DataType.FLOAT16;
const UINT8 = onnx.TensorProto.DataType.UINT8;
const ATTRIBUTE_INT = onnx.AttributeProto.AttributeType.INT;

export interface VideoQuantizationSummary {
  quantizedMatmuls: number;
  quantizedGemm: number;
  quantizedParameters: number;
  originalLinearWeightBytes: number;
  q4TensorBytes: number;
  outputBytes: number;
  bits: 4;
  blockSize: 32;
}

function dimension(value: number | { toNumber(): number }) {
  return typeof value === "number" ? value : value.toNumber();
}

function attribute(node: Onnx.INodeProto, name: string) {
  return node.attribute?.find((entry) => entry.name === name);
}

function readWeightValues(tensor: Onnx.ITensorProto) {
  const dims = (tensor.dims ?? []).map(dimension);
  if (dims.length !== 2) throw new Error(`Only 2D dense weights can be converted to Q4 (${tensor.name}).`);
  const count = dims[0] * dims[1];
  if (tensor.externalData?.length || tensor.dataLocation === onnx.TensorProto.DataLocation.EXTERNAL) {
    throw new Error(`External ONNX weight data is not supported (${tensor.name}).`);
  }
  const values = new Float32Array(count);
  if (tensor.rawData?.byteLength) {
    const view = new DataView(tensor.rawData.buffer, tensor.rawData.byteOffset, tensor.rawData.byteLength);
    if (tensor.dataType === FLOAT16) {
      if (tensor.rawData.byteLength !== count * 2) throw new Error(`Unexpected FP16 weight length (${tensor.name}).`);
      for (let i = 0; i < count; i++) values[i] = halfToFloat(view.getUint16(i * 2, true));
    } else if (tensor.dataType === FLOAT) {
      if (tensor.rawData.byteLength !== count * 4) throw new Error(`Unexpected FP32 weight length (${tensor.name}).`);
      for (let i = 0; i < count; i++) values[i] = view.getFloat32(i * 4, true);
    } else {
      throw new Error(`Only FP16 and FP32 weights can be converted to Q4 (${tensor.name}).`);
    }
  } else if (tensor.dataType === FLOAT) {
    if (tensor.floatData?.length !== count) throw new Error(`Missing FP32 weight data (${tensor.name}).`);
    values.set(tensor.floatData);
  } else {
    throw new Error(`Weight data is not stored as FP16 or FP32 (${tensor.name}).`);
  }
  return { values, rows: dims[0], columns: dims[1] };
}

function halfToFloat(bits: number) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function roundToEven(value: number) {
  const lower = Math.floor(value);
  const part = value - lower;
  if (part < 0.5) return lower;
  if (part > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function quantizeMatrix(values: Float32Array, rows: number, columns: number, transposed: boolean, alpha: number, name: string) {
  const k = transposed ? columns : rows;
  const n = transposed ? rows : columns;
  const blocks = Math.ceil(k / BLOCK_SIZE);
  const bytesPerBlock = BLOCK_SIZE * Q4_BITS / 8;
  const q = new Uint8Array(n * blocks * bytesPerBlock);
  const scales = new Float32Array(n * blocks);
  const zeroPoints = new Uint8Array(n * Math.ceil(blocks / 2));

  for (let column = 0; column < n; column++) {
    for (let block = 0; block < blocks; block++) {
      const first = block * BLOCK_SIZE;
      const count = Math.min(BLOCK_SIZE, k - first);
      let min = 0;
      let max = 0;
      const weightAt = (index: number) => {
        const row = first + index;
        return (transposed ? values[column * columns + row] : values[row * columns + column]) * alpha;
      };
      for (let i = 0; i < count; i++) {
        const value = weightAt(i);
        if (!Number.isFinite(value)) throw new Error(`Non-finite value in ${name}; Q4 conversion stopped.`);
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const scale = max === min ? 0 : (max - min) / 15;
      const zeroPoint = scale === 0 ? 8 : Math.max(0, Math.min(15, roundToEven(-min / scale)));
      const scaleIndex = column * blocks + block;
      scales[scaleIndex] = scale;
      const zeroIndex = column * Math.ceil(blocks / 2) + Math.floor(block / 2);
      zeroPoints[zeroIndex] |= zeroPoint << ((block % 2) * 4);

      const blockOffset = (column * blocks + block) * bytesPerBlock;
      for (let i = 0; i < BLOCK_SIZE; i++) {
        const value = i < count ? weightAt(i) : 0;
        const quantized = scale === 0 ? zeroPoint : Math.max(0, Math.min(15, roundToEven(value / scale + zeroPoint)));
        const index = blockOffset + (i >> 1);
        q[index] |= quantized << ((i & 1) * 4);
      }
    }
  }

  return { k, n, blocks, q, scales, zeroPoints, parameterCount: rows * columns };
}

function tensor(name: string, dims: number[], dataType: number, bytes: Uint8Array): Onnx.ITensorProto {
  return onnx.TensorProto.create({ dims, dataType, name, rawData: bytes });
}

function intAttribute(name: string, value: number): Onnx.IAttributeProto {
  return onnx.AttributeProto.create({ name, type: ATTRIBUTE_INT, i: value });
}

function packedNames(index: number, name: string) {
  const prefix = `video_q4_${index}_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  return { weights: `${prefix}_weights`, scales: `${prefix}_scales`, zeroPoints: `${prefix}_zero_points` };
}

function resolveWeight(inputName: string, producerByOutput: Map<string, Onnx.INodeProto>, initializers: Map<string, Onnx.ITensorProto>) {
  const initializer = initializers.get(inputName);
  if (initializer) return { tensor: initializer, castNode: undefined };
  const producer = producerByOutput.get(inputName);
  if (!producer || producer.opType !== "Cast" || !producer.input?.[0]) return undefined;
  const source = initializers.get(producer.input[0]);
  if (!source) return undefined;
  return { tensor: source, castNode: producer };
}

export function quantizeVideoOnnx(source: Uint8Array, onProgress?: (percent: number) => void): { model: Uint8Array; summary: VideoQuantizationSummary } {
  const model = onnx.ModelProto.decode(source);
  const graph = model.graph;
  if (!graph) throw new Error("The downloaded ONNX file has no graph.");
  const nodes = graph.node ?? [];
  graph.node = nodes;
  graph.initializer ??= [];
  if (nodes.some((node) => node.attribute?.some((entry) => entry.g || entry.graphs?.length))) {
    throw new Error("This ONNX export uses nested graphs and cannot be safely converted in this browser build.");
  }

  const initializers = new Map((graph.initializer ?? []).map((value) => [value.name!, value]));
  const producerByOutput = new Map<string, Onnx.INodeProto>();
  for (const node of nodes) for (const output of node.output ?? []) producerByOutput.set(output, node);

  const newInitializers: Onnx.ITensorProto[] = [];
  const quantizedCasts = new Set<Onnx.INodeProto>();
  const rewritten: Onnx.INodeProto[] = [];
  let quantizedMatmuls = 0;
  let quantizedGemm = 0;
  let quantizedParameters = 0;
  let originalLinearWeightBytes = 0;
  let q4TensorBytes = 0;

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex];
    if ((node.opType !== "MatMul" && node.opType !== "Gemm") || !node.input?.[0] || !node.input[1] || !node.output?.[0]) {
      rewritten.push(node);
      continue;
    }
    const resolved = resolveWeight(node.input[1], producerByOutput, initializers);
    if (!resolved) {
      rewritten.push(node);
      continue;
    }
    const dims = (resolved.tensor.dims ?? []).map(dimension);
    if (dims.length !== 2) { rewritten.push(node); continue; }
    const transA = node.opType === "Gemm" ? Number(attribute(node, "transA")?.i ?? 0) : 0;
    const transB = node.opType === "Gemm" ? Number(attribute(node, "transB")?.i ?? 0) : 0;
    const alpha = node.opType === "Gemm" ? Number(attribute(node, "alpha")?.f ?? 1) : 1;
    const beta = node.opType === "Gemm" ? Number(attribute(node, "beta")?.f ?? 1) : 1;
    if (transA !== 0 || ![0, 1].includes(transB) || !Number.isFinite(alpha) || beta !== 1) {
      rewritten.push(node);
      continue;
    }
    const { values, rows, columns } = readWeightValues(resolved.tensor);
    const packed = quantizeMatrix(values, rows, columns, node.opType === "Gemm" && transB === 1, alpha, node.name ?? node.output[0]);
    const names = packedNames(newInitializers.length, node.name ?? node.output[0]);
    const start = newInitializers.length;
    newInitializers.push(
      tensor(names.weights, [packed.n, packed.blocks, BLOCK_SIZE / 2], UINT8, packed.q),
      tensor(names.scales, [packed.n, packed.blocks], FLOAT, new Uint8Array(packed.scales.buffer)),
      tensor(names.zeroPoints, [packed.n, Math.ceil(packed.blocks / 2)], UINT8, packed.zeroPoints),
    );
    q4TensorBytes += packed.q.byteLength + packed.scales.byteLength + packed.zeroPoints.byteLength;
    quantizedParameters += packed.parameterCount;
    originalLinearWeightBytes += resolved.tensor.rawData?.byteLength ?? packed.parameterCount * 2;
    if (resolved.castNode) quantizedCasts.add(resolved.castNode);

    const productName = node.opType === "Gemm" && node.input[2] ? `${node.output[0]}_q4_product` : node.output[0];
    rewritten.push(onnx.NodeProto.create({
      input: [node.input[0], names.weights, names.scales, names.zeroPoints],
      output: [productName],
      name: `${node.name ?? node.output[0]}_Q4`,
      opType: "MatMulNBits",
      domain: "com.microsoft",
      attribute: [
        intAttribute("K", packed.k), intAttribute("N", packed.n),
        intAttribute("bits", Q4_BITS), intAttribute("block_size", BLOCK_SIZE),
      ],
    }));
    if (node.opType === "Gemm" && node.input[2]) {
      rewritten.push(onnx.NodeProto.create({
        input: [productName, node.input[2]], output: [node.output[0]], name: `${node.name ?? node.output[0]}_bias`, opType: "Add",
      }));
    }
    if (node.opType === "MatMul") quantizedMatmuls++;
    else quantizedGemm++;
    // `start` is used to keep the three initializer triplets adjacent and make
    // the summary count match the graph actually written.
    if (newInitializers.length !== start + 3) throw new Error("Q4 initializer bookkeeping failed.");
    onProgress?.(Math.round((nodeIndex + 1) / nodes.length * 100));
  }

  if (!quantizedParameters) throw new Error("No constant 2D MatMul or Gemm weights could be converted to real Q4 weights.");
  graph.node = rewritten.filter((node) => !quantizedCasts.has(node));
  graph.initializer.push(...newInitializers);

  // Remove unused source weights so the cached graph contains the packed Q4
  // tensors instead of carrying a second FP16 copy of the generator.
  const used = new Set(graph.node.flatMap((node) => node.input ?? []));
  for (const value of graph.input ?? []) used.add(value.name!);
  graph.initializer = graph.initializer.filter((value) => used.has(value.name!));

  if (!model.opsetImport.some((entry) => entry.domain === "com.microsoft")) {
    model.opsetImport.push(onnx.OperatorSetIdProto.create({ domain: "com.microsoft", version: 1 }));
  }
  const encoded = onnx.ModelProto.encode(model).finish();
  return {
    model: encoded,
    summary: {
      quantizedMatmuls, quantizedGemm, quantizedParameters,
      originalLinearWeightBytes, q4TensorBytes,
      outputBytes: encoded.byteLength, bits: 4, blockSize: BLOCK_SIZE,
    },
  };
}

export function createQ4ConversionProbe() {
  const weights = new Uint8Array(32 * 2 * 2);
  const view = new DataView(weights.buffer);
  const toHalf = (value: number) => {
    if (value === 0) return 0;
    let exponent = Math.floor(Math.log2(Math.abs(value)));
    let fraction = value / 2 ** exponent - 1;
    if (exponent < -14) return Math.sign(value) < 0 ? 0x8000 : 0;
    const sign = value < 0 ? 0x8000 : 0;
    exponent += 15;
    return sign | (exponent << 10) | Math.round(fraction * 1024);
  };
  // Row-major [K=32, N=2]: the first two rows are an identity matrix.
  view.setUint16(0, toHalf(1), true);
  view.setUint16(6, toHalf(1), true);
  const model = onnx.ModelProto.create({
    irVersion: 8,
    opsetImport: [onnx.OperatorSetIdProto.create({ domain: "", version: 17 })],
    graph: onnx.GraphProto.create({
      name: "video-q4-conversion-probe",
      input: [onnx.ValueInfoProto.create({ name: "x", type: onnx.TypeProto.create({ tensorType: onnx.TypeProto.Tensor.create({ elemType: FLOAT, shape: onnx.TensorShapeProto.create({ dim: [
        onnx.TensorShapeProto.Dimension.create({ dimValue: 1 }), onnx.TensorShapeProto.Dimension.create({ dimValue: 32 }),
      ] }) }) }) })],
      output: [onnx.ValueInfoProto.create({ name: "y", type: onnx.TypeProto.create({ tensorType: onnx.TypeProto.Tensor.create({ elemType: FLOAT, shape: onnx.TensorShapeProto.create({ dim: [
        onnx.TensorShapeProto.Dimension.create({ dimValue: 1 }), onnx.TensorShapeProto.Dimension.create({ dimValue: 2 }),
      ] }) }) }) })],
      initializer: [tensor("w", [32, 2], FLOAT16, weights)],
      node: [onnx.NodeProto.create({ name: "probe-matmul", opType: "MatMul", input: ["x", "w"], output: ["y"] })],
    }),
  });
  return onnx.ModelProto.encode(model).finish();
}
