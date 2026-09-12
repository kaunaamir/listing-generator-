// Vercel Serverless Function
// Keeps the Gemini API key on the server - never exposed to the browser.
// Set GEMINI_API_KEY in Vercel via: vercel env add GEMINI_API_KEY production

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is not configured with a Gemini API key yet." });
  }

  const attrs = req.body || {};

  const prompt = `You are writing an Indian e-commerce (Flipkart) product listing for organic search reach.

Product attributes:
${Object.entries(attrs)
  .filter(([, v]) => v)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Write:
1. "description": a persuasive, benefit-focused product description, 90-140 words, plain sentences, no markdown.
2. "keywords": an array of AS MANY relevant search keyword phrases as you can reasonably generate (aim for 15-25). Use simple, everyday terms the way normal shoppers in India actually type into search boxes - not fancy or formal phrasing. Cover synonyms, use-cases, and related terms to maximize search coverage.
3. "features": an array of 6-8 short key-feature phrases (2-5 words each).`;

  // Ask Gemini's native structured-output mode for this shape, rather than
  // just hoping the model's plain-text reply happens to be clean JSON.
  const responseSchema = {
    type: "OBJECT",
    properties: {
      description: { type: "STRING" },
      keywords: { type: "ARRAY", items: { type: "STRING" } },
      features: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["description", "keywords", "features"],
  };

  // Try models newest-first. Google periodically retires older Flash models
  // (this list needed updating once already) - if this breaks again, check
  // https://ai.google.dev/gemini-api/docs/models for the current model name
  // and add it to the front of this list.
  const MODEL_CANDIDATES = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];

  let data = null;
  let lastError = "";

  for (const model of MODEL_CANDIDATES) {
    try {
      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2000,
              responseMimeType: "application/json",
              responseSchema,
            },
          }),
        }
      );

      if (geminiResp.ok) {
        data = await geminiResp.json();
        break;
      } else {
        lastError = await geminiResp.text();
      }
    } catch (e) {
      lastError = e.message;
    }
  }

  if (!data) {
    return res.status(502).json({ error: "Gemini API error: " + lastError.slice(0, 300) });
  }

  try {
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";

    // Belt-and-suspenders: even with structured output requested, strip any
    // stray markdown fences and pull out the {...} block before parsing.
    let clean = text.replace(/```json|```/g, "").trim();
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return res.status(502).json({
        error: "Could not parse AI response as JSON.",
        raw: text.slice(0, 500),
      });
    }

    if (!parsed.description || !Array.isArray(parsed.keywords) || !Array.isArray(parsed.features)) {
      return res.status(502).json({
        error: "AI response was missing description/keywords/features.",
        raw: text.slice(0, 500),
      });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
