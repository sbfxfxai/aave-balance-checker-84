type MarkOptions = {
    startTime?: number;
    detail?: any;
};
type MetricOptions = {
    startTime: number;
    value: string | number;
    detail?: any;
};
type MeasureOptions = {
    startTime?: number;
    detail?: any;
    duration?: number;
};
export type EntryType = 'mark' | 'measure' | 'resource' | 'metric' | 'react-native-mark';
export declare class PerformanceEntry {
    name: string;
    entryType: EntryType;
    startTime: number;
    duration: number;
    constructor(name: string, entryType: EntryType, startTime: number, duration: number);
    toJSON(): {
        name: string;
        entryType: EntryType;
        startTime: number;
        duration: number;
    };
}
export declare class PerformanceMark extends PerformanceEntry {
    detail?: any;
    constructor(markName: string, markOptions?: MarkOptions);
    toJSON(): {
        name: string;
        entryType: EntryType;
        startTime: number;
        duration: number;
        detail: any;
    };
}
export declare class PerformanceReactNativeMark extends PerformanceEntry {
    detail?: any;
    constructor(name: string, startTime: number, detail: any);
    toJSON(): {
        name: string;
        entryType: EntryType;
        startTime: number;
        duration: number;
        detail: any;
    };
}
export declare class PerformanceMetric extends PerformanceEntry {
    value: string | number;
    detail?: any;
    constructor(name: string, metricOptions: MetricOptions);
    toJSON(): {
        name: string;
        entryType: EntryType;
        startTime: number;
        duration: number;
        detail: any;
        value: string | number;
    };
}
export declare class PerformanceMeasure extends PerformanceEntry {
    detail?: any;
    constructor(measureName: string, measureOptions?: MeasureOptions);
    toJSON(): {
        name: string;
        entryType: EntryType;
        startTime: number;
        duration: number;
        detail: any;
    };
}
export declare class PerformanceResourceTiming extends PerformanceEntry {
    initiatorType?: string;
    responseEnd: number;
    fetchStart: number;
    transferSize: number;
    connectEnd: number;
    connectStart: number;
    decodedBodySize: number;
    domainLookupEnd: number;
    domainLookupStart: number;
    encodedBodySize: number;
    redirectEnd: number;
    redirectStart: number;
    requestStart: number;
    responseStart: number;
    secureConnectionStart?: number;
    serverTiming: number[];
    workerStart: number;
    workerTiming: number[];
    constructor({ name, startTime, duration, initiatorType, responseEnd, transferSize, }?: {
        name?: string;
        startTime?: number;
        duration?: number;
        initiatorType?: string;
        responseEnd?: number;
        transferSize?: number;
    });
    toJSON(): {
        name: string;
        entryType: EntryType;
        startTime: number;
        duration: number;
        initiatorType: string;
        fetchStart: number;
        responseEnd: number;
        transferSize: number;
        connectEnd: number;
        connectStart: number;
        decodedBodySize: number;
        domainLookupEnd: number;
        domainLookupStart: number;
        encodedBodySize: number;
        redirectEnd: number;
        redirectStart: number;
        requestStart: number;
        responseStart: number;
        secureConnectionStart: number;
        serverTiming: number[];
        workerStart: number;
        workerTiming: number[];
    };
}
export {};
//# sourceMappingURL=performance-entry.d.ts.map