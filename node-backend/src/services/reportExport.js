import PDFDocument from 'pdfkit';

// Real PDF generation via pdfkit — no headless browser, no external
// service call, just a document built directly from the report data
// already computed by executiveReport()/technicalReport(). Returns a
// Buffer, ready to stream as an attachment.
export function generateExecutivePdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('CommandCentre Executive Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).fillColor('gray').text(`Generated: ${report.generatedAt}`, { align: 'center' });
    doc.moveDown(2);

    doc.fillColor('black').fontSize(14).text('Headline');
    doc.fontSize(11).text(report.headline);
    doc.moveDown();

    doc.fontSize(14).text('Posture');
    doc.fontSize(11).text(`${report.posture} (risk index: ${report.riskIndex}/100)`);
    doc.moveDown();

    doc.fontSize(14).text('Metrics');
    Object.entries(report.metrics || {}).forEach(([key, value]) => {
      doc.fontSize(11).text(`${key}: ${value}`);
    });

    doc.end();
  });
}

// A generic, dependency-free CSV serializer — proper quoting for any field
// containing a comma, quote, or newline (the RFC 4180 rule), so this is
// safe for arbitrary report/finding/ticket text content, not just simple
// numbers.
export function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);

  const escapeCell = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(','));
  }
  return lines.join('\n');
}
