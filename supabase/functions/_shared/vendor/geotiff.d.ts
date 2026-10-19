export class BaseResponse {
  get status(): number;
  getHeader(name:string): string | undefined;
  getData(): Promise<ArrayBuffer>;
}
export class BaseClient {
  url:string;
  constructor(url:string);
  request(options?:RequestInit):Promise<BaseResponse>;
}
export function fromCustomClient(client:BaseClient,options?:Record<string,unknown>,signal?:AbortSignal):Promise<any>;
export function fromArrayBuffer(bytes:ArrayBuffer):Promise<any>;
export function writeArrayBuffer(values:ArrayLike<number>,metadata:Record<string,unknown>):ArrayBuffer;