type Callback<T> = (entry: T) => void;
export declare const createEventEmitter: <T>() => {
    addEventListener: (callback: Callback<T>) => void;
    removeEventListener: (callback: Callback<T>) => void;
    emit: (event: T) => void;
};
export {};
//# sourceMappingURL=event-emitter.d.ts.map