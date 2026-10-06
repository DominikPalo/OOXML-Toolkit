/** Writes small sample packages (and slightly changed variants for trying out "Compare") to ./samples. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PackageModel } from '../src/core/package/model';
import { buildDocx, buildPptx, buildXlsx } from '../tests/fixtures/builders';

const dir = join(process.cwd(), 'samples');
mkdirSync(dir, { recursive: true });

/** A document with typical corruption, for trying out the package check. */
function buildBrokenDocx(): Uint8Array {
  const m = PackageModel.open(buildDocx({ title: 'Quarterly report' }));
  m.removePart('word/media/image1.png'); // dangling image relationship
  m.setText('word/styles.xml', m.getText('word/styles.xml').text.replace('</w:styles>', '')); // not well-formed
  m.addPart('word/notes-draft.xml', '<draft/>'); // unreferenced part
  m.addPart('customXml/data.custom', 'no content type for this extension');
  return m.serialize();
}

const files: Record<string, Uint8Array> = {
  'sample.docx': buildDocx(),
  'sample-v2.docx': buildDocx({
    heading: 'Hello, OOXML (revised)',
    paragraphs: [
      'This is a sample paragraph with some text.',
      'A brand new second paragraph.',
      'The end.',
      'An extra closing paragraph.',
    ],
  }),
  'sample-broken.docx': buildBrokenDocx(),
  'sample.xlsx': buildXlsx(),
  'sample-v2.xlsx': buildXlsx({ b2: 99, sheetName: 'Fruit & Veg' }),
  'sample.pptx': buildPptx(),
  'sample-v2.pptx': buildPptx({
    slides: [
      { title: 'Welcome', body: 'First slide body text' },
      { title: 'Agenda (updated)', body: 'Second slide body text' },
      { title: 'Next steps', body: 'A third slide' },
    ],
  }),
};

for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(dir, name), data);
  console.log(`samples/${name}  (${data.length} bytes)`);
}
