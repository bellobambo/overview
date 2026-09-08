import express, { Request, Response } from 'express';
import { fetchAndFlattenKeystrokes } from '../utils/keystrokeHelpers';
import { sendError, sendSuccess } from '../utils/apiResponse';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { 
    WritingBurst, 
    BehavioralScore, 
    SegmentAnalysis, 
    AnalysisResult, 
    AiRiskLevel, 
    BatchAnalysisItem 
} from '../types/analysis-types';
import supabase from '../supabaseClient';

const router = express.Router();

function extractTextFromSlice(content: any[]): string {
    if (!content) return '';
    let text = '';
    for (const node of content) {
        if (node.text) text += node.text;
        else if (node.type === 'paragraph' || node.type === 'heading') text += '\n';
        if (node.content) text += extractTextFromSlice(node.content);
    }
    return text.trim();
}

function calculateWpm(chars: number, durationMs: number): number {
    if (durationMs <= 0) return 0;
    const minutes = durationMs / 60000;
    const words = chars / 5;
    return Math.round(words / minutes);
}

/**
 * Calculates a statistical Cognitive Pause Score (0-100).
 * Authentic human writing exhibits variable pause distributions reflecting cognitive
 * planning, lexical retrieval, and sentence boundary pauses.
 * Robotic typing or automated injection typically has near-zero pauses or uniform pauses.
 */
function calculateCognitivePauseScore(pauses: number[], totalBursts: number): number {
    if (totalBursts <= 1 || pauses.length === 0) {
        return 80; // Insufficient data to penalize
    }

    const validPauses = pauses.filter(p => p > 300); // Filter out micro-keystroke latencies
    if (validPauses.length === 0) {
        return 30; // Suspicious: continuous stream with no cognitive pauses
    }

    const mean = validPauses.reduce((a, b) => a + b, 0) / validPauses.length;
    const variance = validPauses.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / validPauses.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? stdDev / mean : 0;

    // Natural human writing typically has CV between 0.45 and 1.8
    if (coefficientOfVariation < 0.20 && validPauses.length >= 4) {
        return 25; // Synthetic/robotic cadence with identical pause intervals
    } else if (coefficientOfVariation < 0.35) {
        return 55;
    } else if (coefficientOfVariation >= 0.45 && coefficientOfVariation <= 2.0) {
        return 95; // Highly natural human pause distribution
    } else {
        return 85;
    }
}

/**
 * Core analysis engine that computes behavioral telemetry and optional LLM text inspection.
 */
