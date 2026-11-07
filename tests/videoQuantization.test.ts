import assert from "node:assert/strict";
import test from "node:test";
import onnxProto from "onnx-proto";
import { createQ4ConversionProbe, quantizeVideoOnnx } from "../src/videoQuantization.ts";

const { onnx } = onnxProto;

test("video Q4 conversion writes packed MatMulNBits weights instead of floating-point weights", () => {
  const { model: bytes, summary } = quantizeVideoOnnx(createQ4ConversionProbe());
  const model = onnx.ModelProto.decode(bytes);
  const node = model.graph!.node!.find((entry) => entry.opType === "MatMulNBits");

  assert.ok(node, "the converted graph must use ONNX Runtime's real MatMulNBits operator");
  assert.equal(node.domain, "com.microsoft");
  assert.deepEqual(node.attribute?.map((entry) => [entry.name, Number(entry.i)]), [
    ["K", 32], ["N", 2], ["bits", 4], ["block_size", 32],
  ]);
  assert.equal(model.graph!.initializer!.some((entry) => entry.name === "w"), false, "the FP16 source weight must not remain in the Q4 checkpoint");
  assert.equal(summary.quantizedMatmuls, 1);
  assert.equal(summary.quantizedGemm, 0);
  assert.equal(summary.quantizedParameters, 64);
  assert.equal(summary.originalLinearWeightBytes, 128);
  assert.equal(summary.bits, 4);
});
