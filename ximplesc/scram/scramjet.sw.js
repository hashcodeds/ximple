importScripts("./scramjet.all.js");

self.Scramjet = self.Scramjet || {};

const scramjet = new self.Scramjet({
    prefix: "/scramjet/",
    codec: "plain",
    ws: {
        url: "wss://anura.pro/"
    }
});

self.addEventListener("install", (event) => {
    self.skipWaiting();
    console.log("Scramjet SW installed");
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
    console.log("Scramjet SW activated");
});

self.addEventListener("fetch", (event) => {
    if (scramjet.route(event.request.url)) {
        event.respondWith(scramjet.fetch(event.request));
    }
});
