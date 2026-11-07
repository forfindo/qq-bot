declare module 'string.ify' {
  /** configure 的入参，字符串化过程中读取的所有配置项（见 string.ify.js:27-107、231-248） */
  export interface StringifyConfig {
    /** 当前递归深度，内部状态，默认 0 */
    depth?: number;
    /** 输出可 eval 的纯 JS 值（不美化 Date/函数等），默认 false */
    pure?: boolean;
    /** 按 JSON 规则输出：键和字符串都用双引号，默认 false */
    json?: boolean;
    /** 超过该深度时输出 <object[n]> / <array[n]>，默认 5 */
    maxDepth?: number;
    /** pretty 为 "auto" 时的单行长度阈值，超过则改用多行，默认 50 */
    maxLength?: number;
    /** 数组元素数量上限，超过则输出 <array[n]>，默认 60 */
    maxArrayLength?: number;
    /** 对象键数量上限，超过则输出 <object[n]>，默认 200 */
    maxObjectLength?: number;
    /** 字符串长度上限，超出部分截断并以 … 结尾，默认 60 */
    maxStringLength?: number;
    /** 非整数保留的小数位数，> 0 时生效，默认 undefined */
    precision?: number;
    /** 自定义格式化钩子，返回字符串则直接作为结果，默认 undefined */
    formatter?: (value: unknown, stringify: Stringify) => string | undefined;
    /** 是否多行美化；"auto" 表示按 maxLength 自动决定，默认 "auto" */
    pretty?: boolean | 'auto';
    /** 多行时键是否右对齐（仅在 fancy 为 true 时生效），默认 true */
    rightAlignKeys?: boolean;
    /** 是否使用带缩进引导线的美化排版，默认 true */
    fancy?: boolean;
    /** 多行输出时的缩进字符串，默认 '    ' */
    indentation?: string;
  }

  /** configure 的返回值：既可直接调用，也可继续链式配置 */
  export interface Stringify {
    (value: unknown): string;
    /** 当前生效的配置 */
    state: StringifyConfig;
    configure(config?: StringifyConfig): Stringify;

    readonly pretty: Stringify;
    readonly noPretty: Stringify;
    readonly noFancy: Stringify;
    readonly noRightAlignKeys: Stringify;
    readonly json: Stringify;
    readonly pure: Stringify;

    maxStringLength(n?: number): Stringify;
    maxArrayLength(n?: number): Stringify;
    maxObjectLength(n?: number): Stringify;
    maxDepth(n?: number): Stringify;
    maxLength(n?: number): Stringify;
    indentation(n: string): Stringify;
    precision(p: number): Stringify;
    formatter(f: (value: unknown, stringify: Stringify) => string | undefined): Stringify;

    limit(s: string, n: number): string;
    rightAlign(strings: string[]): string[];
    object(value: unknown): string;
  }

  const stringify: Stringify;
  export default stringify;
}
