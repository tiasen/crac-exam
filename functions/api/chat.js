import { handleChat } from "../../shared/deepseek.js";

export function onRequestPost({ request }) {
  return handleChat(request);
}
