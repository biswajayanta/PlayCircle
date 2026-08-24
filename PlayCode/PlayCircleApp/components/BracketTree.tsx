import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Bracket, TournamentMatch } from '../lib/types';

interface BracketTreeProps {
  bracket: Bracket;
  canStartMatches: boolean;
  startingSlotId: string | null;
  onStartMatch: (match: TournamentMatch) => void;
  onWalkover: (match: TournamentMatch) => void;
  onContinueScoring: (matchId: string) => void;
}

const MATCH_HEIGHT = 64;
const MATCH_WIDTH = 168;
const ROUND_GAP = 64; // horizontal space between round columns, for connector lines
const MATCH_VGAP = 40; // vertical gap between adjacent round-1 matches — sized to leave
// room for the action-button row some cards render below themselves,
// without overlapping the next match card down

export default function BracketTree({
  bracket,
  canStartMatches,
  startingSlotId,
  onStartMatch,
  onWalkover,
  onContinueScoring,
}: BracketTreeProps) {
  // Group matches by round, and compute each match's vertical center.
  // Round 1 stacks sequentially; every later round's match sits exactly
  // centered between its two feeder matches from the previous round —
  // the standard bracket-tree layout convention.
  const byRound: Record<number, TournamentMatch[]> = {};
  for (const m of bracket.matches) {
    (byRound[m.round_number] ??= []).push(m);
  }
  for (const round of Object.values(byRound)) {
    round.sort((a, b) => a.position_in_round - b.position_in_round);
  }

  const yPositions: Record<string, number> = {};
  const round1 = byRound[1] ?? [];
  round1.forEach((m, i) => {
    yPositions[`1_${m.position_in_round}`] = i * (MATCH_HEIGHT + MATCH_VGAP);
  });
  for (let r = 2; r <= bracket.total_rounds; r++) {
    for (const m of byRound[r] ?? []) {
      const topFeederY = yPositions[`${r - 1}_${m.position_in_round * 2}`] ?? 0;
      const bottomFeederY = yPositions[`${r - 1}_${m.position_in_round * 2 + 1}`] ?? topFeederY;
      yPositions[`${r}_${m.position_in_round}`] = (topFeederY + bottomFeederY) / 2;
    }
  }

  const totalHeight =
    round1.length > 0 ? round1.length * (MATCH_HEIGHT + MATCH_VGAP) : MATCH_HEIGHT;
  const totalWidth = bracket.total_rounds * (MATCH_WIDTH + ROUND_GAP);

  return (
    <ScrollView horizontal style={styles.horizontalScroll}>
      <View style={{ width: totalWidth, height: totalHeight, position: 'relative' }}>
        {Array.from({ length: bracket.total_rounds }, (_, i) => i + 1).map((round) =>
          (byRound[round] ?? []).map((m) => {
            const x = (round - 1) * (MATCH_WIDTH + ROUND_GAP);
            const y = yPositions[`${round}_${m.position_in_round}`] ?? 0;

            return (
              <React.Fragment key={m.id}>
                {round > 1 && (
                  <BracketConnector
                    x={x}
                    y={y}
                    topFeederY={yPositions[`${round - 1}_${m.position_in_round * 2}`] ?? y}
                    bottomFeederY={
                      yPositions[`${round - 1}_${m.position_in_round * 2 + 1}`] ?? y
                    }
                  />
                )}
                <View style={[styles.matchCard, { left: x, top: y }]}>
                  <PlayerLine
                    name={m.player_1_display_name}
                    isWinner={!!m.winner_user_id && m.winner_user_id === m.player_1_user_id}
                  />
                  <View style={styles.divider} />
                  <PlayerLine
                    name={m.player_2_display_name}
                    isWinner={!!m.winner_user_id && m.winner_user_id === m.player_2_user_id}
                    isBye={!m.player_2_user_id && m.status === 'walkover'}
                  />

                  {m.status === 'ready' && canStartMatches && (
                    <View style={styles.matchCardActions}>
                      {m.player_1_user_id && m.player_2_user_id && (
                        <Pressable
                          style={styles.treeActionButton}
                          onPress={() => onStartMatch(m)}
                          disabled={startingSlotId === m.id}
                        >
                          <Text style={styles.treeActionButtonText}>
                            {startingSlotId === m.id ? '...' : 'Start'}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        style={styles.treeActionButtonSecondary}
                        onPress={() => onWalkover(m)}
                      >
                        <Text style={styles.treeActionButtonSecondaryText}>W/O</Text>
                      </Pressable>
                    </View>
                  )}
                  {m.status === 'in_progress' && (
                    <Pressable
                      style={styles.treeActionButton}
                      onPress={() => m.match_id && onContinueScoring(m.match_id)}
                    >
                      <Text style={styles.treeActionButtonText}>Continue</Text>
                    </Pressable>
                  )}
                </View>
              </React.Fragment>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function PlayerLine({
  name,
  isWinner,
  isBye,
}: {
  name: string | null;
  isWinner: boolean;
  isBye?: boolean;
}) {
  return (
    <Text
      style={[
        styles.playerName,
        isWinner && styles.playerNameWinner,
        isBye && styles.playerNameBye,
      ]}
      numberOfLines={1}
    >
      {name ?? (isBye ? 'BYE' : 'TBD')}
    </Text>
  );
}

// Draws the classic bracket "elbow" connector: a vertical bar spanning
// between the two feeder matches' centers, with a horizontal stub bridging
// it to this match's card. Pure Views with background colors standing in
// for lines — no SVG dependency needed for straight segments like these.
function BracketConnector({
  x,
  y,
  topFeederY,
  bottomFeederY,
}: {
  x: number;
  y: number;
  topFeederY: number;
  bottomFeederY: number;
}) {
  const stubX = x - ROUND_GAP / 2;
  const lineTop = Math.min(topFeederY, bottomFeederY) + MATCH_HEIGHT / 2;
  const lineBottom = Math.max(topFeederY, bottomFeederY) + MATCH_HEIGHT / 2;

  return (
    <>
      {/* vertical bar connecting the two feeders */}
      <View
        style={[
          styles.connectorLine,
          { left: stubX, top: lineTop, width: 2, height: Math.max(lineBottom - lineTop, 2) },
        ]}
      />
      {/* stub from the vertical bar into this match's card */}
      <View
        style={[
          styles.connectorLine,
          { left: stubX, top: y + MATCH_HEIGHT / 2, width: ROUND_GAP / 2, height: 2 },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  horizontalScroll: {
    marginTop: 8,
  },
  matchCard: {
    position: 'absolute',
    width: MATCH_WIDTH,
    height: MATCH_HEIGHT,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  divider: {
    height: 1,
    backgroundColor: '#E7ECE9',
    marginVertical: 3,
  },
  playerName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  playerNameWinner: {
    color: '#1F6F50',
    fontWeight: '800',
  },
  playerNameBye: {
    color: '#8A968F',
    fontStyle: 'italic',
  },
  matchCardActions: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
    position: 'absolute',
    bottom: -28,
    left: 0,
  },
  treeActionButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  treeActionButtonText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  treeActionButtonSecondary: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
  },
  treeActionButtonSecondaryText: { color: '#173A2E', fontSize: 11, fontWeight: '600' },
  connectorLine: {
    position: 'absolute',
    backgroundColor: '#B8C4BE',
  },
});
