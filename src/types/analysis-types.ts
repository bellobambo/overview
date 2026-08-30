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
  overall: number;           // 0–100
  revisionRatio: number;     // 0–100
  burstSpeedVariance: number;
  cognitivePausePattern: number;
  pasteVolumeRatio: number;
  tabSwitchCorrelation: number;
  verdict: 'authentic' | 'suspicious' | 'highly_suspicious';
}

export interface SegmentAnalysis {
  segmentId: string;
  verdict: 'human' | 'likely_human' | 'suspicious' | 'ai_generated';
  aiProbability: number;     // 0–100
  riskTags: string[];
  tooltipExplanation: string;
  docPosFrom: number;
  docPosTo: number;
}

export interface AnalysisResult {
  behavioralScore: BehavioralScore;
  segments?: SegmentAnalysis[];  // Only present if LLM analysis was run
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
