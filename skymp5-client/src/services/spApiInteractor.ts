import { EventEmitterFactory } from "./events/events";
import { ClientListener, ClientListenerConstructor, CombinedController } from "./services/clientListener";
import * as sp from "skyrimPlatform";
import { LATE_LABEL, perfDiagEnabled, updateTiming } from "./services/perfDiag";

type Handler = (...args: unknown[]) => unknown;

// A handler that throws is reported to ClientDiagService (__dboReportError) and the error goes on to SkyrimPlatform as before
const reporting = (kind: string, event: unknown, handler: Handler): Handler => function (this: unknown, ...args: unknown[]) {
    try {
        return handler.apply(this, args);
    } catch (e) {
        try {
            const report = (globalThis as any).__dboReportError;
            if (typeof report === "function") report(`${kind}:${String(event)}`, e);
        } catch (x) { /* never in the way of the error itself */ }
        throw e;
    }
};

export class SpApiInteractor {
    static setup(listeners: ClientListener[]) {
        listeners.forEach(listener => SpApiInteractor.registerListenerForLookup(listener.constructor, listener));
        updateTiming.setLabel(LATE_LABEL);
    }

    static getControllerInstance(): CombinedController {
        if (SpApiInteractor.controller) {
            return SpApiInteractor.controller;
        }
        // Every handler is wrapped by reporting (a throw is reported, then rethrown); update handlers are also timed (perfDiag)
        const perfOn = perfDiagEnabled((sp.settings && sp.settings["skymp5-client"]) as Record<string, unknown> | undefined);
        SpApiInteractor.controller = {
            on: ((event: unknown, handler: Handler) =>
                ((perfOn ? SpApiInteractor.timedOn : sp.on) as any)(event, reporting("on", event, handler))) as unknown as typeof sp.on,
            once: ((event: unknown, handler: Handler) => (sp.once as any)(event, reporting("once", event, handler))) as unknown as typeof sp.once,
            emitter: EventEmitterFactory.makeEventEmitter(),
            lookupListener<T extends ClientListener>(constructor: ClientListenerConstructor<T>): T {
                const listener = SpApiInteractor.listenersForLookupByName.get(constructor);
                if (listener === undefined) {
                    throw new Error(`listener not found for name '${constructor.name}'`);
                }
                if (!(listener instanceof constructor)) {
                    throw new Error(`listener class mismatch for name '${constructor.name}'`);
                }
                return listener;
            },
        }
        return SpApiInteractor.controller;
    }

    // Every update handler goes through one timing wrapper (perfDiag.ts); other events pass straight through
    private static timedOn = ((eventName: string, callback: (...args: any[]) => any) =>
        (sp.on as any)(eventName, eventName === "update" ? updateTiming.wrap(callback) : callback)) as typeof sp.on;

    private static registerListenerForLookup(constructor: Function, listener: ClientListener): void {
        if (SpApiInteractor.listenersForLookupByName.has(constructor)) {
            throw new Error(`listener re-registration for name '${constructor}'`);
        }
        SpApiInteractor.listenersForLookupByName.set(constructor, listener);
    }

    private static listenersForLookupByName = new Map<Function, ClientListener>();

    private static controller?: CombinedController;
}
