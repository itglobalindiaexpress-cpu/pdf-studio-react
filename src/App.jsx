import React from "react";
import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { jsPDF } from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import html2pdf from "html2pdf.js";
import { Document, Packer, Paragraph } from "docx";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const TOOLS = {
  "image-pdf": {
    title: "Image to PDF",
    description: "Turn one or more images into a single PDF document.",
    accept: "image/jpeg,image/png,image/webp",
    hint: "JPG, PNG or WebP · Multiple files supported",
    multiple: true,
  },
  merge: {
    title: "Merge PDFs",
    description:
      "Combine multiple PDF files into one document in the listed order.",
    accept: ".pdf,application/pdf",
    hint: "PDF files · Select at least two",
    multiple: true,
  },
  "pdf-image": {
    title: "PDF to Image",
    description: "Render each PDF page as a PNG or JPG image.",
    accept: ".pdf,application/pdf",
    hint: "PDF file · Pages are exported separately",
    multiple: false,
  },
  "word-pdf": {
    title: "Word to PDF",
    description: "Convert a DOCX file into a downloadable PDF.",
    accept:
      ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    hint: "DOCX files · Complex formatting may change",
    multiple: false,
  },
  "pdf-word": {
    title: "PDF to Word",
    description: "Extract selectable PDF text into an editable DOCX file.",
    accept: ".pdf,application/pdf",
    hint: "PDF file · Scanned pages need OCR, not included",
    multiple: false,
  },
  split: {
    title: "Split PDF",
    description: "Choose page numbers or ranges to create a smaller PDF.",
    accept: ".pdf,application/pdf",
    hint: "PDF file · Example pages: 1, 3-5",
    multiple: false,
  },
  compress: {
    title: "Compress PDF",
    description: "Optimize a PDF structure. Size reduction varies by file.",
    accept: ".pdf,application/pdf",
    hint: "PDF file · Embedded images are not recompressed",
    multiple: false,
  },
};

const TOOL_LIST = [
  ["image-pdf", "▧", "Image to PDF", "purple"],
  ["merge", "⊞", "Merge PDFs", "blue"],
  ["pdf-image", "▣", "PDF to Image", "orange"],
  ["word-pdf", "W", "Word to PDF", "blue"],
  ["pdf-word", "W", "PDF to Word", "blue"],
  ["split", "✂", "Split PDF", "orange"],
  ["compress", "⌄", "Compress PDF", "green"],
];

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function safeName(filename) {
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 100) || "document"
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("An image could not be opened."));
    img.src = src;
  });
}

