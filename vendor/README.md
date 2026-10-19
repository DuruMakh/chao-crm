# Invoice PDF dependencies

Pinned browser bundles from the npm registry. Package tarballs were checked against npm's SHA-512 integrity values before copying these files. No package installation or build step is required.

- jsPDF **4.2.1**, `jspdf.umd.min.js`: https://github.com/parallax/jsPDF (MIT; see `jspdf-LICENSE.txt`).
- jsPDF-AutoTable **5.0.9**, `jspdf.plugin.autotable.min.js`: https://github.com/simonbengtsson/jsPDF-AutoTable (MIT; see `jspdf-autotable-LICENSE.txt`).
- `../assets/NotoSansGeorgian-{Regular,Bold}.ttf`: full static TTFs from **NotoSansGeorgian-v2.005**, https://github.com/notofonts/georgian/releases/tag/NotoSansGeorgian-v2.005 (SIL Open Font License; see `../assets/NotoSansGeorgian-OFL.txt`). The full fonts include Georgian, Latin, digits and the lari symbol.

PDFs are generated in the browser from the displayed invoice. Fonts and code are served from this project; invoice data is not uploaded to a conversion service.

`../assets/chao-logo.png` is the existing Chao logo, copied from the rendered invoice's asset at `https://chaocatering.ge/wp-content/uploads/2026/03/cropped-Wordpress-logo-chao.png` so PDF creation does not depend on a remote image request.
