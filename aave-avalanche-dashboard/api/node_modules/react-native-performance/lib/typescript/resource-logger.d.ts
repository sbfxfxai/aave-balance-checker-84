import type { PerformanceEntry } from './performance-entry';
import type { Performance } from './performance';
interface XMLHttpRequestType extends XMLHttpRequest {
    new (...args: any): XMLHttpRequestType;
    performanceOriginal: XMLHttpRequest;
    performanceStartTime?: number;
    responseURL: string;
    responseHeaders: string[];
}
interface Context {
    XMLHttpRequest: XMLHttpRequestType;
}
export declare const installResourceLogger: (context: Context, performance: Performance, addEntry: (entry: PerformanceEntry) => PerformanceEntry) => void;
export declare const uninstallResourceLogger: (context: any) => void;
export {};
//# sourceMappingURL=resource-logger.d.ts.map