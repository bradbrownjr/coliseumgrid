# Image fixtures

Real files for `test/image-info.test.ts`, also read by the server's graphic upload tests. Each
was made on 2026-11-15 with Pillow 12.2.0 in Python 3 (Pillow reported libwebp 1.6.0 and JPEG library 6.2),
drawing a white picture with a red outline and a black diagonal:

| File | Size | Made with |
|---|---|---|
| `graphic.png` | 48 x 32 | RGBA, `save('graphic.png')` |
| `baseline.jpg` | 40 x 24 | RGB, `save(..., quality=80, restart_marker_blocks=1, comment=b'fixture')`: SOF0, a COM segment, a DRI segment, and restart markers inside the scan |
| `progressive.jpg` | 64 x 48 | RGB, `save(..., quality=80, progressive=True)`: SOF2 and a DHT segment between scans |
| `lossy.webp` | 50 x 30 | RGB, `save(..., quality=80)`: a simple file with one `VP8 ` chunk |
| `lossless.webp` | 33 x 17 | RGB, `save(..., lossless=True)`: one `VP8L` chunk |
| `extended.webp` | 70 x 20 | RGBA, `save(..., quality=80)`: the alpha makes libwebp write `VP8X`, `ALPH`, and `VP8 ` |
