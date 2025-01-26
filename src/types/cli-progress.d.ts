
declare module 'cli-progress' {
    export class SingleBar {
        constructor(options?: {
            format?: string;
            barCompleteChar?: string;
            barIncompleteChar?: string;
        });
        start(total: number, current: number): void;
        update(value: number): void;
        stop(): void;
    }
}