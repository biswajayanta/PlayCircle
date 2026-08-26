export interface UserMe {
  user_id: string;
  email: string | null;
  phone: string | null;
  auth_provider: string;
  display_name: string;
  avatar_url: string | null;
  avatar_prompt: string | null;
  bio: string;
  city: string | null;
  is_public: boolean;
  show_stats: boolean;
  show_activity: boolean;
  sports_interest: string | null;
  age: number | null;
  age_verified: boolean;
  height_cm: number | null;
  height_verified: boolean;
  weight_kg: number | null;
  weight_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface Achievement {
  id: string;
  sport_id: number;
  sport_name: string;
  level: string;
  event_name: string;
  rank: string;
  verified: boolean;
  created_at: string;
}

export interface SportPerformance {
  sport_id: number;
  sport_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  win_rate: number;
  tournaments_played: number;
}

export interface UserProfile {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  sports_interest: string | null;
  age: number | null;
  age_verified: boolean;
  height_cm: number | null;
  height_verified: boolean;
  weight_kg: number | null;
  weight_verified: boolean;
  performance: SportPerformance[];
  achievements: Achievement[];
}

export interface Circle {
  id: string;
  name: string;
  owner_user_id: string;
  my_role: 'owner' | 'captain' | 'member';
  member_count: number;
  created_at: string;
}

export interface Game {
  id: string;
  sport_id: number;
  sport_name: string;
  venue_id: number;
  venue_name: string;
  circle_id: string;
  circle_name: string;
  creator_user_id: string;
  scheduled_at: string;
  visibility: 'open' | 'circle' | 'private';
  status: 'open' | 'full' | 'completed' | 'cancelled';
  confirmed_count: number;
  already_joined: boolean;
  is_past: boolean;
  has_expenses: boolean;
  all_settled: boolean;
  created_at: string;
}

export interface GameParticipant {
  user_id: string;
  display_name: string;
  status: 'invited' | 'confirmed' | 'declined';
  joined_at: string;
}

export interface GameDetail extends Game {
  participants: GameParticipant[];
}

export interface AssistantContext {
  circle_id?: string;
  game_id?: string;
  match_id?: string;
}

export interface AssistantPendingAction {
  tool_name: string;
  arguments: Record<string, unknown>;
  description: string;
}

export interface AssistantChatResponse {
  reply: string;
  pending_action: AssistantPendingAction | null;
  // Opaque — just store whatever this is and echo it back as `history` on
  // the next request. Don't try to interpret its contents.
  messages: Record<string, unknown>[];
}

export interface AssistantConfirmResponse {
  reply: string;
  success: boolean;
  result: Record<string, unknown> | null;
}

export interface Tournament {
  id: string;
  circle_id: string;
  circle_name: string;
  sport_id: number;
  sport_name: string;
  name: string;
  creator_user_id: string;
  format: string;
  status: 'draft' | 'fixture_set' | 'in_progress' | 'completed' | 'cancelled';
  game_id: string | null;
  participant_count: number;
  created_at: string;
}

export interface TournamentParticipant {
  user_id: string;
  display_name: string;
  joined_at: string;
}

export interface TournamentMatch {
  id: string;
  round_number: number;
  position_in_round: number;
  player_1_user_id: string | null;
  player_1_display_name: string | null;
  player_2_user_id: string | null;
  player_2_display_name: string | null;
  winner_user_id: string | null;
  match_id: string | null;
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'walkover';
}

export interface Bracket {
  tournament_id: string;
  total_rounds: number;
  matches: TournamentMatch[];
}

export interface Sport {
  id: number;
  code: string;
  name: string;
  indoor_outdoor: 'indoor' | 'outdoor' | 'both';
  min_players: number;
  max_players: number;
  scoring_config: Record<string, unknown>;
  calorie_coefficient: number;
  is_active: boolean;
}

export interface Venue {
  id: number;
  sport_ids: number[];
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
}

export interface PostMedia {
  id: string;
  media_type: 'photo' | 'video';
  url: string;
}

export interface Comment {
  id: string;
  author_user_id: string;
  author_display_name: string;
  body: string;
  created_at: string;
}

export interface Post {
  id: string;
  game_id: string | null;
  match_id: string | null;
  author_user_id: string;
  author_display_name: string;
  caption: string | null;
  visibility: 'public' | 'circle' | 'private';
  created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
}

export interface PostDetail extends Post {
  media: PostMedia[];
  comments: Comment[];
}

export interface ExpenseSplit {
  id: string;
  user_id: string;
  display_name: string;
  share_amount: string;
  is_settled: boolean;
  settled_at: string | null;
  drawn_from_kitty: string;
}

export interface Expense {
  id: string;
  game_id: string | null;
  match_id: string | null;
  description: string;
  amount: string;
  currency: string;
  paid_by_user_id: string;
  paid_by_display_name: string;
  created_at: string;
}

export interface ExpenseDetail extends Expense {
  splits: ExpenseSplit[];
}
export interface MatchScore {
  // number[] for rally-scored sports (Pickleball, within a set); {team,
  // points}[] for board-scored sports (Carrom) — shape is sport-specific,
  // nothing outside the backend engine and this screen inspects entries.
  history: unknown[];
  team_1: number;
  team_2: number;
  config?: { points_to_win?: number; win_by?: number; max_boards?: number | null; num_sets?: number };
  boards_played?: number;
  // Set-based sports only (Pickleball): completed sets, plus the set
  // currently being played.
  sets?: { team_1: number; team_2: number; winner: number; history: number[] }[];
  current_set_history?: number[];
  current_set_team_1?: number;
  current_set_team_2?: number;
}

export interface MatchParticipant {
  user_id: string;
  display_name: string;
  team: number;
  points_scored: number | null;
  result: 'win' | 'loss' | 'draw' | null;
}

export interface Match {
  id: string;
  game_id: string;
  sport_id: number;
  sport_name: string;
  format: 'singles' | 'doubles';
  started_at: string;
  ended_at: string | null;
  score: MatchScore;
  status: 'in_progress' | 'completed' | 'abandoned';
  created_at: string;
}

export interface MatchDetail extends Match {
  participants: MatchParticipant[];
}
export interface UserPublic {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  city: string | null;
}
export interface CircleMember {
  user_id: string;
  display_name: string;
  role: 'owner' | 'captain' | 'member';
  joined_at: string;
}
export interface VenueUsage {
  venue_name: string;
  games_count: number;
}

export interface CircleReport {
  circle_id: string;
  circle_name: string;
  member_count: number;
  games_completed: number;
  games_upcoming: number;
  games_cancelled: number;
  games_unplayed_past: number;
  games_total: number;
  tournaments_completed: number;
  tournaments_in_progress: number;
  tournaments_setting_up: number;
  tournaments_total: number;
  total_spent: string;
  venues: VenueUsage[];
}

export interface MatchSummary {
  match_id: string;
  format: 'singles' | 'doubles';
  started_at: string;
  ended_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  team_1_players: string[];
  team_2_players: string[];
  team_1_score: number;
  team_2_score: number;
  winning_team: string[] | null;
  // Per-set detail ({team_1,team_2,winner}[]) or per-board detail
  // ({team,points}[]), depending on the sport. Absent for sports with
  // nothing to drill into.
  breakdown?: Record<string, unknown>[] | null;
}

export interface GameReport {
  game_id: string;
  venue_name: string;
  scheduled_at: string;
  status: string;
  total_expenses: string;
  matches: MatchSummary[];
}

export interface SettlementTransaction {
  from_user_id: string;
  from_display_name: string;
  to_user_id: string;
  to_display_name: string;
  amount: string;
}

export interface SettlementPlan {
  game_id: string;
  fully_settled: boolean;
  transactions: SettlementTransaction[];
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  win_rate: number;
}

export interface CircleLeaderboard {
  circle_id: string;
  entries: LeaderboardEntry[];
}

export interface Treasurer {
  circle_id: string;
  user_id: string;
  display_name: string;
  set_by_user_id: string;
  created_at: string;
}

export interface AdvanceContribution {
  id: string;
  contributor_user_id: string;
  contributor_display_name: string;
  amount: string;
  note: string | null;
  recorded_by_user_id: string;
  created_at: string;
}

export interface MemberKittyBalance {
  user_id: string;
  display_name: string;
  total_contributed: string;
  total_drawn: string;
  balance: string;
}

export interface Treasury {
  circle_id: string;
  treasurer: Treasurer | null;
  treasurer_pool_balance: string | null;
  balances: MemberKittyBalance[];
  contributions: AdvanceContribution[];
}
