/**
 * Connecting Loom to a model (`loom-ui/model`): stream a spec from any
 * OpenAI-compatible endpoint, clean it, check it and repair it once.
 * Nothing here is used by the engine itself; it's for apps and tools.
 */
export { generateSpec, repairPrompt, type Attempt, type GenerateOptions, type GenerateResult, type Phase } from "./generate";
export { refineMessages, nextRefineContext, sumUsage, DEFAULT_MAX_CHANGES, type RefineContext, type ContextPolicy, type ContextInfo, type UsageTotals } from "./context";
export { streamChat, ModelError, type ChatMessage, type ModelConfig, type StreamPart, type Usage } from "./stream";
export { SpecFilter, loomLineTest, type FilterOutput } from "./clean";
