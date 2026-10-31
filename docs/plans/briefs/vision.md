# Brief: vision (camera input)

Status: **ON HOLD.** The team has not decided whether to build this. Do not implement anything from this file. It records the design so the thinking is not lost.

## Idea

Camera streams become live people counts, density and flow direction per zone. These feed the forecast in `engine/src/forecast.ts`, so the model of the crowd follows the real crowd.

## Design if it goes ahead

1. Read RTSP camera streams at the edge, near the camera.
2. Detect people; above about 2 people/m² switch to crowd-density estimation models, because detection fails in dense crowds.
3. Map each camera's view onto map coordinates (a homography, calibrated once per camera).
4. Publish counts, density and flow direction per zone onto the server. **Video never leaves the edge.**

Likely Python (ONNX Runtime, TensorRT or DeepStream). Check model licences: some popular detectors are AGPL, which matters for a product.

## Rule that holds whatever is decided

Never store or show faces or identities. Sensor input is people counts per zone only.

## Questions for the team

- Is camera input wanted at all, given privacy and legal exposure for police use?
- Which cameras exist at the stadium, and who controls access to them?
- Would turnstile counts (see `real-data.md`) be enough without cameras?
