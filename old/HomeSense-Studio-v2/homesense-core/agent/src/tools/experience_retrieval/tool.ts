import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type { ExperienceDoc } from "../../state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPERIENCES_DIR = join(dirname(dirname(__dirname)), "experiences");

function ensureExperiencesDir(): string {
  if (!existsSync(EXPERIENCES_DIR)) {
    mkdirSync(EXPERIENCES_DIR, { recursive: true });
  }
  return EXPERIENCES_DIR;
}

function parseExperienceFrontmatter(content: string, filePath: string): ExperienceDoc | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const metadata: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  let currentArrayKey: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value === "") {
        currentArrayKey = key;
        metadata[key] = [];
      } else {
        currentArrayKey = undefined;
        metadata[key] = value;
      }
      continue;
    }

    const itemMatch = line.match(/^\-\s+(.*)$/);
    if (itemMatch && currentArrayKey) {
      const current = Array.isArray(metadata[currentArrayKey]) ? metadata[currentArrayKey] as string[] : [];
      current.push(itemMatch[1].trim());
      metadata[currentArrayKey] = current;
    }
  }

  return {
    type: "experience",
    intent: (metadata.intent as string) || "",
    keywords: (metadata.keywords as string[]) || [],
    title: content.split("\n").find((l) => l.startsWith("# "))?.replace(/^# /, "") || "",
    content: match[2].trim(),
    filePath,
  };
}

export function searchExperiences(keywords: string[]): ExperienceDoc | null {
  const dir = ensureExperiencesDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  let bestMatch: ExperienceDoc | null = null;
  let bestScore = 0;

  for (const file of files) {
    const filePath = join(dir, file);
    const raw = readFileSync(filePath, "utf-8");
    const doc = parseExperienceFrontmatter(raw, filePath);
    if (!doc) continue;

    let score = 0;
    for (const keyword of keywords) {
      if (file.includes(keyword) || doc.title.includes(keyword)) {
        score += 2;
      }
      if (doc.keywords.some((k) => k.includes(keyword) || keyword.includes(k))) {
        score += 2;
      }
      if (doc.content.includes(keyword)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = doc;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

export function listExperiences(): ExperienceDoc[] {
  const dir = ensureExperiencesDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files
    .map((file) => {
      const filePath = join(dir, file);
      const raw = readFileSync(filePath, "utf-8");
      return parseExperienceFrontmatter(raw, filePath);
    })
    .filter((doc): doc is ExperienceDoc => doc !== null);
}

export { EXPERIENCES_DIR, ensureExperiencesDir };
