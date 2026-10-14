# PDF Studio — React PDF Tools

A responsive, browser-based PDF utility interface built with React and Vite.

## Run locally

1. Install Node.js LTS.
2. Open this folder in VS Code.
3. Open the terminal in this folder and run:

   ```bash
   npm install
   npm run dev
   ```

4. Open the local URL printed by Vite (usually `http://localhost:5173/`).

## Build for production

```bash
npm run build
npm run preview
```

## Tools included

- **Image to PDF** — combine JPG, PNG or WebP images into a PDF.
- **Merge PDFs** — combine PDF files in their selected order.
- **PDF to Image** — export pages as PNG or JPG.
- **Word to PDF** — convert DOCX files; complex formatting can change.
- **PDF to Word** — extract PDF text into a DOCX; this does not preserve the original page layout.
- **Split PDF** — export chosen pages/ranges or split every page.
- **Compress PDF** — best-effort optimization; embedded images are not recompressed.

## Project structure

- `src/App.jsx` — app layout, tool selection, file handling and conversion logic.
- `src/index.css` — responsive visual design, colors, spacing and component styles.
- `src/main.jsx` — React entry point; mounts the `App` component and imports the CSS.
- `index.html` — the browser page shell and title.
- `package.json` — dependencies and commands.

## How the app works

1. React state tracks the selected tool, files, settings, processing state and messages.
2. The file input and drag-and-drop area collect local files.
3. The selected tool calls its conversion function using browser-side libraries.
4. The result is offered as a download in the browser.

Files are processed in the browser by the app; they are not uploaded to a custom backend in this project. Large files can use substantial memory. Scanned PDFs need OCR for text extraction, which is not included.

## Troubleshooting

- If the page is blank, open browser DevTools (`Ctrl + Shift + J`) and read the first red Console error.
- If Vite is not running, execute `npm run dev` in the project directory.
- If a dependency install reports vulnerabilities, review `npm audit` output and update packages deliberately. Avoid `npm audit fix --force` without checking breaking changes.

---

© 2026 **Sync Soft Solution.** All rights reserved.
