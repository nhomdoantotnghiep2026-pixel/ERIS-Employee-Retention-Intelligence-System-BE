const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xmlToken = /<!--[^]*?-->|<!\[CDATA\[[^]*?\]\]>|<\?[^]*?\?>|<\/?[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
const maxUncompressedBytes = 32 * 1024 * 1024;

async function normalizePrefixedWorkbook(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookPart = zip.file('xl/workbook.xml');
  if (!workbookPart) return null;
  let remaining = maxUncompressedBytes;
  function readEntry(entry) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = entry.internalStream('nodebuffer');
      stream.on('data', chunk => {
        remaining -= chunk.length;
        if (remaining < 0) {
          stream.pause();
          reject(new Error('Workbook exceeds expanded size limit.'));
        } else {
          chunks.push(chunk);
        }
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.resume();
    });
  }

  const workbookXml = (await readEntry(workbookPart)).toString('utf8');
  const prefixedWorkbook = /<([\w.-]+):workbook(?=[\s>])/u.test(workbookXml);
  if (!prefixedWorkbook) return null;

  const normalized = new JSZip();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const data = entry === workbookPart ? workbookXml : await readEntry(entry);
    if (/^xl\/(?:workbook|styles|sharedStrings|worksheets\/sheet\d+)\.xml$/u.test(entry.name)) {
      const xml = data.toString();
      const root = xml.match(/<([\w.-]+):[\w.-]+(?=[\s>])[^>]*>/u);
      const prefix = root?.[1];
      const namespace = prefix && root[0].includes('xmlns:' + prefix + '="' + spreadsheetNamespace + '"');
      const updated = namespace ? xml.replace(xmlToken, token => {
        const tag = token.match(/^<(\/?)([\w.-]+):/u);
        if (tag?.[2] !== prefix) return token;
        return '<' + tag[1] + token.slice(tag[0].length)
          .replace('xmlns:' + prefix + '="' + spreadsheetNamespace + '"', 'xmlns="' + spreadsheetNamespace + '"');
      }) : xml;
      normalized.file(entry.name, updated);
    } else if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/u.test(entry.name)) {
      // Cell notes are not imported. ExcelJS cannot reconcile some absolute VML/comment targets.
      const xml = data.toString().replace(xmlToken, token =>
        /^<Relationship\s/u.test(token) && /\bType="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/(?:comments|vmlDrawing)"/u.test(token) ? '' : token);
      normalized.file(entry.name, xml);
    } else {
      normalized.file(entry.name, data);
    }
  }
  return normalized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function openEmployeeWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    return await workbook.xlsx.load(buffer);
  } catch (error) {
    const normalized = await normalizePrefixedWorkbook(buffer);
    if (!normalized) throw error;
    return new ExcelJS.Workbook().xlsx.load(normalized);
  }
}

module.exports = { openEmployeeWorkbook };