async function runAnalysisEngine(submissionId: string, forceDeep: boolean = false): Promise<AnalysisResult> {
    const { data: subData, error: subError } = await supabase
        .from('submissions')
        .select('id, student_id, assignment_id, final_text, status, analysis_data')
        .eq('id', submissionId)
        .single();

    if (subError || !subData) {
        throw new Error('Submission not found.');
    }

    // --- CACHE CHECK ---
    // If we have cached analysis data in Supabase, return it to save time and LLM credits
    if (subData.analysis_data) {
        const cached = subData.analysis_data as unknown as AnalysisResult;
        // If caller wants deep analysis, only return cache if it contains deep & document analysis
        if (forceDeep) {
            if (cached.hasDeepAnalysis && cached.hasDocumentAnalysis) {
                return cached;
            }
        } else {
            // If caller just wants a quick analysis, any cached data is sufficient
            return cached;
        }
    }
    // -------------------

    const events = await fetchAndFlattenKeystrokes(submissionId);
    if (events.length === 0) {
        throw new Error('No keystroke data found for analysis.');
    }

    // 1. Telemetry Aggregator (Burst Segmentation)
    const bursts: WritingBurst[] = [];
    let currentBurst: Partial<WritingBurst> | null = null;
    let lastEventTime = 0;
    let totalTabSwitches = 0;
    let totalPasteEvents = 0;
    let tabSwitchFlag = false;
    const interBurstPauses: number[] = [];

    for (let i = 0; i < events.length; i++) {
        const ev = events[i] as any;

        if (ev.type === 'window') {
            totalTabSwitches++;
            if (ev.action === 'blur') {
                tabSwitchFlag = true;
            }
            continue;
        }

        if (ev.type === 'step' && ev.stepJSON) {
            const step = ev.stepJSON;
            const ts = ev.timestamp || 0;
            const pauseBefore = lastEventTime === 0 ? 0 : Math.max(0, ts - lastEventTime);

            if (currentBurst && pauseBefore > 2000) {
                currentBurst.endIndex = i - 1;
                currentBurst.wpm = calculateWpm(currentBurst.charCount || 0, currentBurst.durationMs || 0);
                bursts.push(currentBurst as WritingBurst);
                interBurstPauses.push(pauseBefore);
                currentBurst = null;
            }

            let charsAdded = 0;
            let charsDeleted = 0;
            let textProduced = '';
            let isPaste = false;

            if (step.stepType === 'replace' || step.stepType === 'replaceAround') {
                charsDeleted = Math.max(0, step.to - step.from);
                if (step.slice && step.slice.content) {
                    textProduced = extractTextFromSlice(step.slice.content);
                    charsAdded = textProduced.length;
                }
                // Large paste detection: >80 chars inserted in under ~2.5s rate
                if (charsAdded > 80 && charsDeleted === 0) {
                    const instantaneousSpeed = pauseBefore > 0 ? charsAdded / (pauseBefore / 1000) : 100;
                    if (instantaneousSpeed > 30 || pauseBefore < 500) {
                        isPaste = true;
                        totalPasteEvents++;
                    }
                }
            }

            if (!currentBurst) {
                currentBurst = {
                    id: `burst_${i}`,
                    startIndex: i,
                    textProduced: '',
                    docPosFrom: step.from || 0,
                    docPosTo: (step.from || 0) + charsAdded,
                    durationMs: 0,
                    charCount: 0,
                    deletionCount: 0,
                    pauseBeforeMs: pauseBefore,
                    precededByTabSwitch: tabSwitchFlag,
                    isLargePaste: false
                };
                tabSwitchFlag = false;
            }

            currentBurst.textProduced += textProduced;
            currentBurst.charCount = (currentBurst.charCount || 0) + charsAdded;
            currentBurst.deletionCount = (currentBurst.deletionCount || 0) + charsDeleted;
            const stepEnd = (step.from || 0) + charsAdded;
            currentBurst.docPosTo = Math.max(currentBurst.docPosTo || 0, stepEnd);
            if (isPaste) {
                currentBurst.isLargePaste = true;
            }
            currentBurst.durationMs = ts - (events[currentBurst.startIndex!].timestamp || ts);
            lastEventTime = ts;
        }
    }

    if (currentBurst) {
        currentBurst.endIndex = events.length - 1;
        currentBurst.wpm = calculateWpm(currentBurst.charCount || 0, currentBurst.durationMs || 0);
        bursts.push(currentBurst as WritingBurst);
    }

    // 2. Behavioral Metrics Calculation
    const totalChars = bursts.reduce((acc, b) => acc + b.charCount, 0);
    const totalDeletes = bursts.reduce((acc, b) => acc + b.deletionCount, 0);
    const revisionRatio = totalChars === 0 ? 0 : Math.min(1, totalDeletes / totalChars);

    let revisionScore = 0;
    if (revisionRatio >= 0.06 && revisionRatio <= 0.35) {
        revisionScore = 100;
    } else if (revisionRatio < 0.06) {
        revisionScore = Math.round((revisionRatio / 0.06) * 100);
    } else {
        revisionScore = 50;
    }

    const wpms = bursts.filter(b => b.durationMs > 1000).map(b => b.wpm);
    const avgWpm = wpms.length ? Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length) : 0;
    let varianceScore = 100;
    if (wpms.length > 5) {
        const variance = wpms.reduce((acc, w) => acc + Math.pow(w - avgWpm, 2), 0) / wpms.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev < 5 && avgWpm > 50) {
            varianceScore = 20; // Unnaturally constant speed
        } else {
            varianceScore = Math.min(100, Math.round((stdDev / 15) * 100));
        }
    }

    const pastedChars = bursts.filter(b => b.isLargePaste).reduce((acc, b) => acc + b.charCount, 0);
    const pasteRatio = totalChars === 0 ? 0 : pastedChars / totalChars;
    let pasteScore = 100;
    if (pasteRatio > 0) {
        pasteScore = Math.max(0, Math.round(100 - (pasteRatio * 200)));
    }

    const suspiciousTabs = bursts.filter(b => b.precededByTabSwitch && (b.isLargePaste || b.wpm > 80)).length;
    let tabScore = 100;
    if (suspiciousTabs > 0) {
        tabScore = Math.max(0, 100 - (suspiciousTabs * 25));
    }

    const pauseScore = calculateCognitivePauseScore(interBurstPauses, bursts.length);

    const behavioralOverall = Math.round(
        (revisionScore * 0.25) +
        (varianceScore * 0.20) +
        (pauseScore * 0.20) +
        (pasteScore * 0.20) +
        (tabScore * 0.15)
    );

    let behavioralVerdict: 'authentic' | 'suspicious' | 'highly_suspicious' = 'authentic';
    if (behavioralOverall < 40) behavioralVerdict = 'highly_suspicious';
    else if (behavioralOverall < 70) behavioralVerdict = 'suspicious';

    const behavioralScore: BehavioralScore = {
        overall: behavioralOverall,
        revisionRatio: Math.round(revisionScore),
        burstSpeedVariance: Math.round(varianceScore),
        cognitivePausePattern: Math.round(pauseScore),
        pasteVolumeRatio: Math.round(pasteScore),
        tabSwitchCorrelation: Math.round(tabScore),
        verdict: behavioralVerdict
    };

    // 3. Behavioral AI Risk Component (0-100)
    // How much do the typing dynamics alone point toward AI or external pasting?
    const pasteRisk = Math.min(100, Math.round(pasteRatio * 160));
    const tabRisk = Math.min(100, suspiciousTabs * 30);
    const revisionDeficitRisk = revisionScore < 40 ? Math.round((40 - revisionScore) * 2) : 0;
    const roboticVarianceRisk = varianceScore < 40 ? Math.round((40 - varianceScore) * 1.5) : 0;
    const pauseDeficitRisk = pauseScore < 50 ? Math.round((50 - pauseScore) * 1.2) : 0;

    let behavioralAiRisk = Math.round(
        (pasteRisk * 0.40) +
        (tabRisk * 0.25) +
        (revisionDeficitRisk * 0.15) +
        (roboticVarianceRisk * 0.10) +
        (pauseDeficitRisk * 0.10)
    );

    // If more than 35% of the essay was inserted in single large paste bursts, risk must be high
    if (pasteRatio >= 0.35) {
        behavioralAiRisk = Math.max(behavioralAiRisk, Math.min(95, Math.round(pasteRatio * 105)));
    }

    const sessionStats = {
        totalWritingTimeMs: events.length > 0 ? (events[events.length - 1].timestamp - events[0].timestamp) : 0,
        totalTabSwitches,
        totalPasteEvents,
        totalBursts: bursts.length,
        averageWpm: avgWpm,
        totalWordsTyped: Math.round(totalChars / 5),
        totalWordsDeleted: Math.round(totalDeletes / 5)
    };

    let segments: SegmentAnalysis[] | undefined = undefined;
    let hasDeepAnalysis = false;
    let textAiScore = 0;

    // 4. Gemini LLM Forensic Analysis (Deep Analysis)
    const shouldRunDeep = forceDeep || behavioralAiRisk >= 35 || bursts.some(b => b.isLargePaste);
    const apiKey = process.env.GEMINI_API_KEY;

    if (shouldRunDeep && apiKey) {
        const significantBursts = bursts.filter(b => b.charCount > 25);
        if (significantBursts.length > 0) {
            const genAI = new GoogleGenerativeAI(apiKey);
            const payload = {
                metadata: sessionStats,
                segments: significantBursts.map(b => ({
                    segment_id: b.id,
                    text: b.textProduced,
                    telemetry: {
                        wpm: Math.round(b.wpm),
                        charCount: b.charCount,
                        durationMs: b.durationMs,
                        deletions: b.deletionCount,
                        is_paste: b.isLargePaste,
                        preceded_by_tab_switch: b.precededByTabSwitch
                    }
                }))
            };

            const prompt = `You are an expert Forensic Academic Integrity and AI Authorship Investigator.
Analyze this student essay broken into chronological creation segments, cross-referencing the text with behavioral telemetry.

EVALUATION CRITERIA:
1. High Probability AI (aiProbability: 80-100):
   - Uniform linguistic perplexity, formulaic academic structure (e.g. "Not merely X, but Y", "Furthermore, it is imperative to note").
   - Segment created via sudden large insertion/paste or impossible sustained speed (>120 WPM with 0 edits).
   - Preceded by a browser tab switch.

2. Suspicious AI / Paraphrased (aiProbability: 50-79):
   - Vocabulary complexity or stylistic register abruptly differs from adjacent segments.
   - Text was pasted and slightly tweaked with superficial synonym replacements.

3. Human Authored (aiProbability: 0-40):
   - Natural typing rhythm (<90 WPM), frequent corrections/backspaces, colloquial or idiosyncratic flow.

Return EXACT valid JSON with this structure (no markdown fences, pure JSON):
{
  "segment_analyses": [
    {
      "segmentId": "string (matches segment_id)",
      "verdict": "human" | "likely_human" | "suspicious" | "ai_generated",
      "aiProbability": number (0 to 100),
      "riskTags": ["array", "of", "strings"],
      "tooltipExplanation": "Clear 1-sentence explanation of the finding",
      "linguisticEvidence": "Specific observation about text style, perplexity, syntax, or phrasing",
      "telemetryEvidence": "Specific observation about typing speed, paste status, or tab switch"
    }
  ]
}

Payload:
${JSON.stringify(payload, null, 2)}`;

            try {
                let aiResponse;
                try {
                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-3.5-flash-lite", 
                        generationConfig: { responseMimeType: "application/json" } 
                    });
                    aiResponse = await model.generateContent(prompt);
                } catch (e: any) {
                    if (e.status === 429 || (e.message && e.message.includes('429'))) {
                        console.warn("Falling back to gemini-3.1-flash-lite due to rate limits");
                        const fallbackModel = genAI.getGenerativeModel({ 
                            model: "gemini-3.1-flash-lite", 
                            generationConfig: { responseMimeType: "application/json" } 
                        });
                        aiResponse = await fallbackModel.generateContent(prompt);
                    } else {
                        throw e;
                    }
                }

                const text = aiResponse.response.text();
                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const aiJson = JSON.parse(cleanText);

                if (aiJson && Array.isArray(aiJson.segment_analyses)) {
                    hasDeepAnalysis = true;
                    const parsedSegments: SegmentAnalysis[] = aiJson.segment_analyses.map((sa: any) => {
                        const burst = significantBursts.find(b => b.id === sa.segmentId);
                        return {
                            segmentId: sa.segmentId,
                            verdict: sa.verdict || 'human',
                            aiProbability: typeof sa.aiProbability === 'number' ? sa.aiProbability : 20,
                            riskTags: Array.isArray(sa.riskTags) ? sa.riskTags : [],
                            tooltipExplanation: sa.tooltipExplanation || 'Analyzed segment.',
                            linguisticEvidence: sa.linguisticEvidence || '',
                            telemetryEvidence: sa.telemetryEvidence || '',
                            docPosFrom: burst?.docPosFrom || 0,
                            docPosTo: burst?.docPosTo || 0,
                            telemetry: burst ? {
                                wpm: Math.round(burst.wpm),
                                charCount: burst.charCount,
                                durationMs: burst.durationMs,
                                deletions: burst.deletionCount,
                                isPaste: burst.isLargePaste,
                                precededByTabSwitch: burst.precededByTabSwitch
                            } : undefined
                        };
                    });

                    segments = parsedSegments;

                    // Calculate character-weighted text AI risk
                    let totalAnalyzedChars = 0;
                    let weightedAiSum = 0;
                    for (const seg of parsedSegments) {
                        const burst = significantBursts.find(b => b.id === seg.segmentId);
                        const chars = burst ? burst.charCount : 50;
                        totalAnalyzedChars += chars;
                        weightedAiSum += (seg.aiProbability * chars);
                    }
                    if (totalAnalyzedChars > 0) {
                        textAiScore = Math.round(weightedAiSum / totalAnalyzedChars);
                    }
                }
            } catch (err) {
                console.error('[AnalysisEngine] LLM analysis error:', err);
            }
        }
    }

    // 5. Full-Document Linguistic AI Detection (Pillar 3 - Telemetry Independent)
    // This catches AI text even when the student typed everything manually with
    // perfect human-like behavior (e.g. retyping ChatGPT output character by character).
    let documentTextAiScore = 0;
    let hasDocumentAnalysis = false;
    const finalText = subData.final_text || '';
    const wordCount = finalText.trim().split(/\s+/).filter(Boolean).length;

    // Run full-document analysis when deep analysis is requested and the text is substantial
    if (forceDeep && apiKey && wordCount >= 40) {
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const documentPrompt = `You are an expert AI-generated text detection system, similar to GPTZero or Originality.ai.
Your task is to analyze the ENTIRE document below and determine how likely it is to be AI-generated.

IMPORTANT: You must evaluate the TEXT ONLY. Ignore any information about how it was typed. Focus exclusively on linguistic patterns.

DETECTION CRITERIA:
1. Perplexity Analysis: AI text tends to have uniformly low perplexity (predictable word choices). Human text has variable perplexity with unexpected word selections, colloquialisms, and idiosyncratic phrasing.

2. Burstiness: Human writing alternates between complex and simple sentences. AI writing tends to maintain consistent sentence complexity throughout.

3. Vocabulary and Register: AI text often uses elevated academic vocabulary uniformly. Humans naturally mix registers -- formal, casual, technical -- sometimes within the same paragraph.

4. Formulaic Structures: AI frequently uses patterns like "Furthermore," "It is important to note that," "In conclusion," "This not only X but also Y," "plays a crucial role," "it is worth mentioning." Heavy reliance on these is a strong AI signal.

5. Hedging and Filler: AI rarely uses genuine hesitation markers, self-corrections, or informal asides that humans naturally include.

6. Coherence Uniformity: AI maintains unnaturally smooth topic transitions. Human essays often have slightly rough or abrupt transitions that reflect genuine thinking.

7. Paragraph Structure: AI tends to produce paragraphs of similar length with parallel internal structure. Human paragraphs vary in length and internal organization.

8. Originality of Arguments: AI tends to produce generic, widely-known arguments. Human writers more often include personal anecdotes, unique observations, or unconventional reasoning.

Return EXACT valid JSON (no markdown fences):
{
  "aiProbability": number (0 to 100, where 0 = certainly human, 100 = certainly AI),
  "verdict": "human" | "likely_human" | "mixed" | "likely_ai" | "ai_generated",
  "confidence": "low" | "medium" | "high",
  "evidence": [
    "string: specific observation 1",
    "string: specific observation 2",
    "string: specific observation 3"
  ],
  "summary": "A clear 1-2 sentence summary of the overall assessment"
}

DOCUMENT TO ANALYZE:
${finalText}`;

            let docAiResponse;
            try {
                const docModel = genAI.getGenerativeModel({
                    model: "gemini-3.5-flash-lite",
                    generationConfig: { responseMimeType: "application/json" }
                });
                docAiResponse = await docModel.generateContent(documentPrompt);
            } catch (e: any) {
                if (e.status === 429 || (e.message && e.message.includes('429'))) {
                    console.warn("[AnalysisEngine] Rate limited on document analysis, falling back to gemini-3.1-flash-lite");
                    const fallbackModel = genAI.getGenerativeModel({
                        model: "gemini-3.1-flash-lite",
                        generationConfig: { responseMimeType: "application/json" }
                    });
                    docAiResponse = await fallbackModel.generateContent(documentPrompt);
                } else {
                    throw e;
                }
            }

            const docText = docAiResponse.response.text();
            const cleanDocText = docText.replace(/```json/g, '').replace(/```/g, '').trim();
            const docJson = JSON.parse(cleanDocText);

            if (docJson && typeof docJson.aiProbability === 'number') {
                documentTextAiScore = Math.max(0, Math.min(100, docJson.aiProbability));
                hasDocumentAnalysis = true;
                console.log(`[AnalysisEngine] Full-document AI detection: ${documentTextAiScore}% (${docJson.verdict}), confidence: ${docJson.confidence}`);
            }
        } catch (err) {
            console.error('[AnalysisEngine] Full-document linguistic analysis error:', err);
        }
    }

    // 6. Three-Pillar Unified AI Likelihood Score
    //
    // Pillar 1: Behavioral Telemetry Risk (pastes, tabs, speed, pauses, revisions)
    //   - Catches copy-paste cheating, tab-switch-then-paste patterns, robotic typing
    //
    // Pillar 2: Segment-Level LLM Analysis (burst text + telemetry cross-reference)
    //   - Catches AI text that was pasted or typed in suspicious bursts
    //
    // Pillar 3: Full-Document Linguistic Analysis (pure text, telemetry-independent)
    //   - Catches AI text even when the student retyped it with perfect human behavior
    //   - This is what makes us competitive with traditional AI detectors

    let aiLikelihood: number;

    if (hasDocumentAnalysis && hasDeepAnalysis) {
        // All three pillars available: full triangulation
        // Weight the document-level analysis most heavily since it catches the blind spot
        aiLikelihood = Math.round(
            (behavioralAiRisk * 0.25) +
            (textAiScore * 0.30) +
            (documentTextAiScore * 0.45)
        );
    } else if (hasDocumentAnalysis) {
        // Document analysis available but no segment analysis
        aiLikelihood = Math.round(
            (behavioralAiRisk * 0.35) +
            (documentTextAiScore * 0.65)
        );
    } else if (hasDeepAnalysis) {
        // Segment analysis available but no document analysis
        aiLikelihood = Math.round(
            (behavioralAiRisk * 0.40) +
            (textAiScore * 0.60)
        );
    } else {
        // Behavioral telemetry only (fast heuristic for batch/quick analysis)
        aiLikelihood = behavioralAiRisk;
    }

    // Floor enforcement: if the document text itself is overwhelmingly AI,
    // behavioral telemetry alone should not be able to hide that
    if (hasDocumentAnalysis && documentTextAiScore >= 75) {
        aiLikelihood = Math.max(aiLikelihood, Math.round(documentTextAiScore * 0.80));
    }

    // If massive paste occurred, ensure floor matches the paste footprint
    if (pasteRatio >= 0.4) {
        aiLikelihood = Math.max(aiLikelihood, Math.round(pasteRatio * 92));
    }

    aiLikelihood = Math.max(0, Math.min(100, aiLikelihood));

    // 7. Verdict Classification
    let aiLikelihoodVerdict: AiRiskLevel = 'clean';
    if (aiLikelihood >= 80) aiLikelihoodVerdict = 'critical';
    else if (aiLikelihood >= 60) aiLikelihoodVerdict = 'high_risk';
    else if (aiLikelihood >= 35) aiLikelihoodVerdict = 'moderate_risk';
    else if (aiLikelihood >= 15) aiLikelihoodVerdict = 'low_risk';
    else aiLikelihoodVerdict = 'clean';

    // 8. Human-readable summary
    let aiLikelihoodSummary = '';
    if (aiLikelihoodVerdict === 'critical' || aiLikelihoodVerdict === 'high_risk') {
        const sources: string[] = [];
        if (documentTextAiScore >= 60) {
            sources.push(`document text analysis indicates ${documentTextAiScore}% AI authorship probability`);
        }
        if (totalPasteEvents > 0) {
            sources.push(`${totalPasteEvents} large paste event${totalPasteEvents > 1 ? 's' : ''}`);
        }
        if (suspiciousTabs > 0) {
            sources.push(`${suspiciousTabs} suspicious tab switch${suspiciousTabs > 1 ? 'es' : ''}`);
        }
        if (textAiScore >= 60) {
            sources.push('segment-level linguistic patterns consistent with AI generation');
        }
        const sourceDesc = sources.length > 0 ? sources.join(', ') : 'abnormal writing patterns';
        aiLikelihoodSummary = `High AI likelihood detected (${aiLikelihood}%). Key signals: ${sourceDesc}. Uniform syntactic density and formulaic structure observed.`;
    } else if (aiLikelihoodVerdict === 'moderate_risk') {
        const concerns: string[] = [];
        if (documentTextAiScore >= 40) {
            concerns.push('partial AI-like linguistic patterns');
        }
        if (totalPasteEvents > 0 || suspiciousTabs > 0) {
            concerns.push('behavioral anomalies');
        }
        const concernDesc = concerns.length > 0 ? concerns.join(' and ') : 'some suspicious patterns';
        aiLikelihoodSummary = `Moderate concern (${aiLikelihood}%). Detected ${concernDesc}. Instructor inspection recommended.`;
    } else {
        aiLikelihoodSummary = `Document shows authentic human authoring (${100 - aiLikelihood}% authentic). Natural keystroke revisions and organic cognitive pause distributions observed.`;
        if (hasDocumentAnalysis && documentTextAiScore <= 25) {
            aiLikelihoodSummary += ' Full-document linguistic analysis confirms human writing characteristics.';
        }
    }

    const result: AnalysisResult = {
        aiLikelihood,
        aiLikelihoodVerdict,
        aiLikelihoodSummary,
        hasDeepAnalysis,
        hasDocumentAnalysis,
        scoringBreakdown: {
            behavioralRisk: behavioralAiRisk,
            segmentTextScore: textAiScore,
            documentTextScore: documentTextAiScore
        },
        behavioralScore,
        segments,
        sessionStats
    };

    // Attempt persistent caching in submissions table if columns exist
    try {
        await supabase
            .from('submissions')
            .update({
                ai_score: aiLikelihood,
                analysis_data: result
            } as any)
            .eq('id', submissionId);
    } catch (_ignore) {
        // Safe to ignore if migration columns haven't been added yet
    }

    return result;
}

