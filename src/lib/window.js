// window.js — frontend helpers for driving the native Tauri window:
// auto-fit height, width<->size% mapping, drag, resize, context menu.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 720;

// The prototype's mapping: size% 40 -> 280px, each +1% -> +4px.
export const widthForSize = (size) =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(280 + (size - 40) * 4)));
export const sizeForWidth = (w) =>
  Math.round(40 + (Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)) - 280) / 4);

const appWindow = getCurrentWindow();

// Sizing goes through the backend rather than appWindow.setSize(): on Wayland
// a plain resize request is dropped by GTK, and only the native side can apply
// the geometry-hint trick that actually works there.
export async function setWindowSize(width, height) {
  await invoke("set_widget_size", {
    width: Math.round(width),
    height: Math.round(height),
  });
}

export async function startDragging() {
  try { await appWindow.startDragging(); } catch (_) {}
}

// The click point travels with the request: Wayland can only anchor the popup
// to the widget's own surface, so the native side needs coordinates.
export function showContextMenu(x, y) {
  invoke("show_context_menu", { x: Math.round(x), y: Math.round(y) }).catch(() => {});
}

export { appWindow };
