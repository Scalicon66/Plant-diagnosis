// ─── AI vision analysis (Google Gemini 2.0 Flash) ──────────────────────────────
// This module uses the official Google Gen AI SDK (@google/genai) with model
// gemini-2.0-flash (or gemini-1.5-flash / gemini-2.5-flash if specified).
// It sends a base64-encoded plant photo to Gemini and parses the structured
// JSON diagnosis that comes back.

import { GoogleGenAI } from '@google/genai'
import type { DiagnosisResult } from './types'

// Initialize GoogleGenAI client lazily.
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not configured.');
  }
  return new GoogleGenAI({ apiKey });
}

// ─── System prompt ───────────────────────────────────────────────────────────
// This is the detailed prompt that instructs Gemini how to think about a
// plant photo and what JSON shape to return.

export const PLANT_DIAGNOSIS_SYSTEM_PROMPT = `You are an expert plant pathologist with deep knowledge of plant diseases, nutrient deficiencies, and pest damage. Analyze the provided plant image using the following systematic diagnostic sequence:

1. SYMPTOM DISTRIBUTION: First assess where symptoms appear on the plant. Are they on old leaves, new growth, whole plant, or localized areas? Distribution pattern is critical for diagnosis.

2. TISSUE CHARACTERISTICS: Examine the specific visual properties of affected tissue. Note the color of lesions (brown, black, yellow, white, gray), the texture (powdery, wet, dry, sunken, raised), the margin definition (sharp or diffuse), and whether affected areas are necrotic or chlorotic.

3. DAMAGE PATTERN AND PROGRESSION: Consider how the damage pattern is arranged. Is it random, following vein patterns, circular, angular? Does it suggest a spreading pathogen or systemic issue?

4. CONTEXTUAL CLUES: Factor in any visible contextual information such as plant species indicators, soil surface, pot type, or environmental conditions visible in the image.

Based on this systematic assessment, respond ONLY with a valid JSON object in exactly this structure, no markdown, no explanation, just the raw JSON:

{
  "primary_diagnosis": "condition name here",
  "confidence_score": 78,
  "severity": "mild",
  "visual_markers": ["white powdery coating on upper leaf surface", "leaf edge curl at margins"],
  "top_possibilities": [
    { "condition": "Powdery Mildew", "confidence": 78 },
    { "condition": "Downy Mildew", "confidence": 14 },
    { "condition": "Calcium Deficiency", "confidence": 8 }
  ],
  "treatment_first_line": ["Apply neem oil solution weekly", "Improve air circulation around plant", "Remove heavily affected leaves"],
  "treatment_severe": ["Apply copper-based fungicide every 7 days", "Isolate plant from others", "Consider systemic fungicide if no improvement after 14 days"],
  "diagnostic_notes": "Include this field only if the case is ambiguous or two conditions have very similar presentations. Otherwise leave as empty string."
}

Important calibration rules:
- Set confidence_score to reflect real-world field accuracy, not controlled benchmark accuracy. If you would be 95 percent certain in ideal conditions, field conditions typically reduce this to 70-85 percent. Do not inflate confidence.
- Always include at least two alternative possibilities in top_possibilities even if the primary diagnosis is clear. The confidences of all possibilities combined do not need to sum to 100.
- If the image shows ambiguous early-stage symptoms where two conditions are genuinely difficult to distinguish, note this explicitly in diagnostic_notes and lower the confidence_score accordingly.
- severity must be exactly one of: mild, moderate, or severe. Base this on the percentage of plant tissue affected and the aggressiveness of symptom spread.`

// ─────────────────────────────────────────────────────────────────────────────

// analyzePlantImage
// Send a base64-encoded image to Gemini Flash and return the parsed diagnosis JSON.

export async function analyzePlantImage(
  base64Image: string,
  mimeType: string
): Promise<Partial<DiagnosisResult>> {
  // 1. Validate mimeType
  const validMime =
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/heic' ||
    mimeType === 'image/heif'
      ? mimeType
      : 'image/jpeg';

  // 2. Call Google AI Studio Gemini API (gemini-2.0-flash model)
  // Gemini 2.0 Flash is Google's latest high-speed, multimodal Flash model.
  const ai = getGenAIClient();
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: validMime,
              data: base64Image,
            },
          },
          {
            text: PLANT_DIAGNOSIS_SYSTEM_PROMPT,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  // 3. Extract text output from response
  const text = response.text?.trim() || '';

  // 4. Match and parse JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Gemini returned a response with no JSON object');
  }

  try {
    return JSON.parse(jsonMatch[0]) as Partial<DiagnosisResult>;
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${text.slice(0, 200)}`);
  }
}
