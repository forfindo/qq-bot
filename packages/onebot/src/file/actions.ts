import type { Bytes } from '../message/type';
import type { Extensible } from '../rules';

/** 上传文件的方式 */
export type UploadFileType = 'url' | 'path' | 'data' | `${string}.${string}`;

/** 通过 URL 上传文件的请求参数 */
export interface UploadFileUrlParams extends Extensible {
  type: 'url';
  /** 文件名，如 `foo.jpg` */
  name: string;
  /** 文件 URL，OneBot 实现必须支持以 HTTP(S) 协议从此 URL 下载要上传的文件 */
  url: string;
  /** 下载 URL 时需要添加的 HTTP 请求头 */
  headers?: Record<string, string>;
  /** 文件数据（原始二进制）的 SHA256 校验和，全小写 */
  sha256?: string;
}

/** 通过路径上传文件的请求参数 */
export interface UploadFilePathParams extends Extensible {
  type: 'path';
  name: string;
  /** 文件路径，OneBot 实现必须能从此路径访问要上传的文件 */
  path: string;
  /** 文件数据的 SHA256 校验和，全小写 */
  sha256?: string;
}

/** 直接上传文件数据的请求参数 */
export interface UploadFileDataParams extends Extensible {
  type: 'data';
  name: string;
  /** 文件数据，JSON 中为 Base64 编码的字符串 */
  data: Bytes;
  /** 文件数据的 SHA256 校验和，全小写 */
  sha256?: string;
}

/** 以扩展方式上传文件的请求参数 */
export interface UploadFileExtendedParams {
  /** 扩展的上传方式，应使用 `<prefix>.<name>` 形式 */
  type: `${string}.${string}`;
  name: string;
  /** 文件数据的 SHA256 校验和，全小写 */
  sha256?: string;
  [key: string]: unknown;
}

/** `upload_file` 动作的请求参数 */
export type UploadFileParams =
  | UploadFileUrlParams
  | UploadFilePathParams
  | UploadFileDataParams
  | UploadFileExtendedParams;

/** `upload_file` 动作的响应数据 */
export interface UploadFileResult extends Extensible {
  /** 文件 ID，可供以后使用 */
  file_id: string;
}

/** 分片上传的准备阶段请求参数 */
export interface UploadFilePrepareParams extends Extensible {
  stage: 'prepare';
  name: string;
  /** 文件完整大小，单位：字节 */
  total_size: number;
}

/** 分片上传的传输阶段请求参数 */
export interface UploadFileTransferParams extends Extensible {
  stage: 'transfer';
  /** 准备阶段返回的文件 ID */
  file_id: string;
  /** 本次传输的文件偏移，单位：字节 */
  offset: number;
  /** 本次传输的文件数据，JSON 中为 Base64 编码的字符串 */
  data: Bytes;
}

/** 分片上传的结束阶段请求参数 */
export interface UploadFileFinishParams extends Extensible {
  stage: 'finish';
  /** 准备阶段返回的文件 ID */
  file_id: string;
  /** 整个文件的 SHA256 校验和，全小写 */
  sha256: string;
}

/** `upload_file_fragmented` 动作的请求参数 */
export type UploadFileFragmentedParams =
  | UploadFilePrepareParams
  | UploadFileTransferParams
  | UploadFileFinishParams;

/** 准备阶段和结束阶段返回 `file_id`，传输阶段无响应数据 */
export type UploadFileFragmentedResult = UploadFileResult | null;

/** 获取文件的方式 */
export type FileTransferType = 'url' | 'path' | 'data' | `${string}.${string}`;

/** `get_file` 动作的请求参数 */
export interface GetFileParams extends Extensible {
  /** 文件 ID */
  file_id: string;
  /** 获取文件的方式，可以为 `url`、`path`、`data` 或扩展的方式 */
  type: FileTransferType;
}

/** `get_file` 动作的响应数据 */
export interface GetFileResult extends Extensible {
  /** 文件名，如 `foo.jpg` */
  name: string;
  /** 文件 URL，当 `type` 为 `url` 时必须返回 */
  url?: string;
  /** 下载 URL 时需要添加的 HTTP 请求头 */
  headers?: Record<string, string>;
  /** 文件路径，当 `type` 为 `path` 时必须返回 */
  path?: string;
  /** 文件数据，当 `type` 为 `data` 时必须返回，JSON 中为 Base64 编码的字符串 */
  data?: Bytes;
  /** 文件数据（原始二进制）的 SHA256 校验和，全小写 */
  sha256?: string;
}

/** 分片获取的准备阶段请求参数 */
export interface GetFilePrepareParams extends Extensible {
  stage: 'prepare';
  /** 文件 ID */
  file_id: string;
}

/** 分片获取的传输阶段请求参数 */
export interface GetFileTransferParams extends Extensible {
  stage: 'transfer';
  /** 文件 ID */
  file_id: string;
  /** 本次传输的文件偏移，单位：字节 */
  offset: number;
  /** 本次传输的文件大小，单位：字节 */
  size: number;
}

/** `get_file_fragmented` 动作的请求参数 */
export type GetFileFragmentedParams = GetFilePrepareParams | GetFileTransferParams;

/** 分片获取的准备阶段响应数据 */
export interface GetFilePrepareResult extends Extensible {
  name: string;
  /** 文件完整大小，单位：字节 */
  total_size: number;
  /** 整个文件的 SHA256 校验和，全小写 */
  sha256: string;
}

/** 分片获取的传输阶段响应数据 */
export interface GetFileTransferResult extends Extensible {
  /** 本次传输的文件数据，JSON 中为 Base64 编码的字符串 */
  data: Bytes;
}

/** `get_file_fragmented` 动作的响应数据 */
export type GetFileFragmentedResult = GetFilePrepareResult | GetFileTransferResult;
