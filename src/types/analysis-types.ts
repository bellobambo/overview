export interface WritingBurst {
  id: string;
  startIndex: number;        // Index into the events array
  endIndex: number;
  textProduced: string;      // What text this burst generated
  docPosFrom: number;        // ProseMirror doc position (start)
  docPosTo: number;          // ProseMirror doc position (end)
  durationMs: number;
  charCount: number;
  deletionCount: number;
  wpm: number;
  pauseBeforeMs: number;
  precededByTabSwitch: boolean;
  isLargePaste: boolean;
}

export interface BehavioralScore {
  overall: number;           // 0–100 (Overall authentic behavioral index)
  revisionRatio: number;     // 0–100
  burstSpeedVariance: number;// 0-100
  cognitivePausePattern: number; // 0-100 (computed from pause variance)
  pasteVolumeRatio: number;  // 0-100
  tabSwitchCorrelation: number; // 0-100
  verdict: 'authentic' | 'suspicious' | 'highly_suspicious';
}

export type AiRiskLevel = 'clean' | 'low_risk' | 'moderate_risk' | 'high_risk' | 'critical';

export interface SegmentAnalysis {
  segmentId: string;
  verdict: 'human' | 'likely_human' | 'suspicious' | 'ai_generated';
  aiProbability: number;     // 0–100 (Likelihood this specific segment is AI)
  riskTags: string[];
  tooltipExplanation: string;
  docPosFrom: number;
  docPosTo: number;
  linguisticEvidence?: string;
  telemetryEvidence?: string;
  telemetry?: {
    wpm: number;
    charCount: number;
    durationMs: number;
    deletions: number;
    isPaste: boolean;
    precededByTabSwitch: boolean;
  };
}

export interface AnalysisResult {
  aiLikelihood: number;          // 0-100: The primary unified score teachers need
  aiLikelihoodVerdict: AiRiskLevel;
  aiLikelihoodSummary: string;   // Human-readable summary of how the score was determined
  hasDeepAnalysis: boolean;      // True if LLM segment analysis was completed
  hasDocumentAnalysis: boolean;  // True if full-document linguistic analysis was completed
  scoringBreakdown: {
    behavioralRisk: number;      // 0-100: Typing dynamics risk (pastes, tabs, speed, pauses)
    segmentTextScore: number;    // 0-100: Per-burst LLM analysis cross-referenced with telemetry
    documentTextScore: number;   // 0-100: Full-document linguistic AI detection (telemetry-independent)
  };
  behavioralScore: BehavioralScore; // Granular sub-scores for transparency
  segments?: SegmentAnalysis[];  // Segment-by-segment evidence
  sessionStats: {
    totalWritingTimeMs: number;
    totalTabSwitches: number;
    totalPasteEvents: number;
    totalBursts: number;
    averageWpm: number;
    totalWordsTyped: number;
    totalWordsDeleted: number;
  };
}

export interface BatchAnalysisItem {
  submissionId: string;
  aiLikelihood: number;
  aiLikelihoodVerdict: AiRiskLevel;
  hasDeepAnalysis: boolean;
  totalPasteEvents: number;
  totalTabSwitches: number;
  analyzedAt?: string;
}
