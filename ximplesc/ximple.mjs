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

const stockSW = "/ximplesc/ultraworker.js";
const swAllowedHostnames = ["localhost", "127.0.0.1"];

let swRegistered = false;
let swRegistrationPromise = null;

async function registerSW() {
    if (swRegistered) return;
    if (swRegistrationPromise) return swRegistrationPromise;
    
    swRegistrationPromise = (async () => {
        if (!navigator.serviceWorker) {
            if (location.protocol !== "https:" && !swAllowedHostnames.includes(location.hostname))
                throw new Error("Service workers cannot be registered without https.");
            throw new Error("Your browser doesn't support service workers.");
        }

        const reg = await navigator.serviceWorker.register(stockSW, { scope: "/" });

        if (navigator.serviceWorker.controller) {
            swRegistered = true;
            return;
        }

        await new Promise(resolve => {
            if (reg.active) {
                navigator.serviceWorker.addEventListener("controllerchange", () => {
                    swRegistered = true;
                    resolve();
                }, { once: true });
                return;
            }

            const sw = reg.installing || reg.waiting;
            if (sw) {
                sw.addEventListener("statechange", function onState() {
                    if (this.state === "activated") {
                        sw.removeEventListener("statechange", onState);
                        navigator.serviceWorker.addEventListener("controllerchange", () => {
                            swRegistered = true;
                            resolve();
                        }, { once: true });
                    }
                });
            } else {
                setTimeout(() => {
                    swRegistered = true;
                    resolve();
                }, 500);
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
        updatePromise = connection.setTransport(transportURL, [{ wisp: wispURL }]);
        await updatePromise;
        updatePromise = null;
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

let lastSyncInput = null;
let lastSyncOutput = null;

export function getProxiedSync(input) {
    if (!scramjet) return null;
    if (lastSyncInput === input) return lastSyncOutput;
    const result = scramjet.encodeUrl(makeURL(input));
    lastSyncInput = input;
    lastSyncOutput = result;
    return result;
}

export function setFrames(frames) {
    framesElement = frames;
}

let cachedFrames = null;
const frameSelector = 'iframe[id^="frame-"]';

function getFrames() {
    if (!cachedFrames) {
        cachedFrames = document.querySelectorAll(frameSelector);
    }
    return cachedFrames;
}

function invalidateFrameCache() {
    cachedFrames = null;
}

export class Tab {
    constructor() {
        tabCounter++;
        this.tabNumber = tabCounter;

        this.frame = document.createElement("iframe");
        this.frame.className = "w-full h-full border-0 fixed";
        this.frame.title = "Proxy Frame";
        this.frame.src = "/newtab";
        this.frame.loading = "eager";
        this.frame.id = `frame-${tabCounter}`;
        
        framesElement.appendChild(this.frame);
        invalidateFrameCache();

        this.switch();
        this.frame.addEventListener("load", () => this.handleLoad());
        document.dispatchEvent(new CustomEvent("new-tab", { detail: { tabNumber: tabCounter } }));
    }

    switch() {
        currentTab = this.tabNumber;
        const frames = getFrames();
        for (let i = 0; i < frames.length; i++) {
            frames[i].classList.add("hidden");
        }
        this.frame.classList.remove("hidden");
        currentFrame = document.getElementById(`frame-${this.tabNumber}`);
        const frameUrl = currentFrame?.contentWindow?.location.href;
        if (frameUrl) {
            const lastSlash = frameUrl.lastIndexOf('/');
            addressInput.value = decodeURIComponent(frameUrl.substring(lastSlash + 1));
        }
        document.dispatchEvent(new CustomEvent("switch-tab", { detail: { tabNumber: this.tabNumber } }));
    }

    close() {
        this.frame.remove();
        invalidateFrameCache();
        document.dispatchEvent(new CustomEvent("close-tab", { detail: { tabNumber: this.tabNumber } }));
    }

    handleLoad() {
        const frameUrl = this.frame?.contentWindow?.location.href;
        if (!frameUrl) return;
        const lastSlash = frameUrl.lastIndexOf('/');
        let url = decodeURIComponent(frameUrl.substring(lastSlash + 1));
        let title = this.frame?.contentWindow?.document?.title || "";
        if (title) {
            try {
                let history = localStorage.getItem("history");
                let historyArray = history ? JSON.parse(history) : [];
                historyArray.push({ url, title });
                if (historyArray.length > 100) historyArray = historyArray.slice(-100);
                localStorage.setItem("history", JSON.stringify(historyArray));
            } catch (err) {}
        }
        document.dispatchEvent(new CustomEvent("url-changed", { detail: { tabId: currentTab, title, url } }));
        if (url === "newtab") url = "bromine://newtab";
        addressInput.value = url;
    }
}

export async function newTab() {
    new Tab();
}

export function switchTab(tabNumber) {
    const frames = getFrames();
    const targetId = `frame-${tabNumber}`;
    for (let i = 0; i < frames.length; i++) {
        frames[i].classList.toggle("hidden", frames[i].id !== targetId);
    }
    currentTab = tabNumber;
    currentFrame = document.getElementById(targetId);
    const frameUrl = currentFrame?.contentWindow?.location.href;
    if (frameUrl) {
        const lastSlash = frameUrl.lastIndexOf('/');
        addressInput.value = decodeURIComponent(frameUrl.substring(lastSlash + 1));
    }
    document.dispatchEvent(new CustomEvent("switch-tab", { detail: { tabNumber } }));
}

export function closeTab(tabNumber) {
    const frame = document.getElementById(`frame-${tabNumber}`);
    if (frame) frame.remove();
    invalidateFrameCache();
    if (currentTab === tabNumber) {
        const others = getFrames();
        if (others.length > 0) {
            const firstId = others[0].id;
            switchTab(parseInt(firstId.replace("frame-", "")));
        } else {
            newTab();
        }
    }
    document.dispatchEvent(new CustomEvent("close-tab", { detail: { tabNumber } }));
}
