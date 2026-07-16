export interface IProvider {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

export default abstract class OpenaiProvider implements IProvider {
  protected readonly _apiKey: string;

  protected constructor(apiKey: string) {
    this._apiKey = apiKey;
  }

  get apiKey() {
    return this._apiKey;
  }

  abstract get baseUrl(): string;

  abstract get model(): string;
}
