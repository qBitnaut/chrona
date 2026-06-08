// window.js — frontend helpers for driving the native Tauri window:
// auto-fit height, width<->size% mapping, drag, resize, context menu.
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 720;

// The prototype's mapping: size% 40 -> 280px, each +1% -> +4px.
export const widthForSize = (size) =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(280 + (size - 40) * 4)));
export const sizeForWidth = (w) =>
  Math.round(40 + (Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w)) - 280) / 4);

const appWindow = getCurrentWindow();

export async function setWindowSize(width, height) {
  await appWindow.setSize(new LogicalSize(Math.round(width), Math.round(height)));
}

export async function startDragging() {
  try { await appWindow.startDragging(); } catch (_) {}
}

export function showContextMenu() {
  invoke("show_context_menu").catch(() => {});
}

export { appWindow };
