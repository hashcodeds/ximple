import { BareMuxConnection } from "https://unpkg.com/@mercuryworkshop/bare-mux@2.1.7/dist/index.mjs";

const connection = new BareMuxConnection("/ximplesc/bareworker.js");

let wispURL;
let transportURL;

export let tabCounter = 0;
export let currentTab = 0;
export let framesElement;
export let currentFrame;
export const addressInput = document.getElementById("address");

await import(`/ximplesc/scram/scramjet.all.js`);

const { ScramjetController } = window.$scramjetLoadController();

const scramjet = new ScramjetController({
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

scramjet.init();
window.scramjet = scramjet;

const transportOptions = {
        epoxy: "https://unpkg.com/@mercuryworkshop/epoxy-transport@2.1.27/dist/index.mjs",
        libcurl: "https://unpkg.com/@mercuryworkshop/libcurl-transport@1.5.0/dist/index.mjs",
};

const stockSW = "/ximplesc/ultraworker.js";
const swAllowedHostnames = ["localhost", "127.0.0.1"];

async function registerSW() {
        if (!navigator.serviceWorker) {
                if (location.protocol !== "https:" && !swAllowedHostnames.includes(location.hostname))
                        throw new Error("Service workers cannot be registered without https.");
                throw new Error("Your browser doesn't support service workers.");
        }

        const reg = await navigator.serviceWorker.register(stockSW, { scope: "/" });

        if (navigator.serviceWorker.controller) return;

        await new Promise(resolve => {
                if (reg.active) {
                        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
                        return;
                }

                const sw = reg.installing || reg.waiting;
                if (sw) {
                        sw.addEventListener("statechange", function onState() {
                                if (this.state === "activated") {
                                        sw.removeEventListener("statechange", onState);
                                        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
                                }
                        });
                } else {
                        setTimeout(resolve, 500);
                }
        });
}

await registerSW();

async function updateBareMux() {
        if (transportURL != null && wispURL != null) {
                await connection.setTransport(transportURL, [{ wisp: wispURL }]);
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

export function makeURL(input, template = "https://duckduckgo.com/?q=%s") {
        try {
                return new URL(input).toString();
        } catch (err) {}
        return template.replace("%s", encodeURIComponent(input));
}

export async function getProxied(input) {
        return scramjet.encodeUrl(makeURL(input));
}

export function setFrames(frames) {
        framesElement = frames;
}

export class Tab {
        constructor() {
                tabCounter++;
                this.tabNumber = tabCounter;

                this.frame = document.createElement("iframe");
                this.frame.setAttribute("class", "w-full h-full border-0 fixed");
                this.frame.setAttribute("title", "Proxy Frame");
                this.frame.setAttribute("src", "/newtab");
                this.frame.setAttribute("loading", "eager");
                this.frame.setAttribute("id", `frame-${tabCounter}`);
                framesElement.appendChild(this.frame);

                this.switch();
                this.frame.addEventListener("load", () => this.handleLoad());
                document.dispatchEvent(new CustomEvent("new-tab", { detail: { tabNumber: tabCounter } }));
        }

        switch() {
                currentTab = this.tabNumber;
                [...document.querySelectorAll("iframe")].forEach(f => f.classList.add("hidden"));
                this.frame.classList.remove("hidden");
                currentFrame = document.getElementById(`frame-${this.tabNumber}`);
                addressInput.value = decodeURIComponent(this.frame?.contentWindow?.location.href.split("/").pop());
                document.dispatchEvent(new CustomEvent("switch-tab", { detail: { tabNumber: this.tabNumber } }));
        }

        close() {
                this.frame.remove();
                document.dispatchEvent(new CustomEvent("close-tab", { detail: { tabNumber: this.tabNumber } }));
        }

        handleLoad() {
                let url = decodeURIComponent(this.frame?.contentWindow?.location.href.split("/").pop());
                let title = this.frame?.contentWindow?.document.title;
                let history = localStorage.getItem("history") ? JSON.parse(localStorage.getItem("history")) : [];
                history = [...history, { url, title }];
                localStorage.setItem("history", JSON.stringify(history));
                document.dispatchEvent(new CustomEvent("url-changed", { detail: { tabId: currentTab, title, url } }));
                if (url === "newtab") url = "bromine://newtab";
                addressInput.value = url;
        }
}

export async function newTab() {
        new Tab();
}

export function switchTab(tabNumber) {
        [...document.querySelectorAll("iframe")].forEach(f => f.classList.toggle("hidden", f.id !== `frame-${tabNumber}`));
        currentTab = tabNumber;
        currentFrame = document.getElementById(`frame-${tabNumber}`);
        addressInput.value = decodeURIComponent(currentFrame?.contentWindow?.location.href.split("/").pop());
        document.dispatchEvent(new CustomEvent("switch-tab", { detail: { tabNumber } }));
}

export function closeTab(tabNumber) {
        [...document.querySelectorAll("iframe")].forEach(f => { if (f.id === `frame-${tabNumber}`) f.remove(); });
        if (currentTab === tabNumber) {
                const others = document.querySelectorAll('iframe[id^="frame-"]');
                if (others.length > 0) switchTab(parseInt(others[0].id.replace("frame-", "")));
                else newTab();
        }
        document.dispatchEvent(new CustomEvent("close-tab", { detail: { tabNumber } }));
}
