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

  const prompt = `You are an Indian e-commerce seller writing a Flipkart listing. Your only goal is to match how REAL Indian shoppers actually type into the Flipkart/Google search box - not how a fashion catalogue or export-house buyer would describe the product.

Product attributes:
${Object.entries(attrs)
  .filter(([, v]) => v)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

STRICT RULES FOR KEYWORDS:
- Never invent vocabulary a normal shopper wouldn't type. BAD examples (never do this): "utility pants", "silhouette", "aesthetic", "streetwear ensemble". GOOD examples for a cargo pant: "cargo pants for women", "cargo pants ladies", "6 pocket pants", "loose fit pants", "cotton cargo pants", "grey cargo pants women", "baggy pants women", "cargo trouser", "casual pants for girls".
- Cover ALL of these angles, using this exact product's attributes (category, color, fabric, fit, gender) wherever they fit naturally:
  1. Plain category name + gender (e.g. "cargo pants for women", "cargo pants women")
  2. Category + color (e.g. "grey cargo pants")
  3. Category + fabric (e.g. "cotton cargo pants")
  4. Category + fit/style word a shopper actually uses (e.g. "loose fit cargo", "baggy cargo pants")
  5. Common misspellings or short forms real shoppers type (e.g. "cargos", "cargo pant" singular)
  6. Occasion/use-case (e.g. "casual pants", "college wear pants")
  7. Broader category the shopper might search instead (e.g. "trousers for women", "joggers" if relevant)
- Produce AT LEAST 20 keyword phrases. Do not stop early. Prioritize quantity of genuinely different, realistic search phrases over cleverness.
- Every phrase must be something you can picture a real Indian shopper typing verbatim into a search box. If in doubt, make it simpler and more literal, not more "creative."

STRICT RULES FOR DESCRIPTION:
- Plain, concrete, benefit-first sentences (comfort, fit, occasions to wear it, what to pair it with).
- No jargon, no "aesthetic", no "silhouette", no "ensemble". Write the way a product listing on Flipkart or Myntra actually reads, not a fashion blog.
- 90-140 words.

Write:
1. "description" as described above.
2. "keywords": an array of at least 20 phrases following the rules above.
3. "features": an array of 6-8 short, plain key-feature phrases (2-5 words each, e.g. "6 Utility Pockets", "Elastic Waistband", "Machine Washable") - concrete product facts, not marketing adjectives.`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      description: { type: "STRING" },
      keywords: { type: "ARRAY", items: { type: "STRING" } },
      features: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["description", "keywords", "features"],
  };

  // Try models newest-first. Google periodically retires older Flash models.
  // If this breaks again, check https://ai.google.dev/gemini-api/docs/models
  const MODEL_CANDIDATES = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];

  let data = null;
  let lastError = "";
  let usedModel = "";

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
              temperature: 0.8,
              // Gemini 2.5/3.x Flash models "think" before answering, and
              // those invisible thinking tokens are deducted from
              // maxOutputTokens FIRST. Capping thinking low and giving a
              // generous ceiling avoids the budget being eaten before any
              // JSON is written.
              maxOutputTokens: 3000,
              thinkingConfig: { thinkingBudget: 200 },
              responseMimeType: "application/json",
              responseSchema,
            },
          }),
        }
      );

      if (geminiResp.ok) {
        data = await geminiResp.json();
        usedModel = model;
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
    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const text = candidate?.content?.parts?.map((p) => p.text).join("\n") || "";

    if (!text) {
      return res.status(502).json({
        error:
          "Gemini (" + usedModel + ") returned no usable text (finishReason: " +
          finishReason + "). Try again.",
      });
    }

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
        error: "Could not parse AI response as JSON (finishReason: " + finishReason + ").",
        raw: text.slice(0, 500),
      });
    }

    if (!parsed.description || !Array.isArray(parsed.keywords) || !Array.isArray(parsed.features)) {
      return res.status(502).json({
        error: "AI response was missing description/keywords/features.",
        raw: text.slice(0, 500),
      });
    }

    // Hard floor: if the model still under-delivered on keyword count,
    // fail loudly rather than silently shipping a thin list.
    if (parsed.keywords.length < 12) {
      return res.status(502).json({
        error: "AI generated too few keywords (" + parsed.keywords.length + "). Try again.",
      });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown server error" });
  }
}
