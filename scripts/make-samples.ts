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
  // Documents with tags: keywords, custom properties, Word document variables and PowerPoint tags.
  'sample-tagged.docx': buildDocx({
    title: 'Master services agreement',
    keywords: 'contract; legal, 2026, ACME',
    category: 'Finance',
    customProperties: [
      { name: 'Project', value: 'Atlas' },
      { name: 'Revision', kind: 'i4', value: '7' },
      { name: 'Reviewed', kind: 'bool', value: 'true' },
      { name: 'DueDate', kind: 'filetime', value: '2026-11-30T12:00:00Z' },
      { name: 'MSIP_Label_0f1a2b3c_Name', value: 'Confidential' },
    ],
    documentVariables: { Customer: 'ACME Corp.', ContractNumber: 'MSA-2026-0042' },
  }),
  'sample-tagged.pptx': buildPptx({
    keywords: 'kickoff; quarterly review',
    customProperties: [
      { name: 'SlidoAppVersion', value: '1.12.0.5601' },
      { name: 'MSIP_Label_0f1a2b3c_Name', value: 'Internal' },
    ],
    slides: [
      { title: 'Welcome', body: 'First slide body text' },
      { title: 'Agenda', body: 'Second slide body text' },
      { title: 'Live poll', body: 'Third slide body text' },
    ],
    tags: {
      presentation: {
        SLIDO_APP_VERSION: '1.12.0.5601',
        SLIDO_EVENT_UUID: '60b890ad-90e0-45ca-bf8b-e5cc66d7b4cc',
      },
      slides: [
        undefined,
        { SLIDO_SLIDE_TYPE: 'agenda' },
        { SLIDO_POLL_ID: 'p-2c91', SLIDO_SLIDE_TYPE: 'poll' },
      ],
    },
  }),
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
