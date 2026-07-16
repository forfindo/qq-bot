import OpenaiProvider from './openai-provider';

export default class DeepSeek extends OpenaiProvider {
  private readonly _baseUrl: string = 'https://api.deepseek.com';
  private readonly modelList: string[] = ['deepseek-chat', 'deepseek-reasoner'];

  constructor(apiKey: string) {
    super(apiKey);
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get model(): string {
    return this.modelList[0]!;
  }
}
