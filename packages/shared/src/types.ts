export const REACTION_TYPES = ['LIKE', 'CELEBRATE', 'SUPPORT', 'LOVE', 'INSIGHTFUL', 'FUNNY'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const REACTION_META: Record<ReactionType, { label: string; emoji: string; color: string }> = {
  LIKE: { label: 'Like', emoji: '👍', color: '#0a66c2' },
  CELEBRATE: { label: 'Celebrate', emoji: '👏', color: '#44712e' },
  SUPPORT: { label: 'Support', emoji: '🤝', color: '#715e86' },
  LOVE: { label: 'Love', emoji: '❤️', color: '#b24020' },
  INSIGHTFUL: { label: 'Insightful', emoji: '💡', color: '#915907' },
  FUNNY: { label: 'Funny', emoji: '😄', color: '#1a707e' },
};

export const ORG_NODE_TYPES = ['COMPANY', 'DIVISION', 'DEPARTMENT', 'TEAM', 'GUILD', 'LOCATION', 'CUSTOM'] as const;
export type OrgNodeType = (typeof ORG_NODE_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'REACTION', 'COMMENT', 'MENTION', 'REPOST', 'CONNECTION_REQUEST', 'CONNECTION_ACCEPTED',
  'MESSAGE', 'GROUP_INVITE', 'GROUP_REQUEST', 'EVENT_INVITE', 'JOB_APPLICATION', 'JOB_STATUS',
  'MODERATION', 'ENDORSEMENT', 'PROFILE_VIEW', 'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface UserLite {
  id: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
}

export interface OrgNodeDTO { id: string; name: string; type: OrgNodeType; description: string | null }
export interface OrgEdgeDTO { parentId: string; childId: string }
