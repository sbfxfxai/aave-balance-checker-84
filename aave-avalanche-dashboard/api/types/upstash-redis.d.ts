declare module '@upstash/redis' {
  interface RedisConfig {
    url: string;
    token: string;
  }
  
  export class Redis {
    constructor(config: RedisConfig);
    get<T = any>(key: string): Promise<T | null>;
    set(key: string, value: any, options?: { ex?: number; nx?: boolean }): Promise<string>;
    del(key: string | string[]): Promise<number>;
    exists(key: string | string[]): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    ttl(key: string): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    ping(): Promise<string>;
    lpush(key: string, ...values: any[]): Promise<number>;
    ltrim(key: string, start: number, stop: number): Promise<string>;
    lrange(key: string, start: number, stop: number): Promise<any[]>;
    lset(key: string, index: number, value: any): Promise<string>;
    [key: string]: any;
  }
}

