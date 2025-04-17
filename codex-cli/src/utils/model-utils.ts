import { OPENAI_API_KEY } from "./config";
import OpenAI from "openai";

export const RECOMMENDED_MODELS: Array<string> = ["o4-mini", "o3"];
export const RECOMMENDED_VENICE_MODELS: Array<string> = [
  "deepseek-r1-671b",
  "llama-3.2-3b",
  "llama-3.3-70b",
  "llama-3.1-405b",
  "mistral-31-24b",
  "qwen-2.5-qwq-32b",
  "qwen-2.5-vl",
  "dolphin-2.9.2-qwen2-72b",
  "qwen-2.5-coder-32b",
  "deepseek-coder-v2-lite"
];

/**
 * Background model loader / cache.
 *
 * We start fetching the list of available models from OpenAI once the CLI
 * enters interactive mode.  The request is made exactly once during the
 * lifetime of the process and the results are cached for subsequent calls.
 */

let modelsPromise: Promise<Array<string>> | null = null;

async function fetchModels(): Promise<Array<string>> {
  // If the user has not configured an API key we cannot hit the network
  if (!OPENAI_API_KEY) {
    return ["o4-mini"];
  }

  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const list = await openai.models.list();

    const models: Array<string> = [];
    for await (const model of list as AsyncIterable<{ id?: string }>) {
      if (model && typeof model.id === "string") {
        models.push(model.id);
      }
    }

    return models.sort();
  } catch {
    return [];
  }
}

export function preloadModels(): void {
  if (!modelsPromise) {
    // Fire‑and‑forget – callers that truly need the list should `await`
    // `getAvailableModels()` instead.
    void getAvailableModels();
  }
}

export async function getAvailableModels(): Promise<Array<string>> {
  if (!modelsPromise) {
    modelsPromise = fetchModels();
  }
  return modelsPromise;
}

/**
 * Verify that the provided model identifier is present in the set returned by
 * {@link getAvailableModels}. The list of models is fetched from the OpenAI
 * `/models` endpoint the first time it is required and then cached in‑process.
 */
export async function isModelSupportedForResponses(
  model: string | undefined | null,
  provider: string = "openai",
): Promise<boolean> {
  if (
    typeof model !== "string" ||
    model.trim() === "" ||
    (provider === "openai" && RECOMMENDED_MODELS.includes(model)) ||
    (provider === "venice" && RECOMMENDED_VENICE_MODELS.includes(model))
  ) {
    return true;
  }

  const MODEL_LIST_TIMEOUT_MS = 2_000;

  try {
    const models = await Promise.race<Array<string>>([
      getAvailableModels(),
      new Promise<Array<string>>((resolve) =>
        setTimeout(() => resolve([]), MODEL_LIST_TIMEOUT_MS),
      ),
    ]);

    // If the timeout fired we get an empty list → treat as supported to avoid
    // false negatives.
    if (models.length === 0) {
      return true;
    }

    return models.includes(model.trim());
  } catch {
    // Network or library failure → don't block start‑up.
    return true;
  }
}
