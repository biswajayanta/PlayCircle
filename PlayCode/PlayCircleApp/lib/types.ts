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
  created_at: string;
  updated_at: string;
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
  format: 'singles' | 'doubles';
  visibility: 'open' | 'circle' | 'private';
  status: 'open' | 'full' | 'completed' | 'cancelled';
  confirmed_count: number;
  capacity: number;
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

export interface Venue {
  id: number;
  sport_id: number;
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
  history: number[];
  team_1: number;
  team_2: number;
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
