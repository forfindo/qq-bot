import zlib from 'zlib';
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import type { MessageEvent, NoticeEvent, RequestEvent } from '@xopenbot/onebot';

const dataPath = path.resolve(process.env.dataPath || './data');
const contextFile = path.join(dataPath, 'context');
const fnFile = path.join(dataPath, 'context.fn');
const initCodeFile = path.join(import.meta.dirname, 'sandbox.code.js');

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true, mode: 0o700 });
}

//初始化context
let context: {
  isProtected?: (key: string) => boolean;
  isMaster?: () => boolean;
  recordSetHistory?: (key: string) => void;
  set_history_allowed?: boolean;
  data?: MessageEvent | NoticeEvent | RequestEvent;
  [key: string]: unknown;
} = {
  set_history_allowed: false
};
//还原context中的数据
if (fs.existsSync(contextFile)) {
  context = JSON.parse(
    zlib.brotliDecompressSync(fs.readFileSync(contextFile)).toString()
  ) as Record<string, unknown>;
}

//把context包装成proxy对象，来捕捉一些操作
let setEnvAllowed = false;
let initFinished = false;
context = new Proxy(context, {
  set(o, k: string, v) {
    if (!initFinished) {
      return Reflect.set(o, k, v);
    }
    if (k === 'set_history_allowed') {
      return false;
    }
    if (k === 'data' && !setEnvAllowed) {
      return false;
    }
    if (o.isProtected?.(k) && !o.isMaster?.()) {
      return false;
    }
    if (typeof o.recordSetHistory === 'function') {
      o.set_history_allowed = true;
      o.recordSetHistory(k);
      o.set_history_allowed = false;
    }
    return Reflect.set(o, k, v);
  },
  defineProperty: (o, k, d) => {
    if (!setEnvAllowed || o.isMaster?.()) {
      return Reflect.defineProperty(o, k, d);
    } else {
      return false;
    }
  },
  deleteProperty: (o, k: string) => {
    if (!setEnvAllowed || o.isMaster?.() || !o.isProtected?.(k)) {
      return Reflect.deleteProperty(o, k);
    } else {
      return false;
    }
  },
  preventExtensions: () => {
    return false;
  },
  setPrototypeOf: () => {
    return false;
  }
});

//创建context
vm.createContext(context, {
  codeGeneration: {
    strings: false,
    wasm: false
  },
  microtaskMode: 'afterEvaluate'
});

//还原context中的函数
if (fs.existsSync(fnFile)) {
  const fn = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(fnFile)).toString()) as Record<
    string,
    unknown
  >;
  const restoreFunctions = (o: Record<string, unknown>, name: string) => {
    for (const k in o) {
      const key = name + `["${k}"]`;
      if (typeof o[k] === 'string') {
        try {
          vm.runInContext(`${key}=` + o[k], context);
        } catch (_) {
          /* empty */
        }
      } else if (typeof o[k] === 'object') {
        restoreFunctions(o[k] as Record<string, unknown>, key);
      }
    }
  };
  restoreFunctions(fn, 'this');
}

//执行init代码
vm.runInContext(fs.readFileSync(initCodeFile).toString(), context);

//冻结内置对象(不包括console,globalThis)
const internalProperties = [
  'Object',
  'Function',
  'Array',
  'Number',
  'parseFloat',
  'parseInt',
  'Boolean',
  'String',
  'Symbol',
  'Date',
  'RegExp',
  'eval',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'JSON',
  'Promise',
  'Math',
  'Intl',
  'ArrayBuffer',
  'Uint8Array',
  'Int8Array',
  'Uint16Array',
  'Int16Array',
  'Uint32Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
  'Uint8ClampedArray',
  'BigUint64Array',
  'BigInt64Array',
  'DataView',
  'Map',
  'BigInt',
  'Set',
  'WeakMap',
  'WeakSet',
  'Proxy',
  'Reflect',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
  'isFinite',
  'isNaN',
  'SharedArrayBuffer',
  'Atomics',
  'WebAssembly'
];
for (const v of internalProperties) {
  vm.runInContext(
    `this.Object.freeze(this.${v})
this.Object.freeze(this.${v}.prototype)
const ${v} = this.${v}`,
    context
  );
}
initFinished = true;

