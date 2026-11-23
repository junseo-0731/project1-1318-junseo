import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import JSZip from "jszip";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const MODEL_NAME = "gemini-4-hydrogen";

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, model: MODEL_NAME });
  });

  // 1. Environment Vision Analysis
  app.post("/api/ai/analyze-environment", async (req, res) => {
    try {
      const { imageBase64, mimeType, imageName } = req.body ?? {};
      if (typeof imageBase64 !== "string" || imageBase64.length < 32) {
        res.status(400).json({ error: "유효한 이미지 데이터가 필요합니다." });
        return;
      }
      if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.has(mimeType)) {
        res.status(400).json({ error: "JPEG, PNG, WebP 형식의 이미지만 지원합니다." });
        return;
      }
      if (imageBase64.length > 14_000_000) {
        res.status(413).json({ error: "이미지 용량이 너무 큽니다 (최대 10MB)." });
        return;
      }

      const ai = getGeminiClient();
      const promptText = `당신은 자율 비행 드론(UAV) 관제 시스템의 항공 영상 장애물 인식 전문가입니다.
제공된 드론 촬영(또는 항공 시야) 이미지를 분석하여 드론 비행 안전에 영향을 줄 수 있는 물체를 탐지하세요.
탐지 대상: 건물(building), 나무(tree), 전선/전신주(powerline), 사람(person), 차량(vehicle), 크레인/기타 구조물(other).
중요 원칙:
1. 단일 카메라 이미지에는 깊이(LiDAR/스테레오) 센서 정보가 없으므로 절대적인 3D 거리(m)를 단정하지 말고, 반드시 이미지 상의 상대적 위치(좌측/중앙/우측, 상단/중단/하단)와 정규화 좌표(0~1000 범위의 [ymin, xmin, ymax, xmax])로 표현하세요.
2. 각 장애물이 드론 이동에 미치는 구체적인 위험 요인과 추천 회피 행동을 한국어로 명확히 설명하세요.
3. 비행 시 특히 주의해야 할 구역(cautionZones)과 추천 비행 방향(recommendedFlightDirection)을 제시하세요.
이미지 이름 참고: ${typeof imageName === "string" ? imageName.slice(0, 80) : "uploaded_frame"}`;

      const result = await callWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
              { text: promptText },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                obstacles: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      label: { type: Type.STRING },
                      category: {
                        type: Type.STRING,
                        enum: ["building", "tree", "powerline", "person", "vehicle", "other"],
                      },
                      ymin: { type: Type.NUMBER, description: "0 to 1000 normalized top" },
                      xmin: { type: Type.NUMBER, description: "0 to 1000 normalized left" },
                      ymax: { type: Type.NUMBER, description: "0 to 1000 normalized bottom" },
                      xmax: { type: Type.NUMBER, description: "0 to 1000 normalized right" },
                      relativePosition: { type: Type.STRING },
                      riskLevel: { type: Type.STRING, enum: ["low", "medium", "high"] },
                      riskReason: { type: Type.STRING },
                      suggestedAction: { type: Type.STRING },
                    },
                    required: [
                      "id",
                      "label",
                      "category",
                      "ymin",
                      "xmin",
                      "ymax",
                      "xmax",
                      "relativePosition",
                      "riskLevel",
                      "riskReason",
                      "suggestedAction",
                    ],
                  },
                },
                cautionZones: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      zoneName: { type: Type.STRING },
                      relativeArea: { type: Type.STRING },
                      reason: { type: Type.STRING },
                    },
                    required: ["zoneName", "relativeArea", "reason"],
                  },
                },
                recommendedFlightDirection: { type: Type.STRING },
                overallRiskSummary: { type: Type.STRING },
                sensorCaveat: { type: Type.STRING },
              },
              required: [
                "obstacles",
                "cautionZones",
                "recommendedFlightDirection",
                "overallRiskSummary",
                "sensorCaveat",
              ],
            },
          },
        })
      );

      const rawText = (result.text ?? "{}").trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI 분석 중 오류가 발생했습니다.";
      if (message === "GEMINI_API_KEY_NOT_CONFIGURED") {
        res.status(503).json({
          error: "Gemini API 키가 설정되지 않았습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인하세요.",
        });
        return;
      }
      res.status(500).json({ error: `환경 분석 API 오류: ${message}` });
    }
  });

  // 2. Autonomous Flight Situation Judgment
  app.post("/api/ai/autonomous-decision", async (req, res) => {
    try {
      const { eventType, telemetry, pathSummary, previousPathSummary, contextNote } = req.body ?? {};
      if (typeof eventType !== "string" || !eventType) {
        res.status(400).json({ error: "eventType이 필요합니다." });
        return;
      }

      const ai = getGeminiClient();
      const prompt = `당신은 SKY-GUARD 자율 비행 드론의 AI 비행 판단 모듈입니다.
중요: 실제 경로 탐색(A*), 거리, 비행 시간, 배터리 잔량 계산은 이미 프로그램의 결정론적 엔진이 수행했습니다. 당신의 역할은 현재 비행 상황과 계산된 수치 변화를 바탕으로 항공 공학적 상황 분석과 자율 대응 이유를 명확하게 설명하는 것입니다.

[발생 이벤트]: ${eventType}
[추가 상황 메모]: ${typeof contextNote === "string" ? contextNote : "없음"}
[드론 실시간 텔레메트리]: ${JSON.stringify(telemetry ?? {})}
[이전 경로 요약]: ${JSON.stringify(previousPathSummary ?? {})}
[재계산된 경로 요약]: ${JSON.stringify(pathSummary ?? {})}

위 데이터를 근거로 한국어로 간결하고 전문적인 판단 보고를 JSON으로 반환하세요.`;

      const result = await callWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                situationAssessment: { type: Type.STRING },
                decisionRationale: { type: Type.STRING },
                executionPlan: { type: Type.STRING },
                safetyNotice: { type: Type.STRING },
              },
              required: [
                "situationAssessment",
                "decisionRationale",
                "executionPlan",
                "safetyNotice",
              ],
            },
          },
        })
      );

      const parsed = JSON.parse((result.text ?? "{}").trim());
      res.json(parsed);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI 자율 판단 중 오류가 발생했습니다.";
      if (message === "GEMINI_API_KEY_NOT_CONFIGURED") {
        res.status(503).json({
          error: "Gemini API 키가 설정되지 않았습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인하세요.",
        });
        return;
      }
      res.status(500).json({ error: `자율 판단 API 오류: ${message}` });
    }
  });

  // 3. Mission Optimization Recommendation
  app.post("/api/ai/optimize-mission", async (req, res) => {
    try {
      const { candidates, weights, droneSpec, recommendedRouteId } = req.body ?? {};
      if (!Array.isArray(candidates) || candidates.length === 0) {
        res.status(400).json({ error: "비교할 경로 후보 목록이 필요합니다." });
        return;
      }

      const ai = getGeminiClient();
      const prompt = `당신은 SKY-GUARD 임무 최적화 분석가입니다.
사용자가 설정한 중요도 가중치와 프로그램이 A* 알고리즘 및 물리 공식으로 계산한 여러 후보 경로의 정량 데이터를 바탕으로, 추천 경로의 선정 이유와 타 경로 대비 장단점을 한국어로 자연스럽고 설득력 있게 설명하세요.
계산 수치를 임의로 바꾸지 말고 전달된 수치를 그대로 인용하세요.

[사용자 가중치]: ${JSON.stringify(weights ?? {})}
[드론 제원 및 환경]: ${JSON.stringify(droneSpec ?? {})}
[알고리즘 선정 최적 경로 ID]: ${String(recommendedRouteId ?? "")}
[후보 경로 데이터]: ${JSON.stringify(candidates)}`;

      const result = await callWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                recommendationHeadline: { type: Type.STRING },
                selectionReasoning: { type: Type.STRING },
                comparativeAdvantages: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                tradeOffWarning: { type: Type.STRING },
              },
              required: [
                "recommendationHeadline",
                "selectionReasoning",
                "comparativeAdvantages",
                "tradeOffWarning",
              ],
            },
          },
        })
      );

      const parsed = JSON.parse((result.text ?? "{}").trim());
      res.json(parsed);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI 임무 최적화 설명 중 오류가 발생했습니다.";
      if (message === "GEMINI_API_KEY_NOT_CONFIGURED") {
        res.status(503).json({
          error: "Gemini API 키가 설정되지 않았습니다. Settings > Secrets 패널에서 GEMINI_API_KEY를 확인하세요.",
        });
        return;
      }
      res.status(500).json({ error: `임무 최적화 API 오류: ${message}` });
    }
  });

  // 4. GitHub-ready Project ZIP Export
  const EXCLUDED_DIRS = new Set([
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".git",
    ".aistudio",
  ]);
  const isExcludedFile = (name: string): boolean => {
    if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
      return true;
    }
    if (name === ".DS_Store" || name.endsWith(".log") || name.endsWith(".zip")) {
      return true;
    }
    return false;
  };

  app.get("/api/export-zip", async (_req, res) => {
    try {
      const zip = new JSZip();
      const rootDir = path.resolve(__dirname);

      const walkDir = (currentDir: string, relBase: string) => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const fullPath = path.resolve(currentDir, entry.name);
          if (!fullPath.startsWith(rootDir + path.sep)) continue;

          const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) continue;
            walkDir(fullPath, relPath);
          } else if (entry.isFile()) {
            if (isExcludedFile(entry.name)) continue;
            const fileBuffer = fs.readFileSync(fullPath);
            zip.file(relPath, fileBuffer);
          }
        }
      };

      walkDir(rootDir, "");

      const archiveBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="sky-guard-github.zip"'
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(archiveBuffer);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "ZIP 생성 중 오류가 발생했습니다.";
      res.status(500).json({ error: `프로젝트 ZIP 내보내기 오류: ${message}` });
    }
  });

  // Vite integration in development vs static serving in production
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Build output not found.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SKY-GUARD server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
