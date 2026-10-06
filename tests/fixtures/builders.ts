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

export interface CustomProperty {
  name: string;
  /** Variant type of the value (default `lpwstr`, i.e. text). */
  kind?: 'lpwstr' | 'i4' | 'bool' | 'filetime' | 'r8';
  value: string;
}

/** Optional document metadata ("tags") for the generated packages. */
export interface MetadataOptions {
  /** `cp:keywords` — what Explorer / Finder show as tags. */
  keywords?: string;
  category?: string;
  customProperties?: CustomProperty[];
}

const CT_CUSTOM = 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
const CT_TAGS = 'application/vnd.openxmlformats-officedocument.presentationml.tags+xml';
const CT_SETTINGS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function docProps(title: string, app: string, meta: MetadataOptions = {}): Files {
  const files: Files = {
    'docProps/core.xml':
      DECL +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${title}</dc:title><dc:creator>OOXML Toolkit</dc:creator>` +
      (meta.keywords ? `<cp:keywords>${esc(meta.keywords)}</cp:keywords>` : '') +
      (meta.category ? `<cp:category>${esc(meta.category)}</cp:category>` : '') +
      '<dcterms:created xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2024-01-15T10:30:00Z</dcterms:modified></cp:coreProperties>',
    'docProps/app.xml':
      DECL +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${app}</Application></Properties>`,
  };
  if (meta.customProperties?.length) {
    files['docProps/custom.xml'] =
      DECL +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      meta.customProperties
        .map(
          (p, i) =>
            `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(p.name)}"><vt:${p.kind ?? 'lpwstr'}>${esc(p.value)}</vt:${p.kind ?? 'lpwstr'}></property>`,
        )
        .join('') +
      '</Properties>';
  }
  return files;
}

const metaOverrides = (meta: MetadataOptions): Array<[string, string]> =>
  meta.customProperties?.length ? [['/docProps/custom.xml', CT_CUSTOM]] : [];

const CT_CORE = 'application/vnd.openxmlformats-package.core-properties+xml';
const CT_APP = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';
const PKG_ROOT_RELS = (main: string, meta: MetadataOptions = {}): string =>
  rels([
    ['rId1', `${REL}/officeDocument`, main],
    [
      'rId2',
      'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
      'docProps/core.xml',
    ],
    ['rId3', `${REL}/extended-properties`, 'docProps/app.xml'],
    ...(meta.customProperties?.length
      ? [['rId4', `${REL}/custom-properties`, 'docProps/custom.xml'] as [string, string, string]]
      : []),
  ]);

// ---------------------------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------------------------

export interface DocxOptions extends MetadataOptions {
  title?: string;
  paragraphs?: string[];
  /** Extra attribute value to make two documents differ. */
  heading?: string;
  /** `w:docVars` in word/settings.xml. */
  documentVariables?: Record<string, string>;
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
        ...metaOverrides(opts),
        ...(opts.documentVariables
          ? ([['/word/settings.xml', CT_SETTINGS]] as Array<[string, string]>)
          : []),
      ],
    ),
    '_rels/.rels': PKG_ROOT_RELS('word/document.xml', opts),
    ...docProps(title, 'Microsoft Office Word', opts),
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
      ...(opts.documentVariables
        ? [['rId4', `${REL}/settings`, 'settings.xml'] as [string, string, string]]
        : []),
    ]),
    'word/media/image1.png': PNG_1X1,
    ...(opts.documentVariables
      ? {
          'word/settings.xml':
            DECL +
            `<w:settings xmlns:w="${W}"><w:docVars>` +
            Object.entries(opts.documentVariables)
              .map(([k, v]) => `<w:docVar w:name="${esc(k)}" w:val="${esc(v)}"/>`)
              .join('') +
            '</w:docVars></w:settings>',
        }
      : {}),
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

export interface PptxOptions extends MetadataOptions {
  slides?: Array<{ title: string; body: string }>;
  /** PowerPoint tags (`ppt/tags/tagN.xml`) on the presentation and on individual slides (by index). */
  tags?: {
    presentation?: Record<string, string>;
    slides?: Array<Record<string, string> | undefined>;
  };
}

export function buildPptx(opts: PptxOptions = {}): Uint8Array {
  const slides = opts.slides ?? [
    { title: 'Welcome', body: 'First slide body text' },
    { title: 'Agenda', body: 'Second slide body text' },
  ];
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const tagParts: Files = {};
  const addTagPart = (values: Record<string, string>): string => {
    const name = `ppt/tags/tag${Object.keys(tagParts).length + 1}.xml`;
    tagParts[name] =
      DECL +
      `<p:tagLst xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}">` +
      Object.entries(values)
        .map(([k, v]) => `<p:tag name="${esc(k)}" val="${esc(v)}"/>`)
        .join('') +
      '</p:tagLst>';
    return name;
  };
  const presentationTag = opts.tags?.presentation ? addTagPart(opts.tags.presentation) : undefined;
  const slideTags = slides.map((_, i) => {
    const values = opts.tags?.slides?.[i];
    return values ? addTagPart(values) : undefined;
  });
  const slideXml = (s: { title: string; body: string }, tagRid?: string): string =>
    DECL +
    `<p:sld xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}"><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="7772400" cy="1143000"/></a:xfrm></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${s.title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="1828800"/><a:ext cx="7772400" cy="3429000"/></a:xfrm></p:spPr>' +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${s.body}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '</p:spTree>' +
    (tagRid ? `<p:custDataLst><p:tags r:id="${tagRid}"/></p:custDataLst>` : '') +
    '</p:cSld></p:sld>';
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
        ...metaOverrides(opts),
        ...Object.keys(tagParts).map((n): [string, string] => [`/${n}`, CT_TAGS]),
      ],
    ),
    '_rels/.rels': PKG_ROOT_RELS('ppt/presentation.xml', opts),
    ...docProps('Sample presentation', 'Microsoft Office PowerPoint', opts),
    ...tagParts,
    'ppt/presentation.xml':
      DECL +
      `<p:presentation xmlns:a="${A}" xmlns:r="${NS_R}" xmlns:p="${P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>` +
      '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/>' +
      (presentationTag
        ? `<p:custDataLst><p:tags r:id="rId${slides.length + 3}"/></p:custDataLst>`
        : '') +
      '</p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
      ...slides.map((_, i): [string, string, string] => [
        `rId${i + 2}`,
        `${REL}/slide`,
        `slides/slide${i + 1}.xml`,
      ]),
      [`rId${slides.length + 2}`, `${REL}/theme`, 'theme/theme1.xml'],
      ...(presentationTag
        ? [
            [`rId${slides.length + 3}`, `${REL}/tags`, presentationTag.replace('ppt/', '')] as [
              string,
              string,
              string,
            ],
          ]
        : []),
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
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml(s, slideTags[i] ? 'rId2' : undefined);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ...(slideTags[i]
        ? [
            ['rId2', `${REL}/tags`, `../${slideTags[i]!.replace('ppt/', '')}`] as [
              string,
              string,
              string,
            ],
          ]
        : []),
    ]);
  });
  return zipFiles(files);
}
