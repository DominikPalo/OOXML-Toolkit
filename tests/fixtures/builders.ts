/** Builders for small but structurally realistic OOXML packages (used by tests and `npm run samples`). */
import { writeZip } from '../../src/core/zip/zip';

export type Files = Record<string, string | Uint8Array>;

const enc = new TextEncoder();
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/** 1x1 PNG. */
export const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

export function zipFiles(files: Files): Uint8Array {
  return writeZip(
    Object.entries(files).map(([name, data]) => ({
      kind: 'data' as const,
      name,
      data: typeof data === 'string' ? enc.encode(data) : data,
      modified: new Date(2024, 0, 15, 10, 30, 0),
    })),
  );
}

const CT_REL = 'application/vnd.openxmlformats-package.relationships+xml';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function rels(items: Array<[id: string, type: string, target: string, mode?: string]>): string {
  return (
    DECL +
    `<Relationships xmlns="${PKG_REL}">` +
    items
      .map(
        ([id, type, target, mode]) =>
          `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`,
      )
      .join('') +
    '</Relationships>'
  );
}

function contentTypes(
  defaults: Array<[string, string]>,
  overrides: Array<[string, string]>,
): string {
  return (
    DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    defaults.map(([e, c]) => `<Default Extension="${e}" ContentType="${c}"/>`).join('') +
    overrides.map(([p, c]) => `<Override PartName="${p}" ContentType="${c}"/>`).join('') +
    '</Types>'
  );
}

function docProps(title: string, app: string): Files {
  return {
    'docProps/core.xml':
      DECL +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${title}</dc:title><dc:creator>OOXML Toolkit</dc:creator>` +
      '<dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:modified></cp:coreProperties>',
    'docProps/app.xml':
      DECL +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${app}</Application></Properties>`,
  };
}

const CT_CORE = 'application/vnd.openxmlformats-package.core-properties+xml';
const CT_APP = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';
const PKG_ROOT_RELS = (main: string): string =>
  rels([
    ['rId1', `${REL}/officeDocument`, main],
    [
      'rId2',
      'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
      'docProps/core.xml',
    ],
    ['rId3', `${REL}/extended-properties`, 'docProps/app.xml'],
  ]);

// ---------------------------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------------------------

export interface DocxOptions {
  title?: string;
  paragraphs?: string[];
  /** Extra attribute value to make two documents differ. */
  heading?: string;
}

export function buildDocx(opts: DocxOptions = {}): Uint8Array {
  const title = opts.title ?? 'Sample document';
  const heading = opts.heading ?? 'Hello, OOXML';
  const paragraphs = opts.paragraphs ?? [
    'This is a sample paragraph with some text.',
    'A second paragraph, with leading and trailing spaces preserved. ',
    'The end.',
  ];
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body =
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${heading}</w:t></w:r></w:p>` +
    paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('') +
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return zipFiles({
    '[Content_Types].xml': contentTypes(
      [
        ['rels', CT_REL],
        ['xml', 'application/xml'],
        ['png', 'image/png'],
      ],
      [
        [
          '/word/document.xml',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        ],
        [
          '/word/styles.xml',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
        ],
        ['/docProps/core.xml', CT_CORE],
        ['/docProps/app.xml', CT_APP],
      ],
    ),
    '_rels/.rels': PKG_ROOT_RELS('word/document.xml'),
    ...docProps(title, 'Microsoft Office Word'),
    'word/document.xml':
      DECL + `<w:document xmlns:w="${W}" xmlns:r="${NS_R}"><w:body>${body}</w:body></w:document>`,
    'word/styles.xml':
      DECL +
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>',
    'word/_rels/document.xml.rels': rels([
      ['rId1', `${REL}/styles`, 'styles.xml'],
      ['rId2', `${REL}/image`, 'media/image1.png'],
      ['rId3', `${REL}/hyperlink`, 'https://example.com/', 'External'],
    ]),
    'word/media/image1.png': PNG_1X1,
  });
}

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

export interface XlsxOptions {
  /** Value of cell B2 (default 42). */
  b2?: number;
  sheetName?: string;
}

export function buildXlsx(opts: XlsxOptions = {}): Uint8Array {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const strings = ['Name', 'Quantity', 'Apples', 'Pears', 'Total'];
  const sst =
    DECL +
    `<sst xmlns="${S}" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((s) => `<si><t>${s}</t></si>`).join('') +
    '</sst>';
  const sheet =
    DECL +
    `<worksheet xmlns="${S}" xmlns:r="${NS_R}"><dimension ref="A1:B4"/><sheetData>` +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>${opts.b2 ?? 42}</v></c></row>` +
    '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>17.5</v></c></row>' +
    '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4"><f>SUM(B2:B3)</f><v>59.5</v></c></row>' +
    '</sheetData></worksheet>';
  return zipFiles({
    '[Content_Types].xml': contentTypes(
      [
        ['rels', CT_REL],
        ['xml', 'application/xml'],
      ],
      [
        [
          '/xl/workbook.xml',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        ],
        [
          '/xl/worksheets/sheet1.xml',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
        ],
        [
          '/xl/sharedStrings.xml',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
        ],
        [
          '/xl/styles.xml',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
        ],
        ['/docProps/core.xml', CT_CORE],
        ['/docProps/app.xml', CT_APP],
      ],
    ),
    '_rels/.rels': PKG_ROOT_RELS('xl/workbook.xml'),
    ...docProps('Sample workbook', 'Microsoft Excel'),
    'xl/workbook.xml':
      DECL +
      `<workbook xmlns="${S}" xmlns:r="${NS_R}"><sheets><sheet name="${opts.sheetName ?? 'Fruit'}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([
      ['rId1', `${REL}/worksheet`, 'worksheets/sheet1.xml'],
      ['rId2', `${REL}/sharedStrings`, 'sharedStrings.xml'],
      ['rId3', `${REL}/styles`, 'styles.xml'],
    ]),
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': sst,
    'xl/styles.xml':
      DECL +
      `<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`,
  });
}

