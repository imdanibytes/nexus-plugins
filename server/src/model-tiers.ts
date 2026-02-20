import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { ModelTiers, ModelTierName } from "./types.js";

const TIERS_PATH = "/data/model-tiers.json";

const EMPTY: ModelTiers = { fast: null, balanced: null, powerful: null };

export function getModelTiers(): ModelTiers {
  try {
    const raw = readFileSync(TIERS_PATH, "utf-8");
    const data = JSON.parse(raw) as Partial<ModelTiers>;
    return { ...EMPTY, ...data };
  } catch {
    return { ...EMPTY };
  }
}

export function setModelTiers(tiers: ModelTiers): void {
  mkdirSync("/data", { recursive: true });
  writeFileSync(TIERS_PATH, JSON.stringify(tiers, null, 2));
}

export function getModelTier(name: ModelTierName): string | null {
  return getModelTiers()[name] ?? null;
}
