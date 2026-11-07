import cp from 'child_process';
import path from 'path';
import fs from 'fs';
import type { Bot, MessageEvent, NoticeEvent, RequestEvent, Message } from '@xopenbot/onebot';

interface CallApiRequest {
  uin: string;
  method: string;
  params: unknown[];
  echo: string;
}

interface ExecResponse {
  type: 'exec/result';
  id: string;
  data: Message;
}

export interface Config {
  /** 上下文存档目录 **/
  dataPath?: string;
  /** 判断是否主人 **/
  master: string[];
}

type WorkEvent = CallApiRequest | ExecResponse;

const isExecResponse = (value: WorkEvent): value is ExecResponse =>
  'type' in value && value.type === 'exec/result';

type AnyAction = (...params: unknown[]) => Promise<unknown>;

const bots = new Map<string, Bot>();
const __dirname = import.meta.dirname;
const resolveMap = new Map<string, (result: Message) => void>();
let worker: cp.ChildProcess | null = null;
let initialized = false;

const startWorker = () => {
  console.log(Date(), 'sandbox启动');
  worker = cp.fork(path.join(__dirname, 'bridge.js'));
  worker.on('error', err => {
    fs.appendFile('err.log', Date() + ' ' + err.stack + '\n', () => {});
  });
  worker.on('exit', (code: number) => {
    resolveMap.forEach(resolve => resolve(`退出码：${code}`));
    resolveMap.clear();
    console.log(Date(), 'sandbox停止');
    startWorker();
  });
  worker.on('message', (value: WorkEvent) => {
    if (isExecResponse(value)) {
      resolveMap.get(value.id)?.(value.data);
      resolveMap.delete(value.id);
      return;
    }
    const bot = bots.get(value.uin);
    if (!bot) {
      return;
    }
    const action = bot[value.method] as AnyAction | undefined;
    action
      ?.apply(bot, value.params)
      .then(ret => {
        if (ret instanceof Map) {
          ret = Array.from(ret);
        }
        worker?.send({
          data: ret,
          echo: value.echo
        });
      })
      .catch(() => {});
  });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
};

const isSafeValue = (value: unknown, source: object): boolean => {
  if (value === source) {
    return false;
  }
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true;
    case 'object':
      return value === null || Array.isArray(value) || isPlainObject(value);
    default:
      return false;
  }
};

const normalize = (
  data: MessageEvent | NoticeEvent | RequestEvent
): MessageEvent | NoticeEvent | RequestEvent => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (isSafeValue(value, data)) {
      result[key] = value;
    }
  }
  /* eslint-disable */
  if (result.user_id) {
    result.user_id = String(result.user_id);
  }
  if (result.group_id) {
    result.group_id = String(result.group_id);
  }
  // @ts-ignore
  result.self?.user_id && (result.self.user_id = String(result.self.user_id));
  /* eslint-enabled */
  return result as unknown as MessageEvent | NoticeEvent | RequestEvent;
};

const init = async (bot: Bot | Bot[], cfg?: Config) => {
  if (initialized) {
    console.error('sandbox 已经初始化');
    return;
  }
  if (!Array.isArray(bot)) {
    bot = [bot];
  }
  bots.clear();
  for (const b of bot) {
    const uid = b.selfInfo?.user_id || (await b.getSelfInfo())?.user_id;
    if (!uid) {
      throw new TypeError('uid不能为空');
    }
    bots.set(uid, b);
  }
  worker?.send({
    type: 'init',
    value: cfg
  });
  initialized = true;
};

const saveCtx = () => {
  worker?.send({
    type: 'saveCtx'
  });
};

const exec = (data: MessageEvent | NoticeEvent | RequestEvent) => {
  return new Promise<Message>((resolve, reject) => {
    if (!bots.get(data.self.user_id)) {
      reject(new Error(`${data.self.user_id} 未初始化。请先调用init方法初始化`));
      return;
    }
    data = normalize(data);
    resolveMap.set(data.id, resolve);
    worker?.send(data);
  });
};

startWorker();

export { init, exec, saveCtx };