// ---------------------------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------------------------

export interface PptxOptions {
  slides?: Array<{ title: string; body: string }>;
}

export function buildPptx(opts: PptxOptions = {}): Uint8Array {
  const slides = opts.slides ?? [
    { title: 'Welcome', body: 'First slide body text' },
    { title: 'Agenda', body: 'Second slide body text' },
  ];
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const slideXml = (s: { title: string; body: string }): string =>
    DECL +
    `<p:sld xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}"><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="1143000"/></a:xfrm></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${s.title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="1828800"/><a:ext cx="7772400" cy="3429000"/></a:xfrm></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${s.body}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '</p:spTree></p:cSld></p:sld>';
  const files: Files = {
    '[Content_Types].xml': contentTypes(
      [
        ['rels', CT_REL],
        ['xml', 'application/xml'],
      ],
      [
        [
          '/ppt/presentation.xml',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
        ],
        [
          '/ppt/slideMasters/slideMaster1.xml',
          'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
        ],
        [
          '/ppt/slideLayouts/slideLayout1.xml',
          'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
        ],
        ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
        ...slides.map((_, i): [string, string] => [
          `/ppt/slides/slide${i + 1}.xml`,
          'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
        ]),
        ['/docProps/core.xml', CT_CORE],
        ['/docProps/app.xml', CT_APP],
      ],
    ),
    '_rels/.rels': PKG_ROOT_RELS('ppt/presentation.xml'),
    ...docProps('Sample presentation', 'Microsoft Office PowerPoint'),
    'ppt/presentation.xml':
      DECL +
      `<p:presentation xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>` +
      '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
      ...slides.map((_, i): [string, string, string] => [
        `rId${i + 2}`,
        `${REL}/slide`,
        `slides/slide${i + 1}.xml`,
      ]),
      [`rId${slides.length + 2}`, `${REL}/theme`, 'theme/theme1.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml':
      DECL +
      `<p:sldMaster xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>` +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ['rId2', `${REL}/theme`, '../theme/theme1.xml'],
    ]),
    'ppt/slideLayouts/slideLayout1.xml':
      DECL +
      `<p:sldLayout xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}" type="title"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([
      ['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml'],
    ]),
    'ppt/theme/theme1.xml':
      DECL +
      `<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1></a:clrScheme></a:themeElements></a:theme>`,
  };
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml(s);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
    ]);
  });
  return zipFiles(files);
}

// ---------------------------------------------------------------------------------------------
// ODP (OpenDocument presentation)
// ---------------------------------------------------------------------------------------------

