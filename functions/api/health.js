import { handleHealth } from "../../shared/deepseek.js";

export function onRequestGet() {
  return handleHealth("cloudflare-pages");
}
