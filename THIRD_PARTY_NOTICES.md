# Third-Party Notices

Constellation is released under the MIT license (see [LICENSE](./LICENSE)).
This file lists the third-party components it relies on, per those projects' licenses.

## Runtime-downloaded model (not bundled)

Constellation's optional semantic-matching feature downloads **nomic-embed-text-v1.5**
from Hugging Face on first use (only if you enable it). The model is **not** included
in this repository or in the installer.

- Model: [nomic-ai/nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)
- License: **Apache License 2.0** · © Nomic AI
- Technical report: Nussbaum et al., *"Nomic Embed: Training a General Contextual
  Embedding Model from Scratch"* (arXiv:2402.01613)

## Bundled runtime libraries (key ones)

| Library | License | Used for |
|---|---|---|
| Electron | MIT (Chromium/Node components: BSD-style) | application framework |
| marked | MIT (vendored in `src/lib/`) | markdown rendering |
| openai (Node SDK) | Apache-2.0 | GLM API client (OpenAI-compatible) |
| @huggingface/transformers | Apache-2.0 | on-device embeddings (optional feature) |
| onnxruntime-node / -web / -common | MIT | ML inference runtime (optional feature) |
| sharp | Apache-2.0 (bundles libvips, LGPL-3.0, dynamically linked) | image preprocessing for transformers.js |

## Bundled fonts

**Literata** (regular, italic, and semibold faces; latin subset, `src/fonts/`)
© Google LLC — used under the **SIL Open Font License 1.1**
(<https://fonts.google.com/specimen/Literata>, <https://openfontlicense.org>).
The license permits bundling and redistribution; Literata itself may not be
sold by itself.

## Full production dependency inventory

Generated from the shipped dependency tree; each package remains under its own license.

| Package | Version | License |
|---|---|---|
| @huggingface/jinja | 0.5.9 | MIT |
| @huggingface/tokenizers | 0.1.3 | Apache-2.0 |
| @huggingface/transformers | 4.2.0 | Apache-2.0 |
| @img/colour | 1.1.0 | MIT |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause |
| @protobufjs/float | 1.0.2 | BSD-3-Clause |
| @protobufjs/path | 1.1.2 | BSD-3-Clause |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause |
| @types/node | 20.19.43 | MIT |
| @types/node-fetch | 2.6.13 | MIT |
| abort-controller | 3.0.0 | MIT |
| adm-zip | 0.5.18 | MIT |
| agentkeepalive | 4.6.0 | MIT |
| asynckit | 0.4.0 | MIT |
| boolean | 3.2.0 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| combined-stream | 1.0.8 | MIT |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| delayed-stream | 1.0.0 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| detect-node | 2.1.0 | MIT |
| dunder-proto | 1.0.1 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es-set-tostringtag | 2.1.0 | MIT |
| es6-error | 4.1.1 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| event-target-shim | 5.0.1 | MIT |
| flatbuffers | 25.9.23 | Apache-2.0 |
| form-data | 4.0.6 | MIT |
| form-data-encoder | 1.7.2 | MIT |
| formdata-node | 4.4.1 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| global-agent | 3.0.0 | BSD-3-Clause |
| globalthis | 1.0.4 | MIT |
| gopd | 1.2.0 | MIT |
| guid-typescript | 1.0.9 | ISC |
| has-property-descriptors | 1.0.2 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hasown | 2.0.4 | MIT |
| humanize-ms | 1.2.1 | MIT |
| json-stringify-safe | 5.0.1 | ISC |
| long | 5.3.2 | Apache-2.0 |
| matcher | 3.0.0 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| mime-db | 1.52.0 | MIT |
| mime-types | 2.1.35 | MIT |
| ms | 2.1.3 | MIT |
| node-domexception | 1.0.0 | MIT |
| node-fetch | 2.7.0 | MIT |
| object-keys | 1.1.1 | MIT |
| onnxruntime-common | 1.24.3 | MIT |
| onnxruntime-node | 1.24.3 | MIT |
| onnxruntime-web | 1.26.0-dev | MIT |
| openai | 4.104.0 | Apache-2.0 |
| platform | 1.3.6 | MIT |
| protobufjs | 7.6.5 | BSD-3-Clause |
| roarr | 2.15.4 | BSD-3-Clause |
| semver | 6.3.1 | ISC |
| semver-compare | 1.0.0 | MIT |
| serialize-error | 7.0.1 | MIT |
| sharp | 0.34.5 | Apache-2.0 |
| sprintf-js | 1.1.3 | BSD-3-Clause |
| tr46 | 0.0.3 | MIT |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) |
| undici-types | 6.21.0 | MIT |
| web-streams-polyfill | 4.0.0-beta.3 | MIT |
| webidl-conversions | 3.0.1 | BSD-2-Clause |
| whatwg-url | 5.0.0 | MIT |
