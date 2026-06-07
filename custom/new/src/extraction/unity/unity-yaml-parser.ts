import { parseDocument } from 'yaml';

export interface UnityDoc {
  classId: number;
  fileId: string;
  stripped: boolean;
  body: Record<string, any>;
  line: number;
}

const HEADER_RE = /^--- !u!(\d+) &(-?\d+)(\s+stripped)?\s*$/;

/** Cheap guard: Unity text assets start with %YAML or a document marker. */
export function isUnityTextAsset(content: string): boolean {
  const head = content.slice(0, 64).trimStart();
  return head.startsWith('%YAML') || head.startsWith('---');
}

export function parseUnityYaml(content: string): UnityDoc[] {
  if (!isUnityTextAsset(content)) return [];

  const lines = content.split('\n');
  const docs: UnityDoc[] = [];
  let cur: {
    classId: number;
    fileId: string;
    stripped: boolean;
    line: number;
    bodyLines: string[];
  } | null = null;

  const flush = () => {
    if (!cur) return;
    try {
      const parsed = parseDocument(quoteUnsafeUnityFileIds(cur.bodyLines.join('\n')), { strict: false }).toJS() || {};
      docs.push({
        classId: cur.classId,
        fileId: cur.fileId,
        stripped: cur.stripped,
        body: parsed,
        line: cur.line,
      });
    } catch {
      /* skip malformed documents, keep parsing the rest */
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = HEADER_RE.exec(line);
    if (match) {
      flush();
      cur = {
        classId: Number(match[1]!),
        fileId: match[2]!,
        stripped: Boolean(match[3]),
        line: i + 1,
        bodyLines: [],
      };
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  flush();

  return docs;
}

function quoteUnsafeUnityFileIds(content: string): string {
  return content
    .replace(/(\bfileID:\s*)(-?\d{16,})(?=\s*[,}\r\n])/g, '$1"$2"')
    .replace(/(\bguid:\s*)([0-9a-fA-F]{32})(?=\s*[,}\r\n])/g, '$1"$2"');
}
