export type Role = 'officer' | 'police' | 'daket' | 'chor';
export type Phase = 'officer_call' | 'police_confirm' | 'discussion' | 'investigation' | 'fallback' | 'result';

export interface PublicPlayer {
  id: string;
  name: string;
  character: number; // which of the ten looks this player picked
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  score: number;
}
export interface RoomPeek {
  code: string;
  open: boolean; // lobby with a free seat
  takenCharacters: number[];
  takenNames: string[];
}
export interface Settings {
  rounds: number;
  discussionMs: number;
  investigationMs: number;
  fallbackMs: number;
  graceMs: number;
}
export interface RoundResult {
  deltas: Record<string, number>;
  outcome: 'police_correct' | 'police_wrong' | 'police_timeout';
  target: string | null;
  fallback: 'correct' | 'wrong' | 'missed' | null;
  roles: Record<string, Role>; // only present once the round is over
}
export interface RoundPublic {
  phase: Phase;
  deadline: number | null;
  verified: Record<string, Role>; // playerId -> role, only for players who raised a verified hand
  result: RoundResult | null;
}
export interface HistoryEntry extends RoundResult { round: number }
export interface FinalRow {
  playerId: string;
  name: string;
  total: number;
  perRound: number[];
  roles: Role[];
  correct: number;
  wrong: number;
  timeouts: number;
  rank: number;
}
export interface PublicState {
  code: string;
  state: 'lobby' | 'playing' | 'complete' | 'aborted';
  hostId: string;
  settings: Settings;
  roundNo: number;
  serverTime: number;
  paused: boolean;
  pauseEndsAt: number | null;
  players: PublicPlayer[];
  round: RoundPublic | null;
  history: HistoryEntry[];
  final: FinalRow[] | null;
}
export interface PrivateInfo {
  playerId: string;
  role: Role | null;
  roundNo: number;
}
export interface ChatMsg {
  id: number;
  kind: 'chat' | 'system';
  playerId: string | null;
  name: string;
  text: string;
  ts: number;
}
