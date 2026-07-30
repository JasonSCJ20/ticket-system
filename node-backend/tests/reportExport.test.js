import { generateExecutivePdf, toCsv } from '../src/services/reportExport.js';

describe('toCsv', () => {
  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('renders a header row from the keys of the first object', () => {
    const csv = toCsv([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,title');
    expect(lines[1]).toBe('1,a');
    expect(lines[2]).toBe('2,b');
  });

  it('quotes and escapes a field containing a comma', () => {
    const csv = toCsv([{ id: 1, title: 'hello, world' }]);
    expect(csv.split('\n')[1]).toBe('1,"hello, world"');
  });

  it('quotes and escapes a field containing a double quote', () => {
    const csv = toCsv([{ id: 1, title: 'she said "hi"' }]);
    expect(csv.split('\n')[1]).toBe('1,"she said ""hi"""');
  });

  it('quotes a field containing a newline', () => {
    const csv = toCsv([{ id: 1, title: 'line one\nline two' }]);
    expect(csv.split('\n')[1]).toBe('1,"line one');
    expect(csv).toContain('"line one\nline two"');
  });

  it('renders null/undefined as an empty cell, not the literal string', () => {
    const csv = toCsv([{ id: 1, title: null, notes: undefined }]);
    expect(csv.split('\n')[1]).toBe('1,,');
  });
});

describe('generateExecutivePdf', () => {
  it('produces a real, non-empty PDF buffer starting with the %PDF magic header', async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      headline: 'Test headline',
      posture: 'watch',
      riskIndex: 42,
      metrics: { totalTickets: 5, activeTickets: 2 },
    };
    const buffer = await generateExecutivePdf(report);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
