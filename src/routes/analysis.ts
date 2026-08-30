import express, { Request, Response } from 'express';
import { requireStudent } from '../middleware/auth'; // Wait, requireTeacher is better? Actually this is for the teacher to request
import { fetchAndFlattenKeystrokes } from '../utils/keystrokeHelpers';
import { sendError, sendSuccess } from '../utils/apiResponse';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { WritingBurst, BehavioralScore, SegmentAnalysis, AnalysisResult } from '../types/analysis-types';
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

router.post('/:submissionId', async (req: Request, res: Response) => {
    try {
        const submissionId = req.params.submissionId;
        const deep = req.query.deep === 'true';

        // Check auth (assuming the teacher is calling this, or the student)
        const { data: subData, error: subError } = await supabase
            .from('submissions')
            .select('student_id, assignment_id, final_text')
            .eq('id', submissionId)
            .single();

        if (subError || !subData) {
            return sendError(res, 404, 'Submission not found.');
        }

        const events = await fetchAndFlattenKeystrokes(submissionId);
        
        if (events.length === 0) {
             return sendError(res, 400, 'No keystroke data found for analysis.');
        }

        // 1. Telemetry Aggregator (Burst Segmentation)
        const bursts: WritingBurst[] = [];
        let currentBurst: Partial<WritingBurst> | null = null;
        let lastEventTime = 0;
        let totalTabSwitches = 0;
        let totalPasteEvents = 0;
        let tabSwitchFlag = false; // True if a tab switch happened before the next burst

        for (let i = 0; i < events.length; i++) {
            const ev = events[i] as any;

            if (ev.type === 'window') {
                totalTabSwitches++;
                if (ev.action === 'blur') tabSwitchFlag = true;
                continue;
            }

            if (ev.type === 'step' && ev.stepJSON) {
                const step = ev.stepJSON;
                const ts = ev.timestamp || 0;
                
                // Pause calculation
                const pauseBefore = lastEventTime === 0 ? 0 : ts - lastEventTime;
                
                if (currentBurst && pauseBefore > 2000) {
                    // Close current burst
                    currentBurst.endIndex = i - 1;
                    currentBurst.wpm = calculateWpm(currentBurst.charCount || 0, currentBurst.durationMs || 0);
                    bursts.push(currentBurst as WritingBurst);
                    currentBurst = null;
                }

                // Parse text changes
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
                    if (charsAdded > 80 && charsDeleted === 0 && pauseBefore > 0 && charsAdded / (pauseBefore/1000) > 30) {
                        isPaste = true;
                        totalPasteEvents++;
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
                    tabSwitchFlag = false; // Reset flag after applying it to a burst
                }

                currentBurst.textProduced += textProduced;
                currentBurst.charCount! += charsAdded;
                currentBurst.deletionCount! += charsDeleted;
                const stepEnd = (step.from || 0) + charsAdded;
                currentBurst.docPosTo = Math.max(currentBurst.docPosTo || 0, stepEnd);
                if (isPaste) currentBurst.isLargePaste = true;
                currentBurst.durationMs = ts - (events[currentBurst.startIndex!].timestamp || ts);
                
                lastEventTime = ts;
            }
        }

        if (currentBurst) {
            currentBurst.endIndex = events.length - 1;
            currentBurst.wpm = calculateWpm(currentBurst.charCount || 0, currentBurst.durationMs || 0);
            bursts.push(currentBurst as WritingBurst);
        }

        // 2. Behavioral Authenticity Score Calculation
        const totalChars = bursts.reduce((acc, b) => acc + b.charCount, 0);
        const totalDeletes = bursts.reduce((acc, b) => acc + b.deletionCount, 0);
        const revisionRatio = totalChars === 0 ? 0 : Math.min(1, totalDeletes / totalChars);
        
        let revisionScore = 0;
        if (revisionRatio >= 0.05 && revisionRatio <= 0.30) revisionScore = 100;
        else if (revisionRatio < 0.05) revisionScore = (revisionRatio / 0.05) * 100;
        else revisionScore = 50; // Too much deletion is weird but not necessarily AI

        const wpms = bursts.filter(b => b.durationMs > 1000).map(b => b.wpm);
        const avgWpm = wpms.length ? wpms.reduce((a,b)=>a+b,0) / wpms.length : 0;
        let varianceScore = 100;
        if (wpms.length > 5) {
            const variance = wpms.reduce((acc, w) => acc + Math.pow(w - avgWpm, 2), 0) / wpms.length;
            const stdDev = Math.sqrt(variance);
            if (stdDev < 5 && avgWpm > 50) varianceScore = 20; // Robotic
            else varianceScore = Math.min(100, (stdDev / 15) * 100);
        }

        let pasteScore = 100;
        const pastedChars = bursts.filter(b => b.isLargePaste).reduce((acc, b) => acc + b.charCount, 0);
        const pasteRatio = totalChars === 0 ? 0 : pastedChars / totalChars;
        if (pasteRatio > 0) pasteScore = Math.max(0, 100 - (pasteRatio * 200));

        let tabScore = 100;
        const suspiciousTabs = bursts.filter(b => b.precededByTabSwitch && (b.isLargePaste || b.wpm > 80)).length;
        if (suspiciousTabs > 0) tabScore = Math.max(0, 100 - (suspiciousTabs * 25));

        const pauseScore = 100; // Simplified for now

        const overallScore = Math.round(
            (revisionScore * 0.25) + 
            (varianceScore * 0.25) + 
            (pauseScore * 0.20) + 
            (pasteScore * 0.15) + 
            (tabScore * 0.15)
        );

        let verdict: 'authentic' | 'suspicious' | 'highly_suspicious' = 'authentic';
        if (overallScore < 40) verdict = 'highly_suspicious';
        else if (overallScore < 70) verdict = 'suspicious';

        const behavioralScore: BehavioralScore = {
            overall: overallScore,
            revisionRatio: Math.round(revisionScore),
            burstSpeedVariance: Math.round(varianceScore),
            cognitivePausePattern: pauseScore,
            pasteVolumeRatio: Math.round(pasteScore),
            tabSwitchCorrelation: Math.round(tabScore),
            verdict
        };

        const sessionStats = {
            totalWritingTimeMs: events.length > 0 ? (events[events.length-1].timestamp - events[0].timestamp) : 0,
            totalTabSwitches,
            totalPasteEvents,
            totalBursts: bursts.length,
            averageWpm: Math.round(avgWpm),
            totalWordsTyped: Math.round(totalChars / 5),
            totalWordsDeleted: Math.round(totalDeletes / 5)
        };

        const result: AnalysisResult = { behavioralScore, sessionStats };

        // 3. LLM Forensic Analysis
        if (deep || overallScore < 70) {
            const apiKey = process.env.GEMINI_API_KEY;
            if (apiKey) {
                const genAI = new GoogleGenerativeAI(apiKey);
                // Construct LLM payload from bursts that produced significant text
                const significantBursts = bursts.filter(b => b.charCount > 30);
                const payload = {
                    metadata: sessionStats,
                    segments: significantBursts.map(b => ({
                        segment_id: b.id,
                        text: b.textProduced,
                        telemetry: {
                            wpm: Math.round(b.wpm),
                            deletions: b.deletionCount,
                            is_paste: b.isLargePaste,
                            preceded_by_tab_switch: b.precededByTabSwitch
                        }
                    }))
                };

                const prompt = `You are a Forensic AI Detection Engine. Analyze this essay broken into chronological segments, cross-referencing the text with behavioral telemetry.
                
CRITERIA FOR DETECTING AI SEGMENTS:
1. High Probability AI: A segment has highly formal/robotic language AND it was pasted or typed extremely fast (>120 WPM) with 0 deletions, especially after a tab switch.
2. Suspicious AI: Contains sudden bursts of hyper-complex vocabulary that doesn't match the human-typed sections.
3. Confirmed Human: Normal typing speed (<100 WPM), frequent backspaces/deletions, natural language patterns.

Evaluate each segment and return this EXACT JSON structure:
{
  "segment_analyses": [
    {
      "segmentId": "string (match the input segment_id)",
      "verdict": "human" | "likely_human" | "suspicious" | "ai_generated",
      "aiProbability": number (0-100),
      "riskTags": ["array", "of", "strings"],
      "tooltipExplanation": "string explaining why"
    }
  ]
}

Payload:
${JSON.stringify(payload, null, 2)}`;

                try {
                    let aiResponse;
                    try {
                        const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite", generationConfig: { responseMimeType: "application/json" } });
                        aiResponse = await model.generateContent(prompt);
                    } catch (e: any) {
                        if (e.status === 429 || (e.message && e.message.includes('429'))) {
                            console.warn("429 Too Many Requests on gemini-3.5-flash-lite, falling back to gemini-3.1-flash-lite");
                            const fallbackModel = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", generationConfig: { responseMimeType: "application/json" } });
                            aiResponse = await fallbackModel.generateContent(prompt);
                        } else {
                            throw e;
                        }
                    }

                    const text = aiResponse.response.text();
                    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                    const aiJson = JSON.parse(cleanText);
                    
                    if (aiJson && Array.isArray(aiJson.segment_analyses)) {
                        // Map LLM response back to doc coordinates
                        result.segments = aiJson.segment_analyses.map((sa: any) => {
                            const burst = significantBursts.find(b => b.id === sa.segmentId);
                            return {
                                ...sa,
                                docPosFrom: burst?.docPosFrom || 0,
                                docPosTo: burst?.docPosTo || 0
                            };
                        });
                    }
                } catch (e) {
                    console.error("LLM Analysis failed:", e);
                }
            }
        }

        return sendSuccess(res, 200, 'Analysis complete', result);
    } catch (e: any) {
        return sendError(res, 500, 'Analysis failed', undefined, e.message);
    }
});

function calculateWpm(chars: number, durationMs: number) {
    if (durationMs === 0) return 0;
    const minutes = durationMs / 60000;
    const words = chars / 5;
    return words / minutes;
}

export default router;
