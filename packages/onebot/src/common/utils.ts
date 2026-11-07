import type { AnyMessageSegment } from '../message/segments';

const escapeMap: Record<string, string> = {
  '&': '&amp;',
  '[': '&#91;',
  ']': '&#93;',
  ',': '&#44;',
  '#': '&num;'
};

const unescapeMap: Record<string, string> = {
  '&amp;': '&',
  '&#91;': '[',
  '&#93;': ']',
  '&#44;': ',',
  '&num;': '#'
};

function escapeCQCode(value: string): string {
  return value.replace(/[&[\],#]/g, s => escapeMap[s]!);
}

function unescapeCQCode(value: string): string {
  return value.replace(/&(?:amp|#91|#93|#44|num);/g, s => unescapeMap[s]!);
}

function kvObj(obj: Record<string, unknown>, prefix: string = '') {
  const result: string[] = [];
  for (const k in obj) {
    const key = `${prefix}${prefix ? '#' : ''}${escapeCQCode(k)}`;
    if (typeof obj[k] !== 'object') {
      result.push(`${key}=${escapeCQCode(`${obj[k] as string}`)}`);
    } else if (obj[k]) {
      result.push(...kvObj(obj[k] as Record<string, unknown>, key));
    }
  }
  return result;
}

export function toCQCode(message: AnyMessageSegment): string;
export function toCQCode(messages: AnyMessageSegment[]): string;

export function toCQCode(messages: AnyMessageSegment | AnyMessageSegment[]): string {
  let result = '';
  if (!Array.isArray(messages)) {
    messages = [messages];
  }
  messages.forEach(item => {
    const segment: string[] = [];
    segment.push(`CQ:${item.type}`);
    segment.push(...kvObj(item.data));
    result += '[' + segment.join(',') + ']';
  });
  return result;
}

function setValue(target: Record<string, unknown>, keys: string[], value: string) {
  let current = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    const next = current[key];
    if (!next || typeof next !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

export function fromCQCode(code: string): AnyMessageSegment[] {
  const result: AnyMessageSegment[] = [];
  const regex = /\[CQ:([^,\]]+)((?:,[^\]]*)?)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code))) {
    if (match.index > lastIndex) {
      result.push({
        type: 'text',
        data: { text: code.slice(lastIndex, match.index) }
      });
    }

    const type = match[1];
    const data: Record<string, unknown> = {};
    for (const pair of match[2]!.slice(1).split(',')) {
      if (!pair) {
        continue;
      }
      const index = pair.indexOf('=');
      if (index === -1) {
        setValue(data, pair.split('#').map(unescapeCQCode), '');
      } else {
        setValue(
          data,
          pair.slice(0, index).split('#').map(unescapeCQCode),
          unescapeCQCode(pair.slice(index + 1))
        );
      }
    }

    result.push({ type, data } as unknown as AnyMessageSegment);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < code.length) {
    result.push({ type: 'text', data: { text: code.slice(lastIndex) } });
  }
  return result;
}
