export type VisionSnapshot = {
  ts_ms: number;
  frame_id?: string;

  // Scene / environment
  environment: {
    label: string;            // "classroom", "study room", "cafeteria", "outdoors"
    confidence: number;       // 0..1
    objects?: string[];       // up to ~8, key objects only ("whiteboard", "laptop")
    lighting: {
      level: "low" | "normal" | "bright";
      source?: "natural" | "indoor" | "mixed";
      confidence: number;     // 0..1
    };
    noise_or_busyness?: {
      level: "quiet" | "moderate" | "busy";
      confidence: number;     // 0..1
    };
  };

  // People overview (do NOT identify people)
  people: {
    count_estimate: number;   // integer
    count_confidence: number; // 0..1
    proximity: "close" | "medium" | "far"; // approximate distance to nearest person
    orientation_summary?: "facing_camera" | "side_profile" | "back_turned" | "mixed";
    confidence: number;       // 0..1
  };

  // Social cue estimates (probabilistic, NOT facts)
  social_cues: {
    // Aggregate cues only (avoid per-person identity tracking for MVP)
    facial_expression_summary?: {
      label:
        | "neutral"
        | "positive"
        | "negative"
        | "confused"
        | "engaged"
        | "unknown";
      confidence: number;     // 0..1
      notes?: string[];       // up to 2 like "smiling", "furrowed brow" (descriptive)
    };

    body_posture_summary?: {
      label:
        | "open"
        | "closed"
        | "leaning_in"
        | "leaning_away"
        | "restless"
        | "unknown";
      confidence: number;     // 0..1
      notes?: string[];       // up to 2 like "arms crossed", "slouched"
    };

    gaze_summary?: {
      // Don’t call it “eye contact” as a claim; call it gaze direction / attention cues
      label:
        | "toward_camera"
        | "away_from_camera"
        | "downward"
        | "mixed"
        | "unknown";
      confidence: number;     // 0..1
      notes?: string[];       // up to 2
    };

    interaction_context?: {
      // What kind of interaction does it *look like*?
      label:
        | "conversation"
        | "presentation"
        | "studying"
        | "waiting"
        | "unknown";
      confidence: number;     // 0..1
    };
  };

  // General guardrails for downstream “brain”
  reliability: {
    overall_confidence: number;    // 0..1
    limitations?: string[];        // up to 3 like "single frame", "occlusion", "low light"
  };

  // Freeform short notes (optional)
  notes?: string[]; // up to 3
};


export type VisionMode = 'mock' | 'gemini';

export type VisionServiceConfig = {
  mode: VisionMode;
  intervalMs: number;
  geminiApiKey?: string;
  geminiModel?: string;
  captureTimeoutMs?: number;
};
