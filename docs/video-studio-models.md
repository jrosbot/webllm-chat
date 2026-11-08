# Video Studio model and quantization research

Research checked on 7 November 2026. Model URLs and file sizes below are pinned to immutable Hugging Face revisions where available.

## Selected browser pipeline

Video Studio uses [Udgam Labs' Drishya Tiny](https://huggingface.co/udgamlabs/Drishya-Tiny/tree/2676ae2764687ffadfdc238fdfe83d3b313a3e9c), revision `2676ae2764687ffadfdc238fdfe83d3b313a3e9c`. Its model card describes a 212M-parameter generator for text-to-video and image-to-video, and publishes a browser ONNX pipeline using ONNX Runtime Web and WebGPU. The published clip shape is 17 frames, 256 × 256 pixels, at 8 fps. The upstream browser pipeline and its sampler are documented in the [model card](https://huggingface.co/udgamlabs/Drishya-Tiny) and [pinned browser source](https://github.com/udgamlabs/drishya-tiny/tree/dd1d1bcfecf4834a7b1702f664f3a8d9295b03f3/browser).

| Component | Published file | Bytes | Use | License |
| --- | --- | ---: | --- | --- |
| Video DiT generator | `onnx/drishya_tiny_dit_cond.onnx` | 425,712,830 | Required; converted locally from FP16 to Q4 | CC BY-NC 4.0 |
| Flan-T5-Base encoder | `onnx/flan_t5_base_encoder.onnx` | 219,487,367 | Required; WASM | Apache-2.0 |
| TAEW2.2 decoder | `onnx/taew2_2_decoder.onnx` | 19,903,284 | Required; WebGPU | MIT |
| TAEW2.2 image encoder | `onnx/taew2_2_encoder.onnx` | 3,039,523 | Optional; downloaded only for image-to-video | MIT |

The three text-to-video ONNX files total **665,103,481 bytes** (about 665.1 MB). Image-to-video adds 3,039,523 bytes. Flan-T5 tokenizer files are fetched separately from `Xenova/flan-t5-base`, revision `c6a1b98a4a35e1063d88edaceef4dc52cf3b2784`; the tokenizer repository is Apache-2.0. Model data is pinned by SHA-256 in `src/videoDiffusion.ts` and checked before inference. The app caches the resulting approximately 138 MB Q4 generator plus the two helper graphs, about 377 MB before tokenizer/runtime caches.

The TAEW2.2 ONNX decoder returns float32 frames with shape `[17, 256, 256, 3]` and values in `[0, 255]`. Video Studio rounds and clips these values into RGB bytes before creating `ImageData` and the WebM preview.

The FP16 generator is not itself a 4-bit checkpoint. At first use, Video Studio downloads its published 425.7 MB ONNX file, quantizes constant dense MatMul/Gemm weights in a background browser worker, and creates ONNX Runtime `com.microsoft::MatMulNBits` operators with packed uint4 weights, block size 32, per-block scales and zero-points. It converts 116 MatMul and 20 Gemm nodes, covering 211,648,512 dense weights. Biases and non-dense tensors remain higher precision. This makes Q4 an actual executable packed-weight graph, while clearly distinguishing it from a separately published Q4 checkpoint.

ONNX Runtime documents block-wise 4-bit weight-only quantization and `MatMulNBits`. This project pins `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` and checks that this installed WebGPU backend can execute a real packed Q4 probe before offering generation. The browser probe needs no model download. The converter also verifies that no FP16 source weights remain in the produced generator graph.

### Observed conversion and parity measurements

The exact pinned 425,712,830-byte generator was downloaded and converted in this managed development environment:

| Measurement | Result | Scope |
| --- | ---: | --- |
| Source generator | 425,712,830 bytes | Published FP16 ONNX file |
| Converted Q4 ONNX | 138,042,434 bytes | 67.6% smaller than source |
| Dense weights converted | 211,648,512 | 116 MatMul + 20 Gemm nodes |
| Node.js conversion time | 9.4 s | Development server, not an Android estimate |
| Node.js peak RSS | about 1.19 GiB | Development process; not browser-worker or phone RAM |
| ONNX Runtime CPU session creation | FP16 0.93 s; Q4 0.23 s | One run on the development CPU |
| One random-input denoising pass | FP16 0.45 s; Q4 0.41 s | One technical pass, not a full clip |
| FP16/Q4 output cosine similarity | 0.924 | Random input only; not video quality evaluation |

ONNX checker and ONNX Runtime CPU loaded and executed the converted full graph. A random-input comparison found mean absolute error 0.91 and maximum absolute error 5.00. This is a graph/parity sanity check, not evidence of perceptual quality or a claim that Android can load the full pipeline. The app reports browser fetch, cache, conversion, session, prompt, denoising, decode and WebM timings. `performance.memory` and `navigator.deviceMemory` are shown when available, but they exclude WebGPU allocations and do not expose total phone RAM. The conversion also runs in a worker, so the displayed JS heap is not a complete conversion-memory measurement.

The development proxy took roughly 4.5 minutes to transfer the 425.7 MB generator. Network throughput varies, so this is not a device or general connection estimate. No Android device was available; Chrome Android support and memory limits must be measured on the target phone. A Redmi Note 15's exact RAM configuration was not established here. WebGPU detection and a passing tiny Q4 operator check establish runtime capability only, not that the full 377 MB cached pipeline fits alongside browser/GPU allocations.

A second integration run in headless Chromium with SwiftShader streamed the same 425.7 MB file from a loopback server (not Hugging Face) through the app's download, hash, worker-conversion, cache and session-creation paths. The browser reported 5.26 s for the loopback fetch, 6.37 s for SHA-256 work, 8.63 s for conversion, 0.85 s for Q4 generator session creation and a 533.2 MB peak `performance.memory` sample. `navigator.deviceMemory` reported 16 GB for this host. The run then deliberately returned HTTP 503 for the T5 encoder, so it did not generate a clip. The JS heap sample excludes worker, WebGPU and WASM/native allocations; the host result must not be read as an Android memory or generation benchmark.

## Why Wan 2.1 and Stable Video Diffusion XT were not selected

The official [Wan2.1 T2V 1.3B Diffusers repository](https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/tree/0fad780a534b6463e45facd96134c9f345acfa5b) is Apache-2.0 and its pinned repository is **28,935,653,511 bytes** (about 28.9 GB): roughly 22.7 GB of T5 encoder shards, 5.68 GB of transformer weights, and 507.6 MB for the VAE, plus configs/tokenizer/scheduler files. It is a Diffusers/PyTorch pipeline, not a published ONNX Runtime Web pipeline. Community [NF4](https://huggingface.co/sarthak247/Wan2.1-T2V-1.3B-nf4/tree/main) and [GGUF](https://huggingface.co/samuelchristlie/Wan2.1-T2V-1.3B-GGUF/tree/main) files were found, but these are not a complete browser-executable pipeline: the NF4 route depends on bitsandbytes/PyTorch and is missing a working text-encoder setup; the GGUF transformer requires a compatible GGUF runtime and the remaining pipeline components. File quantization alone does not provide browser support.

[Stable Video Diffusion XT 1.1](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt-1-1/tree/043843887ccd51926e3efed36270444a838e7861) is a Safetensors/Diffusers image-to-video pipeline with 25-frame 1024 × 576 output. Its Stability AI Community License requires accepting the agreement to access the weights and has separate conditions for research, non-commercial and commercial use. The FP16 Diffusers components total 4,509,184,986 bytes (image encoder 1,264,217,240; UNet 3,049,435,836; VAE 195,531,910). We did not locate a browser WebGPU ONNX pipeline in the official model repository.

These candidates are substantially larger and lack the same ready-to-run browser graph. The selected Drishya Tiny route fits the requested local-browser constraint more closely, at the cost of a much smaller, experimental model and lower output resolution.

## 1-bit availability

Searches of the Hugging Face model catalog for `video 1-bit`, `video 1 bit`, and `video binary weights`, followed by checks of the video candidates above and ONNX Runtime's documented low-bit operator support, did not identify a verified 1-bit video checkpoint with a complete executable browser pipeline. This is bounded search evidence, not proof that no such artifact exists anywhere. No 1-bit selector, fake checkpoint, or theoretical binarization is presented in the app. A real 1-bit model can be added after its weights, license, required components and browser runtime are verified.

## Sources

- [Drishya Tiny model card and file list](https://huggingface.co/udgamlabs/Drishya-Tiny/tree/2676ae2764687ffadfdc238fdfe83d3b313a3e9c)
- [Drishya Tiny upstream browser implementation](https://github.com/udgamlabs/drishya-tiny/tree/dd1d1bcfecf4834a7b1702f664f3a8d9295b03f3/browser)
- [Flan-T5-Base tokenizer revision](https://huggingface.co/Xenova/flan-t5-base/tree/c6a1b98a4a35e1063d88edaceef4dc52cf3b2784)
- [ONNX Runtime 4-bit quantization and MatMulNBits documentation](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- [ONNX Runtime WebGPU documentation](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [Wan2.1 T2V 1.3B Diffusers model](https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers/tree/0fad780a534b6463e45facd96134c9f345acfa5b)
- [Stable Video Diffusion XT 1.1 model and license](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt-1-1/tree/043843887ccd51926e3efed36270444a838e7861)