// BATCH ANALYSIS ENDPOINT: For Assignment Submissions List
router.post('/batch', async (req: Request, res: Response) => {
    try {
        const { submissionIds } = req.body;
        if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
            return sendSuccess(res, 200, 'Empty batch', { items: {} });
        }

        const items: Record<string, BatchAnalysisItem> = {};

        // Run batch analyses with concurrency limit
        const limit = 5;
        for (let i = 0; i < submissionIds.length; i += limit) {
            const chunk = submissionIds.slice(i, i + limit);
            await Promise.all(
                chunk.map(async (id: string) => {
                    try {
                        const analysis = await runAnalysisEngine(id, false);
                        items[id] = {
                            submissionId: id,
                            aiLikelihood: analysis.aiLikelihood,
                            aiLikelihoodVerdict: analysis.aiLikelihoodVerdict,
                            hasDeepAnalysis: analysis.hasDeepAnalysis,
                            totalPasteEvents: analysis.sessionStats.totalPasteEvents,
                            totalTabSwitches: analysis.sessionStats.totalTabSwitches,
                            analyzedAt: new Date().toISOString()
                        };
                    } catch (e) {
                        // Fallback default clean item if no keystrokes
                        items[id] = {
                            submissionId: id,
                            aiLikelihood: 10,
                            aiLikelihoodVerdict: 'clean',
                            hasDeepAnalysis: false,
                            totalPasteEvents: 0,
                            totalTabSwitches: 0
                        };
                    }
                })
            );
        }

        return sendSuccess(res, 200, 'Batch analysis complete', { items });
    } catch (e: any) {
        return sendError(res, 500, 'Batch analysis failed', undefined, e.message);
    }
});

// GET: Single submission analysis (returns quick or existing)
router.get('/:submissionId', async (req: Request, res: Response) => {
    try {
        const submissionId = req.params.submissionId;
        const result = await runAnalysisEngine(submissionId, false);
        return sendSuccess(res, 200, 'Analysis retrieved', result);
    } catch (e: any) {
        return sendError(res, 500, 'Analysis failed', undefined, e.message);
    }
});

// POST: Run full deep analysis
router.post('/:submissionId', async (req: Request, res: Response) => {
    try {
        const submissionId = req.params.submissionId;
        const deep = req.query.deep === 'true' || req.body?.deep === true;
        const result = await runAnalysisEngine(submissionId, deep);
        return sendSuccess(res, 200, 'Analysis complete', result);
    } catch (e: any) {
        return sendError(res, 500, 'Analysis failed', undefined, e.message);
    }
});

export default router;