function parsePageRanges(input, pageCount) {
  const parts = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const pages = new Set();

  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let start = Number(range[1]);
      let end = Number(range[2]);
      if (start > end) [start, end] = [end, start];
      if (start < 1 || end > pageCount)
        throw new Error(`Page range "${part}" is outside 1–${pageCount}.`);
      for (let page = start; page <= end; page += 1) pages.add(page - 1);
    } else if (/^\d+$/.test(part)) {
      const page = Number(part);
      if (page < 1 || page > pageCount)
        throw new Error(`Page ${page} is outside 1–${pageCount}.`);
      pages.add(page - 1);
    } else {
      throw new Error(
        `Invalid page range "${part}". Use a format like 1, 3-5.`,
      );
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export default function App() {
  const [toolId, setToolId] = useState("image-pdf");
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("Ready to convert");
  const [dragging, setDragging] = useState(false);
  const [imageFormat, setImageFormat] = useState("png");
  const [renderScale, setRenderScale] = useState("1.5");
  const [pageRanges, setPageRanges] = useState("");
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  const tool = TOOLS[toolId];
  const minFiles = toolId === "merge" ? 2 : 1;

  useEffect(() => {
    setFiles([]);
    setMessage("");
    setIsError(false);
    setPageRanges("");
    if (inputRef.current) inputRef.current.value = "";
  }, [toolId]);

  function notify(text, error = false) {
    setMessage(text);
    setIsError(error);
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const accepted = incoming.filter((file) => {
      if (toolId === "image-pdf") {
        return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
      }
      if (toolId === "word-pdf") return /\.docx$/i.test(file.name);
      return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    });

    if (accepted.length !== incoming.length) {
      notify("Some files have an unsupported format.", true);
    } else {
      notify("");
    }

    const limited = tool.multiple ? accepted : accepted.slice(0, 1);
    setFiles((previous) => {
      const next = tool.multiple ? [...previous, ...limited] : limited;
      return next.filter(
        (file, index, all) =>
          all.findIndex(
            (other) =>
              other.name === file.name &&
              other.size === file.size &&
              other.lastModified === file.lastModified,
          ) === index,
      );
    });
  }

  function removeFile(index) {
    setFiles((previous) => previous.filter((_, i) => i !== index));
  }

  async function imageToPdf() {
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const data = await readAsDataURL(file);
      const {
        img,
        width: imageWidth,
        height: imageHeight,
      } = await getImageDimensions(data);
      if (i > 0) pdf.addPage();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageWidth / imageWidth, pageHeight / imageHeight);
      const width = imageWidth * ratio;
      const height = imageHeight * ratio;
      const format = file.type === "image/png" ? "PNG" : "JPEG";
      pdf.addImage(
        img,
        format,
        (pageWidth - width) / 2,
        (pageHeight - height) / 2,
        width,
        height,
      );
    }
    pdf.save("images-converted.pdf");
  }

  async function mergePdfs() {
    const merged = await PDFDocument.create();
    for (const file of files) {
      const source = await PDFDocument.load(await file.arrayBuffer());
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }
    downloadBlob(
      new Blob([await merged.save()], { type: "application/pdf" }),
      "merged.pdf",
    );
  }

  async function pdfToImages() {
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(await files[0].arrayBuffer()),
    }).promise;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: Number(renderScale) });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const mime = imageFormat === "jpg" ? "image/jpeg" : "image/png";
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, mime, 0.92),
      );
      if (!blob) throw new Error(`Could not export page ${pageNo}.`);
      downloadBlob(
        blob,
        `${safeName(files[0].name)}-page-${pageNo}.${imageFormat}`,
      );
      canvas.width = 0;
      canvas.height = 0;
    }
    if (pdf.numPages > 1)
      notify(
        `${pdf.numPages} images created. Your browser may ask you to allow multiple downloads.`,
      );
  }

  async function wordToPdf() {
    const file = files[0];
    const result = await mammoth.convertToHtml({
      arrayBuffer: await file.arrayBuffer(),
    });
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "position:fixed;left:-10000px;top:0;width:760px;background:white;color:#222;font:12pt Arial,sans-serif;padding:36px;line-height:1.5;";
    wrapper.innerHTML = result.value || "<p>No document text found.</p>";
    wrapper.querySelectorAll("img").forEach((img) => {
      img.style.maxWidth = "100%";
    });
    document.body.appendChild(wrapper);
    try {
      await html2pdf()
        .set({
          margin: 10,
          filename: `${safeName(file.name)}.pdf`,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: { scale: 1.5, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(wrapper)
        .save();
      notify("PDF created. Some Word formatting may have changed.");
    } finally {
      wrapper.remove();
    }
  }

  async function pdfToWord() {
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(await files[0].arrayBuffer()),
    }).promise;
    const paragraphs = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      let line = "";
      let previousY = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform?.[5] ?? 0;
        if (previousY !== null && Math.abs(y - previousY) > 3 && line.trim()) {
          paragraphs.push(new Paragraph({ text: line.trim() }));
          line = "";
        }
        line += item.str + (item.hasEOL ? "\n" : " ");
        previousY = y;
        if (item.hasEOL && line.trim()) {
          paragraphs.push(new Paragraph({ text: line.trim() }));
          line = "";
        }
      }
      if (line.trim()) paragraphs.push(new Paragraph({ text: line.trim() }));
    }
    if (!paragraphs.length) {
      throw new Error(
        "No selectable text found. Scanned PDFs require OCR, which is not included.",
      );
    }
    const doc = new Document({
      sections: [{ properties: {}, children: paragraphs }],
    });
    downloadBlob(await Packer.toBlob(doc), `${safeName(files[0].name)}.docx`);
    notify(
      "DOCX created from selectable text. Original layout, images and tables may not be preserved.",
    );
  }

  async function splitPdf() {
    const source = await PDFDocument.load(await files[0].arrayBuffer());
    const pageCount = source.getPageCount();

    if (pageRanges.trim()) {
      const indices = parsePageRanges(pageRanges, pageCount);
      if (!indices.length) throw new Error("Enter at least one page number.");
      const output = await PDFDocument.create();
      const pages = await output.copyPages(source, indices);
      pages.forEach((page) => output.addPage(page));
      downloadBlob(
        new Blob([await output.save()], { type: "application/pdf" }),
        `${safeName(files[0].name)}-split.pdf`,
      );
    } else {
      for (let i = 0; i < pageCount; i += 1) {
        const output = await PDFDocument.create();
        const [page] = await output.copyPages(source, [i]);
        output.addPage(page);
        downloadBlob(
          new Blob([await output.save()], { type: "application/pdf" }),
          `${safeName(files[0].name)}-page-${i + 1}.pdf`,
        );
      }
      if (pageCount > 1)
        notify(
          `${pageCount} PDFs created. Your browser may ask you to allow multiple downloads.`,
        );
    }
  }

  async function compressPdf() {
    const pdf = await PDFDocument.load(await files[0].arrayBuffer());
    if (removeMetadata) {
      pdf.setTitle("");
      pdf.setAuthor("");
      pdf.setSubject("");
      pdf.setKeywords([]);
      pdf.setProducer("PDF Studio");
      pdf.setCreator("PDF Studio");
    }
    const bytes = await pdf.save({ useObjectStreams: true });
    const blob = new Blob([bytes], { type: "application/pdf" });
    const reduction = Math.round((1 - blob.size / files[0].size) * 100);
    downloadBlob(blob, `${safeName(files[0].name)}-optimized.pdf`);
    notify(
      reduction > 0
        ? `Optimized file is about ${reduction}% smaller.`
        : "Optimized copy created. Size may be unchanged or larger; embedded images are not recompressed.",
    );
  }

  async function convert() {
    if (files.length < minFiles || busy) return;
    setBusy(true);
    setStatusText("Processing…");
    notify("");

    try {
      switch (toolId) {
        case "image-pdf":
          await imageToPdf();
          break;
        case "merge":
          await mergePdfs();
          break;
        case "pdf-image":
          await pdfToImages();
          break;
        case "word-pdf":
          await wordToPdf();
          break;
        case "pdf-word":
          await pdfToWord();
          break;
        case "split":
          await splitPdf();
          break;
        case "compress":
          await compressPdf();
          break;
        default:
          throw new Error("Select a tool first.");
      }
      setStatusText("Completed");
      if (!message) notify("Conversion complete. Check your downloads.");
    } catch (error) {
      console.error(error);
      setStatusText("Could not finish");
      notify(error.message || "Something went wrong. Try another file.", true);
    } finally {
      setBusy(false);
    }
  }

  function clearFiles() {
    setFiles([]);
    notify("");
    setStatusText("Ready when you are");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#" aria-label="PDF Studio home">
          <span className="brand-mark">P</span>
          <span>
            PDF<span className="brand-light">Studio</span>
          </span>
        </a>
        <span className="privacy">
          <span className="privacy-dot" /> Files are processed in your browser
        </span>
      </header>

      <main className="page">
        <section className="intro">
          <span className="eyebrow">YOUR DOCUMENT WORKSPACE</span>
          <h1>
            Every PDF task, <span>made simple.</span>
          </h1>
          <p>
            Convert, organize and optimize your documents with a clean
            workspace.
          </p>
        </section>

        <section className="workspace">
          <aside className="sidebar">
            <p className="section-label">PDF TOOLS</p>
            {TOOL_LIST.map(([id, icon, label, color]) => (
              <button
                key={id}
                className={`tool-link ${toolId === id ? "active" : ""}`}
                onClick={() => setToolId(id)}
                aria-pressed={toolId === id}
              >
                <span className={`tool-icon ${color}`}>{icon}</span>
                {label}
              </button>
            ))}
            <div className="sidebar-note">
              <span>🔒</span>
              <p>
                <strong>Privacy first</strong>
                <br />
                Files stay on your device while browser tools process them.
              </p>
            </div>
          </aside>

          <section className="tool-panel">
            <div className="panel-heading">
              <div>
                <div className="panel-kicker">SELECTED TOOL</div>
                <h2>{tool.title}</h2>
                <p>{tool.description}</p>
              </div>
              <span className="step-pill">
                01 <span>/</span> 03
              </span>
            </div>

            <div
              ref={dropRef}
              className={`drop-zone ${dragging ? "drag-over" : ""}`}
              role="button"
              tabIndex={0}
              onClick={(event) => {
                if (!event.target.closest("button")) inputRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              <div className="upload-art">
                <span>↑</span>
              </div>
              <h3>Drop your files here</h3>
              <p>{tool.hint}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => inputRef.current?.click()}
              >
                Choose files
              </button>
              <div className="format-hint">Click to browse your device</div>
            </div>

            <input
              ref={inputRef}
              type="file"
              hidden
              accept={tool.accept}
              multiple={tool.multiple}
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />

            <div className="options-area">
              {toolId === "pdf-image" && (
                <div className="option-row">
                  <label>
                    Image format
                    <select
                      value={imageFormat}
                      onChange={(event) => setImageFormat(event.target.value)}
                    >
                      <option value="png">PNG (clearer)</option>
                      <option value="jpg">JPG (smaller)</option>
                    </select>
                  </label>
                  <label>
                    Scale
                    <select
                      value={renderScale}
                      onChange={(event) => setRenderScale(event.target.value)}
                    >
                      <option value="1">Standard</option>
                      <option value="1.5">High</option>
                      <option value="2">Very high</option>
                    </select>
                  </label>
                </div>
              )}
              {toolId === "split" && (
                <div className="option-row">
                  <label>
                    Pages / ranges
                    <input
                      value={pageRanges}
                      onChange={(event) => setPageRanges(event.target.value)}
                      placeholder="e.g. 1, 3-5"
                    />
                  </label>
                  <span>Leave blank to split every page.</span>
                </div>
              )}
              {toolId === "compress" && (
                <div className="option-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={removeMetadata}
                      onChange={(event) =>
                        setRemoveMetadata(event.target.checked)
                      }
                    />
                    Remove common document metadata
                  </label>
                  <span>Embedded images are not recompressed.</span>
                </div>
              )}
              {toolId === "word-pdf" && (
                <div className="option-row">
                  DOCX supported. Complex formatting may change.
                </div>
              )}
              {toolId === "pdf-word" && (
                <div className="option-row">
                  Scanned PDFs require OCR, which is not included.
                </div>
              )}
            </div>

            {files.length > 0 && (
              <div className="file-list-wrap">
                <div className="file-list-heading">
                  <strong>Selected files ({files.length})</strong>
                  <button
                    type="button"
                    className="text-button"
                    onClick={clearFiles}
                  >
                    Remove all
                  </button>
                </div>
                <div className="file-list">
                  {files.map((file, index) => (
                    <div
                      className="file-item"
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                    >
                      <div className="file-badge">
                        {file.name.split(".").pop().slice(0, 4).toUpperCase()}
                      </div>
                      <div className="file-meta">
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{sizeLabel(file.size)}</div>
                      </div>
                      <button
                        type="button"
                        className="remove-file"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => removeFile(index)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="action-row">
              <div className="status-wrap">
                <span className={`status-indicator ${busy ? "working" : ""}`} />
                <span id="statusText" aria-live="polite">{statusText}</span>
              </div>
              <button
                className="primary-button"
                onClick={convert}
                disabled={busy || files.length < minFiles}
              >
                {busy ? "Processing…" : `${tool.title} →`}
              </button>
            </div>

            {message && (
              <p
                className={`message ${isError ? "error" : ""}`}
                role="status"
                aria-live="polite"
              >
                {message}
              </p>
            )}
            <p className="disclaimer">
              Complex layouts, scanned PDFs and large files may need a dedicated
              desktop converter. Compression is best-effort.
            </p>
          </section>
        </section>

        <section className="benefits">
          <div>
            <span className="benefit-icon">✓</span>
            <p>
              <strong>Simple workflow</strong>
              <br />
              <small>Choose a tool and add files</small>
            </p>
          </div>
          <div>
            <span className="benefit-icon">⚡</span>
            <p>
              <strong>Quick processing</strong>
              <br />
              <small>Runs locally in your browser</small>
            </p>
          </div>
          <div>
            <span className="benefit-icon">⌁</span>
            <p>
              <strong>No account needed</strong>
              <br />
              <small>Download results directly</small>
            </p>
          </div>
        </section>
      </main>

      <footer>
        <span>© 2026 <strong>Sync Soft Solution.</strong> All rights reserved.</span>
        <span>Built with React</span>
      </footer>
    </>
  );
}
