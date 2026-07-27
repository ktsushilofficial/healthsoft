import { PDFDocument } from 'pdf-lib';
import { createEcgReportPdfBase64 } from '../src/utils/ecgReport';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlD8AAAAASUVORK5CYII=';

describe('ECG report export', () => {
  it('creates a valid single-page A4 PDF from a PNG report', async () => {
    const base64 = await createEcgReportPdfBase64(
      ONE_PIXEL_PNG,
      'Healthsoft waveform report',
    );
    const document = await PDFDocument.load(base64);
    const [page] = document.getPages();

    expect(document.getPageCount()).toBe(1);
    expect(page.getWidth()).toBeCloseTo(595.28, 1);
    expect(page.getHeight()).toBeCloseTo(841.89, 1);
  });
});
