const workerURL = new URL('../coi-serviceworker.js', import.meta.url);
const appScope = new URL('../', import.meta.url);
const reloadKey = `perfectloop:isolated-start:${appScope.pathname}`;

function ownsController() {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return false;
    return new URL(controller.scriptURL).href === workerURL.href;
}

function waitForActivation(registration) {
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker || worker.state === 'redundant') return Promise.resolve(false);
    if (worker.state === 'activated') return Promise.resolve(true);
    return new Promise(resolve => {
        const finish = ready => {
            clearTimeout(timer);
            worker.removeEventListener('statechange', changed);
            resolve(ready);
        };
        const changed = () => {
            if (worker.state === 'activated') finish(true);
            else if (worker.state === 'redundant') finish(false);
        };
        const timer = setTimeout(() => finish(false), 5_000);
        worker.addEventListener('statechange', changed);
        changed();
    });
}

function waitForController() {
    if (ownsController()) return Promise.resolve(true);
    return new Promise(resolve => {
        const finish = ready => {
            clearTimeout(timer);
            navigator.serviceWorker.removeEventListener('controllerchange', changed);
            resolve(ready);
        };
        const changed = () => { if (ownsController()) finish(true); };
        const timer = setTimeout(() => finish(false), 3_000);
        navigator.serviceWorker.addEventListener('controllerchange', changed);
        changed();
    });
}

async function enableIsolation() {
    // Embedded, insecure, and restricted browsers can still use the ordinary
    // editor. Only a top-level page attempts the initial isolation navigation.
    if (globalThis.crossOriginIsolated) {
        try { sessionStorage.removeItem(reloadKey); } catch { /* Storage may be disabled. */ }
        return false;
    }
    if (!globalThis.isSecureContext || !('serviceWorker' in navigator) || window.top !== window) return false;
    try {
        // Without tab-local storage there is no reliable one-reload guard.
        if (sessionStorage.getItem(reloadKey)) return false;
        sessionStorage.setItem(reloadKey, 'pending');
        sessionStorage.removeItem(reloadKey);
    } catch { return false; }

    let registrationTimer;
    try {
        const registration = await Promise.race([
            navigator.serviceWorker.register(workerURL.href, { scope: appScope.href, updateViaCache: 'none' }),
            new Promise(resolve => { registrationTimer = setTimeout(() => resolve(null), 5_000); }),
        ]);
        clearTimeout(registrationTimer);
        if (!registration || !await waitForActivation(registration) || !await waitForController()) return false;
        if (globalThis.crossOriginIsolated) return false;
        sessionStorage.setItem(reloadKey, 'reloaded');
        location.reload();
        return true;
    } catch {
        clearTimeout(registrationTimer);
        return false;
    }
}

// No editor state, demo video, or local-file work exists before this completes.
// A failed isolation attempt starts the ordinary app without a later reload.
if (!await enableIsolation()) await import('./app.js');
