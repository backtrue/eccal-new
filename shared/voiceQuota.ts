import { z } from 'zod';

export const VOICE_CONTRACT_VERSION = 'eccal-voice-v1';
export const VOICE_FREE_SECONDS = 300;
export const voiceMemberId = z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/);
export const voiceOperationId = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/);
export const voiceMeterEvent = z.object({
  id: z.string().min(1).max(256),
  type: z.enum(['reserved', 'connected', 'tool_started', 'tool_finished', 'disconnected', 'ended']),
  at: z.number().int().min(0).max(8640000000000000),
  toolCallId: z.string().min(1).max(256).optional(),
}).strict();
export type VoiceMeterEvent = z.infer<typeof voiceMeterEvent>;
export type VoiceReservation = { id: string; memberId: string; seconds: number; deadline: number };
export type VoiceSettlement = { billedSeconds: number; remainingSeconds: number };
export type VoiceBalance = { memberId: string; totalSeconds: number; billedSeconds: number; reservedSeconds: number; remainingSeconds: number };

export class VoiceQuotaError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export function normalizeVoiceEvents(input: unknown): VoiceMeterEvent[] {
  const parsed = z.array(voiceMeterEvent).min(2).max(2048).safeParse(input);
  if (!parsed.success) throw new VoiceQuotaError('INVALID_METER_EVENTS', 400);
  const unique = new Map<string, VoiceMeterEvent>();
  for (const event of parsed.data) {
    const previous = unique.get(event.id);
    if (previous && (previous.type !== event.type || previous.at !== event.at || previous.toolCallId !== event.toolCallId)) throw new VoiceQuotaError('INVALID_METER_EVENTS', 400);
    unique.set(event.id, event);
  }
  const priority = { reserved: 0, connected: 1, tool_started: 2, tool_finished: 3, disconnected: 4, ended: 5 };
  const events = Array.from(unique.values()).sort((a, b) => a.at - b.at || priority[a.type] - priority[b.type] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const reserved = events.filter(event => event.type === 'reserved');
  const connected = events.filter(event => event.type === 'connected');
  const ended = events.filter(event => event.type === 'ended');
  if (reserved.length !== 1 || connected.length > 1 || ended.length !== 1 || ended[0].at < reserved[0].at || connected.some(event => event.at < reserved[0].at || event.at > ended[0].at)) throw new VoiceQuotaError('INVALID_METER_EVENTS', 400);
  const starts = new Map<string, number>();
  const finishes = new Set<string>();
  for (const event of events) {
    if (event.type !== 'tool_started' && event.type !== 'tool_finished') continue;
    const key = event.toolCallId ?? event.id.replace(/^tool-(?:start|end):/, '');
    if (event.type === 'tool_started') {
      if (starts.has(key) || event.at < reserved[0].at) throw new VoiceQuotaError('INVALID_METER_EVENTS', 400);
      starts.set(key, event.at);
    } else {
      const start = starts.get(key);
      if (start === undefined || finishes.has(key) || event.at < start) throw new VoiceQuotaError('INVALID_METER_EVENTS', 400);
      finishes.add(key);
    }
  }
  return events;
}

export function voiceBilledSeconds(events: VoiceMeterEvent[], reservedSeconds: number): number {
  const start = events.find(event => event.type === 'connected')?.at;
  const end = events.find(event => event.type === 'ended')!.at;
  if (start === undefined) return 0;
  const tools = new Map<string, [number, number]>();
  for (const event of events) {
    const key = event.toolCallId ?? event.id.replace(/^tool-(?:start|end):/, '');
    if (event.type === 'tool_started') tools.set(key, [event.at, end]);
    if (event.type === 'tool_finished' && tools.has(key)) tools.get(key)![1] = Math.min(event.at, end);
  }
  let waiting = 0;
  let covered = start;
  for (const [left, right] of Array.from(tools.values()).sort((a, b) => a[0] - b[0])) {
    waiting += Math.max(0, Math.min(right, end) - Math.max(left, start, covered));
    covered = Math.max(covered, right);
  }
  return Math.min(reservedSeconds, Math.ceil(Math.max(0, end - start - waiting) / 1000));
}