vm.runInContext(`try{this.afterInit()}catch(e){}`, context);

//定时持久化context(60分钟)
let fn: Record<string, unknown>;
const saveFunctions = (o: Record<string, unknown>, mp: Record<string, unknown>) => {
  for (const k in o) {
    if (typeof o[k] === 'function') {
      mp[k] = o[k].toString();
    } else if (typeof o[k] === 'object' && o[k] !== null) {
      if (o === context) {
        try {
          if (JSON.stringify(o[k]).length > 10485760) {
            o[k] = void 0;
          }
        } catch (_) {
          o[k] = void 0;
        }
      }
      if (o[k] === void 0) {
        continue;
      }
      mp[k] = {};
      saveFunctions(o[k] as Record<string, unknown>, mp[k] as Record<string, unknown>);
    } else if (typeof o[k] === 'bigint') {
      o[k] = Number(o[k]);
    }
  }
};
const beforeSaveContext = () => {
  setEnv();
  fn = {};
  saveFunctions(context, fn);
};
const brotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 5
  }
};
process.on('exit', code => {
  if (code !== 200) {
    return;
  }
  beforeSaveContext();
  fs.writeFileSync(fnFile, zlib.brotliCompressSync(JSON.stringify(fn), brotliOptions));
  fs.writeFileSync(contextFile, zlib.brotliCompressSync(JSON.stringify(context), brotliOptions));
});

const saveCtx = () => {
  beforeSaveContext();
  zlib.brotliCompress(JSON.stringify(fn), brotliOptions, (err, res) => {
    if (res) {
      fs.writeFile(fnFile, res, () => {});
    }
  });
  zlib.brotliCompress(JSON.stringify(context), brotliOptions, (err, res) => {
    if (res) {
      fs.writeFile(contextFile, res, () => {});
    }
  });
};

/**
 * 保存上下文
 */
setInterval(saveCtx, 3600000);

//沙盒执行超时时间
let timeout = 500;
const getTimeout = () => timeout;
const setTimeout = (t: number) => (timeout = t);

//执行代码
const run = (code: string) => {
  code = code.trim();
  const debug = ['\\', '＼'].includes(code.substr(0, 1));
  if (debug) {
    code = code.substring(1);
  }
  try {
    const code2: unknown = vm.runInContext(`this.beforeExec(${JSON.stringify(code)})`, context, {
      timeout: timeout
    });
    if (typeof code2 === 'string') {
      code = code2;
    }
    let res: unknown = vm.runInContext(code, context, { timeout: timeout });
    if (res instanceof vm.runInContext('Promise', context)) {
      (res as Promise<unknown>).catch(() => {});
      res = void 0;
    }
    context._current_echo = res;
    const res2: unknown = vm.runInContext(`this.afterExec()`, context, { timeout: timeout });
    if (typeof res2 !== 'undefined') {
      res = res2;
    }
    return res;
  } catch (e) {
    if (debug) {
      if (!(e instanceof Error)) {
        return `unknown Error: ${String(e)}`;
      }
      const line = e.stack?.split('\n')[0]?.split(':').pop();
      return e.name + ': ' + e.message + ' (line: ' + line ? parseInt(line!) : 'unknown' + ')';
    }
  }
};

//执行代码 raw
const exec = (code: string) => {
  return vm.runInContext(code, context, { timeout: timeout }) as unknown;
};

//设置环境变量
const setEnv = (env = {}) => {
  setEnvAllowed = true;
  vm.runInContext(
    `this.data=${JSON.stringify(env)}
contextify(this.data)`,
    context
  );
  setEnvAllowed = false;
};

//传递一个外部对象到context
const include = (name: string, object: unknown) => {
  context[name] = object;
  vm.runInContext(
    `const ${name} = this.${name}
contextify(${name})`,
    context
  );
};

const addContext = (key: string, value: unknown) => {
  context[key] = value;
};

const getContext = () => context;

export { setEnv, saveCtx, getTimeout, setTimeout, run, exec, include, addContext, getContext };
