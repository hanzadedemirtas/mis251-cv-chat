const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
];

const configuredModel = process.env.GEMINI_MODEL?.trim();
let availableModels = configuredModel
  ? [configuredModel, ...DEFAULT_MODELS.filter((m) => m !== configuredModel)]
  : [...DEFAULT_MODELS];

/**
 * Loads GOOGLE_API_KEY from process.env, falling back to keys.txt in local dev.
 */
function resolveGoogleApiKey() {
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim()) {
    return process.env.GOOGLE_API_KEY.trim();
  }

  const keysPath = path.join(__dirname, "keys.txt");
  if (!fs.existsSync(keysPath)) {
    return "";
  }

  const lines = fs.readFileSync(keysPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key === "GOOGLE_API_KEY" && val) {
      return val;
    }
  }
  return "";
}

const CV_SYSTEM_PROMPT = `You are the interactive AI portfolio assistant for Hanzade Demirtaş on her personal CV website.
Answer visitors' questions clearly, concisely, and professionally based strictly on the CV profile below.
If the visitor writes in Turkish, respond in natural Turkish; if they write in English (or another language), respond in that language.
Never invent facts, GPA, work experience, dates, or skills that are not listed below. If something is not mentioned in her CV, politely say it is not listed on her CV and suggest contacting her directly via email or LinkedIn.

--- HANZADE DEMİRTAŞ CV PROFILE ---
Name: Hanzade Demirtaş
Headline: Management Information Systems (MIS) Student at Boğaziçi University
Location: Istanbul, Turkey
Contact:
- Email: hanzade.demirtas@std.bogazici.edu.tr
- LinkedIn: https://www.linkedin.com/in/hanzade-demirtaş-2301a1334
- GitHub: https://github.com/hanzadedemirtas

About Me:
I am a second-year Management Information Systems student at Boğaziçi University interested in web development, data analysis, and software tools. I enjoy building clean web interfaces, analyzing datasets with Python and Excel, and exploring how AI can be integrated into practical web applications.

Education:
- Boğaziçi University — B.A. in Management Information Systems (MIS) (2024 – Present)
- Relevant Coursework: Web Development, Introduction to Programming (Python), Managerial Statistics, Database & SQL Fundamentals, Macroeconomics, Business Law

Projects:
1. Interactive Web CV & AI Assistant: Built a responsive personal portfolio webpage featuring an embedded AI chatbot powered by the Google Gemini API and deployed on Render, allowing visitors to ask questions about my background and coursework.
2. Managerial Statistics & Data Analysis Study: Conducted a statistical research project in Microsoft Excel involving hypothesis testing, probability distributions, and PivotTable visualizations on real-world datasets.
3. React Calculator Web App: Developed a modular calculator interface using React and TypeScript as part of web development coursework, focusing on clean component structure and state management.

Skills:
Python, HTML5, CSS3, JavaScript, TypeScript, React, SQL, Microsoft Excel (PivotTables & Data Analysis), Git & GitHub, VS Code

Languages:
- Turkish (Native)
- English (Advanced - Academic & Technical)
--- END PROFILE ---`;

async function callGeminiModel(model, apiKey, contents, signal) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: CV_SYSTEM_PROMPT }],
      },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 600,
      },
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", model: availableModels[0] || "unavailable" });
});

app.post("/api/chat", async (req, res) => {
  const apiKey = resolveGoogleApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: "Server configuration error: Gemini API key is not configured.",
    });
  }

  const rawMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!rawMessage) {
    return res.status(400).json({ error: "Please enter a non-empty message." });
  }
  if (rawMessage.length > 1000) {
    return res.status(400).json({ error: "Message is too long (max 1000 characters)." });
  }

  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const sanitizedHistory = rawHistory
    .slice(-10)
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "model") &&
        typeof item.text === "string" &&
        item.text.trim().length > 0
    )
    .map((item) => ({
      role: item.role,
      parts: [{ text: item.text.trim().slice(0, 2000) }],
    }));

  const contents = [
    ...sanitizedHistory,
    { role: "user", parts: [{ text: rawMessage }] },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    let lastErrorStatus = 502;
    let lastErrorMessage = "Upstream request failed";
    let usedModel = availableModels[0];
    let succeededData = null;

    for (const candidate of [...availableModels]) {
      usedModel = candidate;
      const { response, data } = await callGeminiModel(
        candidate,
        apiKey,
        contents,
        controller.signal
      );

      if (response.ok) {
        succeededData = data;
        break;
      }

      lastErrorStatus = response.status;
      lastErrorMessage = data?.error?.message || `Upstream error (${response.status})`;
      console.warn(`Gemini model ${candidate} failed (${response.status}): ${lastErrorMessage}`);

      if (response.status === 404 && availableModels.length > 1) {
        availableModels = availableModels.filter((m) => m !== candidate);
        continue;
      }

      if ((response.status === 503 || response.status === 429) && availableModels.length > 1) {
        continue;
      }

      break;
    }

    if (!succeededData) {
      console.error("Gemini API error:", lastErrorStatus, lastErrorMessage);
      return res.status(502).json({
        error: "Unable to reach the AI assistant right now. Please try again in a moment.",
      });
    }

    const reply = (succeededData?.candidates?.[0]?.content?.parts || [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: "The AI assistant returned an empty response. Please try rephrasing your question.",
      });
    }

    return res.json({ reply, model: usedModel });
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "AI request timed out. Please try again." });
    }
    console.error("Chat handler error:", err.message);
    return res.status(500).json({ error: "Unexpected server error while generating reply." });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`CV server listening on port ${PORT}`);
});
