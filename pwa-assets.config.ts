// PWA icons generated from public/favicon.svg (千 on the cinnabar seal) by
// @vite-pwa/assets-generator. Run `npm run generate-pwa-assets` after changing the SVG; the PNGs
// are committed to public/.
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const SEAL_RED = '#b8361e'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Full-bleed red behind the rounded seal: the corners fill in, so masks and iOS's own
    // rounding never show white. The glyph sits well inside the maskable safe zone (80%).
    maskable: { sizes: [512], padding: 0, resizeOptions: { background: SEAL_RED } },
    apple: { sizes: [180], padding: 0, resizeOptions: { background: SEAL_RED } },
  },
  images: ['public/favicon.svg'],
})
