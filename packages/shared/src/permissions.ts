/** Fixed permission catalog. Roles are admin-defined sets of these. See SOURCE_OF_TRUTH.md §4. */
export const PERMISSIONS = {
  'admin.all': 'Super admin — bypasses every check',
  'hierarchy.manage': 'Create, edit and delete hierarchy nodes and edges',
  'roles.manage': 'Create/edit roles and grant/revoke them',
  'users.manage': 'Invite, deactivate users and edit memberships',
  'post.create': 'Create posts',
  'post.moderate': 'Hide or delete other people’s posts and comments',
  'post.pin': 'Pin announcements to the top of the feed',
  'comment.create': 'Comment and reply on posts',
  'article.publish': 'Publish long-form articles and newsletters',
  'group.create': 'Create groups',
  'group.moderate': 'Moderate any group',
  'event.create': 'Create company events',
  'job.create': 'Post internal jobs',
  'job.manage': 'Manage job applicants and close jobs',
  'report.review': 'Review reported content',
  'analytics.view': 'View admin analytics',
  'message.send': 'Send direct messages',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; perms: Permission[] }[] = [
  { label: 'Administration', perms: ['admin.all', 'hierarchy.manage', 'roles.manage', 'users.manage', 'analytics.view'] },
  { label: 'Content', perms: ['post.create', 'comment.create', 'article.publish', 'post.pin'] },
  { label: 'Moderation', perms: ['post.moderate', 'group.moderate', 'report.review'] },
  { label: 'Community', perms: ['group.create', 'event.create', 'message.send'] },
  { label: 'Jobs', perms: ['job.create', 'job.manage'] },
];

/** Roles created by the seed. Admins may edit or add more. */
export const SYSTEM_ROLES: { name: string; description: string; permissions: Permission[] }[] = [
  { name: 'Super Admin', description: 'Full control of the platform', permissions: ['admin.all'] },
  {
    name: 'HR Admin',
    description: 'Manages people, hierarchy and roles',
    permissions: ['hierarchy.manage', 'roles.manage', 'users.manage', 'analytics.view', 'post.pin', 'event.create', 'job.create', 'job.manage'],
  },
  { name: 'Manager', description: 'Leads a unit', permissions: ['event.create', 'job.create', 'article.publish', 'group.create', 'analytics.view'] },
  { name: 'Moderator', description: 'Keeps the community healthy', permissions: ['post.moderate', 'group.moderate', 'report.review'] },
  { name: 'Recruiter', description: 'Internal mobility', permissions: ['job.create', 'job.manage'] },
  {
    name: 'Employee',
    description: 'Default role for everyone',
    permissions: ['post.create', 'comment.create', 'group.create', 'message.send', 'article.publish'],
  },
];
