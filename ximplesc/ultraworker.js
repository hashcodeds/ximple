importScripts("/ximplesc/scram/scramjet.all.js");

if (navigator.userAgent.includes("Firefox")) {
        Object.defineProperty(globalThis, "crossOriginIsolated", { value: true, writable: true });
}

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

let configReady = false;

self.addEventListener("fetch", (event) => {
        event.respondWith((async () => {
                if (!configReady) { await scramjet.loadConfig(); configReady = true; }
                if (scramjet.route(event)) return scramjet.fetch(event);
                return fetch(event.request);
        })());
});
