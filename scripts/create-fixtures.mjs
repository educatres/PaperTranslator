import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
const pdf = await PDFDocument.create(),
  regular = await pdf.embedFont(StandardFonts.TimesRoman),
  bold = await pdf.embedFont(StandardFonts.TimesRomanBold),
  sans = await pdf.embedFont(StandardFonts.Helvetica);
const green = rgb(0.22, 0.36, 0.28),
  gray = rgb(0.28, 0.3, 0.26);
function paragraph(page, text, x, y, width = 235, size = 11) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    if (regular.widthOfTextAtSize(`${line} ${word}`, size) > width && line) {
      page.drawText(line, { x, y, size, font: regular, color: gray });
      y -= 14;
      line = word;
    } else line += `${line ? " " : ""}${word}`;
  }
  if (line) {
    page.drawText(line, { x, y, size, font: regular, color: gray });
    y -= 14;
  }
  return y - 13;
}
const paragraphs = [
  "Reading is an active process of connecting evidence with questions. A useful research practice is to pause at the end of a paragraph and ask what the author has established, what remains uncertain, and which observation supports the claim.",
  "Translation can reduce the effort of reading a second language. It is most useful when the original text remains visible, allowing the reader to compare terminology, numerical values, and the limits of a statement. A translation is an aid to interpretation rather than independent evidence.",
  "Page and column boundaries belong to the printed layout. When an argument continues across a boundary, each visible fragment should retain its own source position. This makes it possible to return to the exact passage without silently combining unrelated material.",
  "Local storage gives readers control over their research materials. The original document, paragraph positions, translations, and summaries can be kept on one device. A portable archive provides a separate copy that can later restore the same reading context.",
  "A document summary offers a wider perspective. It should distinguish the research question, methods, findings, and limitations, while preserving the pages from which each observation was drawn. Readers still need to return to the original text to assess the evidence.",
];
for (let i = 0; i < 2; i++) {
  const page = pdf.addPage([612, 792]);
  page.drawText("PAPERTRANSLATOR / READING EXAMPLE", {
    x: 55,
    y: 752,
    size: 8,
    font: sans,
    color: green,
  });
  if (i === 0) {
    page.drawText("A closer look, a clearer thought", {
      x: 55,
      y: 709,
      size: 24,
      font: bold,
      color: green,
    });
    page.drawText(
      "A synthetic document for trying paragraph-by-paragraph reading",
      { x: 55, y: 684, size: 10, font: regular, color: gray },
    );
    page.drawLine({
      start: { x: 55, y: 661 },
      end: { x: 557, y: 661 },
      thickness: 0.5,
      color: rgb(0.75, 0.8, 0.69),
    });
  }
  let left = i ? 704 : 632,
    right = i ? 704 : 632;
  page.drawText(
    i ? "3. Returning to the evidence" : "1. Reading with intention",
    { x: 55, y: left, size: 13, font: bold, color: green },
  );
  left -= 28;
  page.drawText(
    i ? "4. Keeping a reading context" : "2. Translation by your side",
    { x: 322, y: right, size: 13, font: bold, color: green },
  );
  right -= 28;
  for (let j = 0; j < 3; j++) {
    left = paragraph(
      page,
      paragraphs[(i * 2 + j) % paragraphs.length],
      55,
      left,
      235,
    );
    right = paragraph(
      page,
      paragraphs[(i * 2 + j + 1) % paragraphs.length],
      322,
      right,
      235,
    );
  }
  page.drawText(
    "Demonstration text only. This is not a published research paper.",
    { x: 55, y: 52, size: 8, font: regular, color: gray },
  );
  page.drawText(String(i + 1), {
    x: 550,
    y: 31,
    size: 9,
    font: regular,
    color: gray,
  });
}
pdf.setTitle("A closer look, a clearer thought");
pdf.setAuthor("PaperTranslator");
await mkdir("public", { recursive: true });
await writeFile("public/sample.pdf", await pdf.save());
const cropped = await PDFDocument.create();
const font = await cropped.embedFont(StandardFonts.Helvetica);
const page = cropped.addPage([620, 840]);
page.setCropBox(20, 30, 580, 780);
page.setRotation(degrees(90));
page.drawText("CropBox and rotation fixture", {
  x: 55,
  y: 760,
  font,
  size: 18,
});
for (let n = 0; n < 6; n++)
  page.drawText(`A continuous paragraph, line ${n + 1} with evidence.`, {
    x: 55,
    y: 710 - n * 17,
    font,
    size: 11,
  });
await mkdir("tests/fixtures", { recursive: true });
await writeFile("tests/fixtures/cropped-rotated.pdf", await cropped.save());
