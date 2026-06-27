# V3 Iteration 6 Summary

## Baseline vs Iter6 (V3)

- baseline: `docs/segmentation_benchmark_after_guard.json`
- iter6: `docs/segmentation_benchmark_v3_default_iter6.json`

| metric | baseline | iter6 |
|---|---:|---:|
| avg processingTimeMs | 295.5 | 273.1 |
| p95 processingTimeMs | 607 | 618 |
| max processingTimeMs | 736 | 712 |
| fallbackUsed (count) | 2 | 1 |
| timeoutHit (count) | 2 | 2 |

## Critical real cases

- `Gemini_Generated_Image_t6n2yot6n2yot6n2.png`
  - area: `139573`
  - bbox: `528x424`
  - time: `369ms`

- `Gemini_Generated_Image_z1y9llz1y9llz1y9.png`
  - area: `55950`
  - bbox: `234x414`
  - time: `481ms`
  - no collapse; no timeout; no fallback

## Notes

- Material-aware primary path is kept behind runtime flag (`window.__ldvV3MaterialAware=true`) and is **off by default**.
- Default V3 remains stable path with edge-aware refine and anti-collapse guards.
