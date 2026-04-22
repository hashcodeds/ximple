import { BareMuxConnection } from "https://unpkg.com/@mercuryworkshop/bare-mux@2.1.7/dist/index.mjs";

const connection = new BareMuxConnection("/ximplesc/bareworker.js");

let wispURL;
let transportURL;

export let tabCounter = 0;
export let currentTab = 0;
export let framesElement;
export let currentFrame;
export const addressInput = document.getElementById("address");

let scramjet = null;
let scramjetLoadPromise = null;

async function loadScramjet() {
    if (scramjet) return scramjet;
    if (scramjetLoadPromise) return scramjetLoadPromise;

    scramjetLoadPromise = (async () => {
        if (!window.$scramjetLoadController) {
            await import(`/ximplesc/scram/scramjet.all.js`);
        }
        const { ScramjetController } = window.$scramjetLoadController();
        const instance = new ScramjetController({
            files: {
                wasm: `/ximplesc/scram/scramjet.wasm.wasm`,
                all: `/ximplesc/scram/scramjet.all.js`,
                sync: `/ximplesc/scram/scramjet.sync.js`,
            },
            siteFlags: {
                "https://www.google.com/(search|sorry).*": {
                    naiiveRewriter: true,
                },
            },
        });
        instance.init();
        window.scramjet = instance;
        return instance;
    })();

    scramjet = await scramjetLoadPromise;
    return scramjet;
}

const transportOptions = {
    epoxy: "https://unpkg.com/@mercuryworkshop/epoxy-transport@2.1.27/dist/index.mjs",
    libcurl: "https://unpkg.com/@mercuryworkshop/libcurl-transport@1.5.0/dist/index.mjs",
};

const stockSW = "/ximplesc/sw.js";
const swAllowedHostnames = { localhost: 1, "127.0.0.1": 1 };

let swRegistered = false;
let swRegistrationPromise = null;

async function registerSW() {
    if (swRegistered) return;
    if (swRegistrationPromise) return swRegistrationPromise;

    swRegistrationPromise = (async () => {
        if (!navigator.serviceWorker) {
            if (location.protocol !== "https:" && !swAllowedHostnames[location.hostname]) {
                throw new Error("Service workers cannot be registered without https.");
            }
            throw new Error("Your browser doesn't support service workers.");
        }

        const reg = await navigator.serviceWorker.register(stockSW, { scope: "/" });

        if (navigator.serviceWorker.controller) {
            swRegistered = true;
            return;
        }

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                swRegistered = true;
                resolve();
            }, 5000);

            if (reg.active) {
                navigator.serviceWorker.addEventListener("controllerchange", () => {
                    clearTimeout(timeout);
                    swRegistered = true;
                    resolve();
                }, { once: true });
                return;
            }

            const sw = reg.installing || reg.waiting;
            if (sw) {
                const onState = () => {
                    if (sw.state === "activated") {
                        sw.removeEventListener("statechange", onState);
                        clearTimeout(timeout);
                        navigator.serviceWorker.addEventListener("controllerchange", () => {
                            swRegistered = true;
                            resolve();
                        }, { once: true });
                        if (navigator.serviceWorker.controller) {
                            swRegistered = true;
                            resolve();
                        }
                    } else if (sw.state === "redundant") {
                        clearTimeout(timeout);
                        reject(new Error("Service worker became redundant"));
                    }
                };
                sw.addEventListener("statechange", onState);
            }
        });
    })();

    await swRegistrationPromise;
}

export const ready = Promise.allSettled([
    registerSW().catch(() => {}),
    loadScramjet().catch(() => {})
]);

let updatePromise = null;

async function updateBareMux() {
    if (transportURL != null && wispURL != null) {
        if (updatePromise) await updatePromise;
        const currentUpdate = connection.setTransport(transportURL, [{ wisp: wispURL }]);
        updatePromise = currentUpdate;
        await currentUpdate;
        if (updatePromise === currentUpdate) updatePromise = null;
    }
}

export async function setTransport(transport) {
    transportURL = transportOptions[transport] || transport;
    await updateBareMux();
}

export function getTransport() {
    return transportURL;
}

export async function setWisp(wisp) {
    wispURL = wisp;
    await updateBareMux();
}

export function getWisp() {
    return wispURL;
}

const urlRegex = /^https?:\/\//i;

export function makeURL(input, template = "https://search.brave.com/search?q=%s") {
    if (urlRegex.test(input)) {
        try {
            return new URL(input).toString();
        } catch (err) {}
    }

    try {
        return new URL(input).toString();
    } catch (err) {}

    return template.replace("%s", encodeURIComponent(input));
}

export async function getProxied(input) {
    if (!scramjet) await loadScramjet();
    return scramjet.encodeUrl(makeURL(input));
}

const syncCache = {};
const syncCacheKeys = [];
const SYNC_CACHE_LIMIT = 50;

export function getProxiedSync(input) {
    if (!scramjet) return null;

    const cached = syncCache[input];
    if (cached !== undefined) return cached;

    const result = scramjet.encodeUrl(makeURL(input));

    if (syncCacheKeys.length >= SYNC_CACHE_LIMIT) {
        const oldest = syncCacheKeys.shift();
        delete syncCache[oldest];
    }
    syncCacheKeys.push(input);
    syncCache[input] = result;
    return result;
}