export interface OdpOptions {
  title?: string;
  keywords?: string[];
  slides?: Array<{ title: string; body: string }>;
  userDefined?: Array<{
    name: string;
    value: string;
    type?: 'float' | 'date' | 'time' | 'boolean' | 'string';
  }>;
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';

const xmlEsc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** A small but structurally faithful ODP, laid out the way LibreOffice writes one. */
export function buildOdp(opts: OdpOptions = {}): Uint8Array {
  const mime = 'application/vnd.oasis.opendocument.presentation';
  const slides = opts.slides ?? [
    { title: 'Welcome', body: 'First slide body text' },
    { title: 'Agenda', body: 'Second slide body text' },
  ];
  const keywords = opts.keywords ?? [];
  const userDefined = opts.userDefined ?? [];
  const entry = (path: string, type: string): string =>
    `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${type}"/>`;

  const pages = slides
    .map(
      (s, i) =>
        `<draw:page draw:name="page${i + 1}" draw:master-page-name="Default">` +
        '<draw:frame presentation:class="title" svg:x="2cm" svg:y="1cm" svg:width="24cm" svg:height="3cm">' +
        `<draw:text-box><text:p>${xmlEsc(s.title)}</text:p></draw:text-box></draw:frame>` +
        '<draw:frame presentation:class="outline" svg:x="2cm" svg:y="5cm" svg:width="24cm" svg:height="8cm">' +
        `<draw:text-box><text:list><text:list-item><text:p>${xmlEsc(s.body)}</text:p></text:list-item></text:list></draw:text-box></draw:frame>` +
        (i === 0
          ? '<draw:frame svg:x="20cm" svg:y="10cm" svg:width="4cm" svg:height="4cm"><draw:image xlink:href="Pictures/image1.png" xlink:type="simple"/></draw:frame>'
          : '') +
        '</draw:page>',
    )
    .join('');

  return zipFiles({
    // `mimetype` first: ODF requires it to be the first entry (the writer stores it uncompressed).
    mimetype: mime,
    'META-INF/manifest.xml':
      DECL +
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
      `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/>` +
      entry('content.xml', 'text/xml') +
      entry('styles.xml', 'text/xml') +
      entry('meta.xml', 'text/xml') +
      entry('settings.xml', 'text/xml') +
      entry('Pictures/image1.png', 'image/png') +
      entry('Thumbnails/thumbnail.png', 'image/png') +
      '</manifest:manifest>',
    'content.xml':
      DECL +
      `<office:document-content ${ODF_NS} office:version="1.3"><office:scripts/><office:automatic-styles/>` +
      `<office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`,
    'styles.xml':
      DECL +
      `<office:document-styles ${ODF_NS} office:version="1.3"><office:automatic-styles>` +
      '<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout>' +
      '</office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles></office:document-styles>',
    'meta.xml':
      DECL +
      `<office:document-meta ${ODF_NS} office:version="1.3"><office:meta>` +
      '<meta:generator>LibreOffice/7.6.2.1$MacOSX_AARCH64 LibreOffice_project/1</meta:generator>' +
      `<dc:title>${xmlEsc(opts.title ?? 'Sample presentation')}</dc:title>` +
      '<dc:subject>Quarterly review</dc:subject>' +
      '<meta:initial-creator>OOXML Toolkit</meta:initial-creator>' +
      '<meta:creation-date>2024-01-15T10:30:00.123456789</meta:creation-date>' +
      '<dc:creator>Sample Editor</dc:creator>' +
      '<dc:date>2024-03-02T08:15:42.5</dc:date>' +
      '<dc:language>en-US</dc:language>' +
      '<meta:editing-cycles>3</meta:editing-cycles>' +
      '<meta:editing-duration>PT01H03M17S</meta:editing-duration>' +
      keywords.map((k) => `<meta:keyword>${xmlEsc(k)}</meta:keyword>`).join('') +
      userDefined
        .map(
          (u) =>
            `<meta:user-defined meta:name="${xmlEsc(u.name)}"${u.type ? ` meta:value-type="${u.type}"` : ''}>${xmlEsc(u.value)}</meta:user-defined>`,
        )
        .join('') +
      `<meta:document-statistic meta:page-count="${slides.length}" meta:object-count="${slides.length * 3}"/>` +
      '</office:meta></office:document-meta>',
    'settings.xml':
      DECL +
      `<office:document-settings ${ODF_NS} office:version="1.3"><office:settings/></office:document-settings>`,
    'Pictures/image1.png': PNG_1X1,
    'Thumbnails/thumbnail.png': PNG_1X1,
  });
}
