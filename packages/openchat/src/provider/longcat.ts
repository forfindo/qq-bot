import OpenaiProvider from './openai-provider';

export default class Longcat extends OpenaiProvider {
  private readonly _baseUrl: string = 'https://api.longcat.chat/openai';
  private readonly modelList = ['LongCat-Flash-Chat', 'LongCat-Flash-Lite', 'LongCat-Flash-Omni-2603', 'LongCat-Flash-Thinking'];

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