export function setFrames(frames) {
    framesElement = frames;
}

let cachedFrames = null;
let cachedFramesTimestamp = 0;
const FRAME_CACHE_TTL = 100;
const frameSelector = 'iframe[id^="frame-"]';

function getFrames() {
    const now = performance.now();
    if (!cachedFrames || (now - cachedFramesTimestamp > FRAME_CACHE_TTL)) {
        cachedFrames = Array.from(document.querySelectorAll(frameSelector));
        cachedFramesTimestamp = now;
    }
    return cachedFrames;
}

function invalidateFrameCache() {
    cachedFrames = null;
    cachedFramesTimestamp = 0;
}

const historyBuffer = [];
let historyFlushTimer = null;

function flushHistoryNow() {
    if (!historyBuffer.length) return;
    try {
        const raw = localStorage.getItem("history");
        const arr = raw ? JSON.parse(raw) : [];
        arr.push.apply(arr, historyBuffer);
        if (arr.length > 100) arr.splice(0, arr.length - 100);
        localStorage.setItem("history", JSON.stringify(arr));
    } catch (err) {}
    historyBuffer.length = 0;
    historyFlushTimer = null;
}

function pushHistory(entry) {
    historyBuffer.push(entry);
    if (!historyFlushTimer) {
        historyFlushTimer = setTimeout(flushHistoryNow, 0);
    }
}

export class Tab {
    constructor() {
        tabCounter++;
        this.tabNumber = tabCounter;
        this._loadHandler = () => this.handleLoad();

        this.frame = document.createElement("iframe");
        this.frame.className = "w-full h-full border-0 fixed";
        this.frame.title = "Proxy Frame";
        this.frame.src = "/newtab";
        this.frame.loading = "eager";
        this.frame.id = `frame-${tabCounter}`;
        this.frame.sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads";

        framesElement.appendChild(this.frame);
        invalidateFrameCache();

        this.switch();
        this.frame.addEventListener("load", this._loadHandler);

        document.dispatchEvent(new CustomEvent("new-tab", { 
            detail: { tabNumber: tabCounter } 
        }));
    }

    switch() {
        currentTab = this.tabNumber;
        const frames = getFrames();
        for (let i = 0, len = frames.length; i < len; i++) {
            frames[i].classList.add("hidden");
        }
        this.frame.classList.remove("hidden");
        currentFrame = this.frame;

        const frameUrl = currentFrame.contentWindow?.location?.href;
        if (frameUrl) {
            const idx = frameUrl.lastIndexOf('/');
            addressInput.value = decodeURIComponent(frameUrl.substring(idx + 1)) || "bromine://newtab";
        }

        document.dispatchEvent(new CustomEvent("switch-tab", { 
            detail: { tabNumber: this.tabNumber } 
        }));
    }

    close() {
        this.frame.removeEventListener("load", this._loadHandler);
        this.frame.remove();
        invalidateFrameCache();
        document.dispatchEvent(new CustomEvent("close-tab", { 
            detail: { tabNumber: this.tabNumber } 
        }));
    }

    handleLoad() {
        const frameUrl = this.frame.contentWindow?.location?.href;
        if (!frameUrl) return;

        const idx = frameUrl.lastIndexOf('/');
        const url = decodeURIComponent(frameUrl.substring(idx + 1));
        const title = this.frame.contentWindow?.document?.title || "";

        if (title) {
            pushHistory({ url, title });
        }

        document.dispatchEvent(new CustomEvent("url-changed", { 
            detail: { tabId: currentTab, title, url } 
        }));

        addressInput.value = url === "newtab" ? "bromine://newtab" : url;
    }
}

export async function newTab() {
    return new Tab();
}

export function switchTab(tabNumber) {
    const frames = getFrames();
    const targetId = `frame-${tabNumber}`;
    for (let i = 0, len = frames.length; i < len; i++) {
        const frame = frames[i];
        frame.classList.toggle("hidden", frame.id !== targetId);
    }
    currentTab = tabNumber;
    currentFrame = document.getElementById(targetId);

    const frameUrl = currentFrame?.contentWindow?.location?.href;
    if (frameUrl) {
        const idx = frameUrl.lastIndexOf('/');
        addressInput.value = decodeURIComponent(frameUrl.substring(idx + 1)) || "bromine://newtab";
    }

    document.dispatchEvent(new CustomEvent("switch-tab", { 
        detail: { tabNumber } 
    }));
}

export function closeTab(tabNumber) {
    const frame = document.getElementById(`frame-${tabNumber}`);
    if (!frame) return;

    frame.remove();
    invalidateFrameCache();

    if (currentTab === tabNumber) {
        const others = getFrames();
        if (others.length > 0) {
            switchTab(parseInt(others[0].id.replace("frame-", ""), 10));
        } else {
            newTab();
        }
    }
    document.dispatchEvent(new CustomEvent("close-tab", { 
        detail: { tabNumber } 
    }));
}
