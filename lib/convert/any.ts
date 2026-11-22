/**
 * 🔁 Conversiones entre tipos distintos, dentro del navegador:
 * cualquier documento, PDF, planilla, presentación o imagen → PDF y → PowerPoint (.pptx).
 * PowerPoint: una diapositiva por página (o por imagen).
 */
export type Kind = 'video' | 'audio' | 'image' | 'doc' | 'sheet' | 'slides' | 'pdf' | 'other';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const base = (n: string) => n.replace(/\.[a-z0-9]+$/i, '') || 'archivo';

/** Páginas de un PDF como imágenes PNG (escala 1.6 ≈ 130 ppp). */
export async function pdfToImages(src: Blob, scale = 1.6, max = 200, onProgress?: (p: number) => void): Promise<{ blob: Blob; w: number; h: number }[]> {
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(await src.arrayBuffer()));
  const out: { blob: Blob; w: number; h: number }[] = [];
  const n = Math.min(doc.numPages, max);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp } as never).promise;
    out.push({ blob: await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png')), w: canvas.width, h: canvas.height });
    onProgress?.(i / n);
  }
  return out;
}

async function imageSize(b: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(b); const r = { w: bmp.width, h: bmp.height }; bmp.close(); return r;
}
async function toPng(b: Blob): Promise<Blob> {
  if (b.type === 'image/png' || b.type === 'image/jpeg') return b;
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0);
  return new Promise((r) => c.toBlob((x) => r(x!), 'image/png'));
}
const dataUrl = (b: Blob) => new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(String(f.result)); f.readAsDataURL(b); });

/** Imágenes → PowerPoint: una diapositiva 16:9 por imagen, centrada y sin deformar. */
export async function imagesToPptx(imgs: { blob: Blob; w: number; h: number }[], title: string): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = title;
  const W = 13.333, H = 7.5;
  for (const im of imgs) {
    const s = pptx.addSlide(); s.background = { color: 'FFFFFF' };
    const k = Math.min(W / im.w, H / im.h); const w = im.w * k, h = im.h * k;
    s.addImage({ data: await dataUrl(await toPng(im.blob)), x: (W - w) / 2, y: (H - h) / 2, w, h });
  }
  const out = await pptx.write({ outputType: 'blob' });
  return new Blob([out as Blob], { type: PPTX_MIME });
}

/** Imágenes → PDF: una página por imagen. */
export async function imagesToPdf(imgs: { blob: Blob; w: number; h: number }[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const im of imgs) {
    const png = await toPng(im.blob);
    const bytes = new Uint8Array(await png.arrayBuffer());
    const img = png.type === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const page = pdf.addPage([im.w, im.h]); page.drawImage(img, { x: 0, y: 0, width: im.w, height: im.h });
  }
  return new Blob([await pdf.save() as BlobPart], { type: 'application/pdf' });
}

/** Cualquier documento → PDF. */
export async function anyToPdf(src: Blob, name: string, kind: Kind): Promise<Blob> {
  if (kind === 'pdf') return src;
  if (kind === 'image') return imagesToPdf([{ blob: src, ...(await imageSize(src)) }]);
  if (kind === 'doc') { const d = await import('@/lib/convert/docs'); return d.exportDocument(await d.readDocument(src, name), base(name), 'pdf'); }
  if (kind === 'sheet') { const s = await import('@/lib/office/sheet'); return s.exportWorkbook(await s.readWorkbook(src, name), base(name), 'pdf'); }
  if (kind === 'slides') { const s = await import('@/lib/office/deck'); return s.exportDeck(await s.readPptx(src), base(name), 'pdf'); }
  throw new Error('Este tipo de archivo no se puede pasar a PDF.');
}

/** Cualquier documento → PowerPoint (una diapositiva por página). */
export async function anyToPptx(src: Blob, name: string, kind: Kind, onProgress?: (p: number, m: string) => void): Promise<Blob> {
  if (kind === 'slides') return src;
  if (kind === 'image') return imagesToPptx([{ blob: src, ...(await imageSize(src)) }], base(name));
  onProgress?.(0.2, 'Preparando las páginas…');
  const pdf = await anyToPdf(src, name, kind);
  const pages = await pdfToImages(pdf, 1.6, 200, (p) => onProgress?.(0.2 + p * 0.6, 'Creando las diapositivas…'));
  onProgress?.(0.85, 'Armando el PowerPoint…');
  return imagesToPptx(pages, base(name));
}

/** Cualquier documento → imágenes en un .zip (una por página). */
export async function anyToImagesZip(src: Blob, name: string, kind: Kind): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const pages = kind === 'image' ? [{ blob: await toPng(src) }] : await pdfToImages(await anyToPdf(src, name, kind), 2);
  pages.forEach((p, i) => zip.file(`${base(name)}-${String(i + 1).padStart(3, '0')}.png`, p.blob));
  return zip.generateAsync({ type: 'blob' });
}
