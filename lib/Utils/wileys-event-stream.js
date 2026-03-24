// [wileys-v10-event-stream] — port from wileys@latest
import { EventEmitter } from 'events';
import { createReadStream, writeFile } from 'fs';
import { createInterface } from 'readline';
import { makeMutex } from './make-mutex.js';
import { delay } from './generics.js';
export const captureEventStream = (ev, filename) => {
    const oldEmit = ev.emit.bind(ev);
    const writeMutex = makeMutex();
    ev.emit = function (...args) {
        const content = JSON.stringify({ timestamp: Date.now(), event: args[0], data: args[1] }) + '\n';
        const result = oldEmit(...args);
        writeMutex.mutex(async () => { await new Promise(res => writeFile(filename, content, { flag: 'a' }, () => res())); });
        return result;
    };
    return () => { ev.emit = oldEmit; };
};
export const readAndEmitEventStream = (filename, delayIntervalMs = 0) => {
    const emitter = new EventEmitter();
    const task = (async () => {
        const rl = createInterface({ input: createReadStream(filename), crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.trim())
                continue;
            try {
                const { event, data } = JSON.parse(line);
                emitter.emit(event, data);
                if (delayIntervalMs > 0)
                    await delay(delayIntervalMs);
            }
            catch { }
        }
    })();
    return { ev: emitter, task };
};
//# sourceMappingURL=wileys-event-stream.js.map