// RBAC — four roles, permission matrix, helpers.
//
// Roles (stored on users/{uid}.role):
//   admin_owner → full access (manage users, hard-delete properties, manage roles)
//   manager     → add/edit properties, NO delete
//   editor      → add/edit properties only (cannot change status to sold, no delete)
//   viewer      → read-only

export const ROLES = ['admin_owner', 'manager', 'editor', 'viewer'];

/**
 * Normalises a role string read from Firestore. Older profiles created before
 * the RBAC migration may still carry role="admin" — treat them as owners.
 * Unknown values fall back to "viewer" (least-privileged) for safety.
 */
export function normalizeRole(role) {
  if (role === 'admin') return 'admin_owner';            // legacy alias
  if (ROLES.includes(role)) return role;
  return 'viewer';
}

// Permission matrix — central source of truth for the UI.
// Rules must mirror this server-side (see firestore.rules).
const MATRIX = {
  admin_owner: {
    view: true,
    'db.view': true,
    'db.create': true,
    'db.edit': true,
    'db.delete': true,
    'properties.create': true,
    'properties.edit': true,
    'properties.delete': true,
    'projects.create': true,
    'projects.edit': true,
    'projects.delete': true,
    'taxonomy.write': true,
    'messages.read': true,
    'messages.delete': true,
    'attachments.read': true,
    'attachments.write': true,
    'attachments.delete': true,
    'users.read': true,
    'users.write': true,
    'users.role': true,
    'users.delete': true,
    'settings.view': true,
    'settings.write': true,
  },
  manager: {
    view: true,
    'db.view': true,
    'db.create': true,
    'db.edit': true,
    'db.delete': false,
    'properties.create': true,
    'properties.edit': true,
    'properties.delete': false,
    'projects.create': true,
    'projects.edit': true,
    'projects.delete': false,
    'taxonomy.write': true,
    'messages.read': true,
    'messages.delete': false,
    'attachments.read': true,
    'attachments.write': true,
    'attachments.delete': false,
    'users.read': false,
    'users.write': false,
    'users.role': false,
    'users.delete': false,
    'settings.view': false,
    'settings.write': false,
  },
  editor: {
    view: true,
    'db.view': true,
    'db.create': true,
    'db.edit': true,
    'db.delete': false,
    'properties.create': true,
    'properties.edit': true,
    'properties.delete': false,
    'projects.create': false,
    'projects.edit': true,
    'projects.delete': false,
    'taxonomy.write': false,
    'messages.read': true,
    'messages.delete': false,
    'attachments.read': true,
    'attachments.write': true,
    'attachments.delete': false,
    'users.read': false,
    'users.write': false,
    'users.role': false,
    'users.delete': false,
    'settings.view': false,
    'settings.write': false,
  },
  viewer: {
    view: true,
    'db.view': true,
    'db.create': false,
    'db.edit': false,
    'db.delete': false,
    'properties.create': false,
    'properties.edit': false,
    'properties.delete': false,
    'projects.create': false,
    'projects.edit': false,
    'projects.delete': false,
    'taxonomy.write': false,
    'messages.read': true,
    'messages.delete': false,
    'attachments.read': true,
    'attachments.write': false,
    'attachments.delete': false,
    'users.read': false,
    'users.write': false,
    'users.role': false,
    'users.delete': false,
    'settings.view': false,
    'settings.write': false,
  },
};

export function can(role, permission) {
  return Boolean(MATRIX[role]?.[permission]);
}

export const isAdminOwner = (role) => role === 'admin_owner';

export function roleLabel(role, lang = 'ar') {
  const labels = {
    ar: {
      admin_owner: 'مالك النظام',
      manager: 'مدير',
      editor: 'محرّر',
      viewer: 'مشاهد',
    },
    en: {
      admin_owner: 'Owner',
      manager: 'Manager',
      editor: 'Editor',
      viewer: 'Viewer',
    },
  };
  return labels[lang]?.[role] || role;
}

/** Hide elements with `data-role-require="perm"` if the user lacks it. */
export function applyRoleGuards(root = document, role) {
  root.querySelectorAll('[data-role-require]').forEach((el) => {
    const perm = el.getAttribute('data-role-require');
    el.style.display = can(role, perm) ? '' : 'none';
  });
}
