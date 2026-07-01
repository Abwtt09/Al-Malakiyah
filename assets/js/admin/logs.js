import { initI18n, applyTranslations, getLang, onLangChange, t } from '../i18n.js';
import { setupDashboard } from '../portal-ui.js';
import { listUsers, watchLogs } from '../db.js';
import { escapeHtml } from '../ui.js?v=2';

initI18n();

let usersMap = new Map();
let currentLang = getLang();

function formatDateTime(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleString(
    currentLang === 'ar' ? 'ar-EG' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  );
}

function getActionLabel(action) {
  const keys = {
    created: 'logActionCreated',
    updated: 'logActionUpdated',
    deleted: 'logActionDeleted',
    archived: 'logActionArchived',
    restored: 'logActionRestored',
    approved: 'logActionApproved',
    hard_deleted: 'logActionHardDeleted',
    role_changed: 'logActionRoleChanged',
  };
  const key = keys[action] || '';
  return key ? t(`dashboard.${key}`) : action;
}

function getTargetTypeLabel(type) {
  const keys = {
    property: 'logTargetProperty',
    project: 'logTargetProject',
    user: 'logTargetUser',
    message: 'logTargetMessage',
  };
  const key = keys[type] || '';
  return key ? t(`dashboard.${key}`) : type;
}

function renderLogsTable(logs) {
  const container = document.getElementById('logsTableContainer');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:3rem 0;"><strong>${t('dashboard.noActivity') || 'لا يوجد نشاط بعد'}</strong></div>`;
    return;
  }

  const tableHtml = `
    <table class="table">
      <thead>
        <tr>
          <th>${currentLang === 'ar' ? 'العضو' : 'Staff'}</th>
          <th>${currentLang === 'ar' ? 'العملية' : 'Action'}</th>
          <th>${currentLang === 'ar' ? 'الهدف / التفاصيل' : 'Target / Details'}</th>
          <th>${currentLang === 'ar' ? 'التوقيت' : 'Time'}</th>
        </tr>
      </thead>
      <tbody>
        ${logs.map(log => {
          const user = usersMap.get(log.user_id);
          const userName = user ? `${escapeHtml(user.name)} (@${escapeHtml(user.username)})` : (log.user_id ? escapeHtml(log.user_id.slice(0, 8)) : t('dashboard.builtIn') || 'النظام');
          const userEmail = user ? `<span style="font-size:0.75rem;color:var(--ink-500);display:block;">${escapeHtml(user.email)}</span>` : '';
          
          const actionText = getActionLabel(log.action);
          const targetText = getTargetTypeLabel(log.target_type);
          
          // Details extraction
          let details = '—';
          if (log.meta) {
            details = log.meta.title || log.meta.subject || log.meta.name || log.meta.username || JSON.stringify(log.meta);
          }
          
          // Action badge styling
          let badgeClass = 'badge-muted';
          if (log.action === 'created' || log.action === 'approved' || log.action === 'restored') badgeClass = 'badge-available'; // green/teal
          if (log.action === 'deleted' || log.action === 'archived' || log.action === 'hard_deleted') badgeClass = 'badge-sold'; // red
          if (log.action === 'updated') badgeClass = 'badge-reserved'; // gold/yellow

          return `
            <tr>
              <td>
                <strong>${userName}</strong>
                ${userEmail}
              </td>
              <td>
                <span class="badge ${badgeClass}">${escapeHtml(actionText)}</span>
              </td>
              <td>
                <span style="font-size:0.8125rem;color:var(--ink-600);">${escapeHtml(targetText)}: <strong>${escapeHtml(details)}</strong></span>
              </td>
              <td style="font-size:0.8125rem;color:var(--ink-600);direction:ltr;text-align:right;">
                ${escapeHtml(formatDateTime(log.timestamp))}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = tableHtml;
}

(async () => {
  try {
    const ctx = await setupDashboard('settings.html', { require: 'users.read' });
    currentLang = getLang();
    
    // Load users list to map profiles
    const users = await listUsers();
    usersMap = new Map(users.map(u => [u.id, u]));

    // Start watching logs
    watchLogs(
      (logs) => {
        renderLogsTable(logs);
        applyTranslations(document.getElementById('logsTableContainer'));
      },
      100, // fetch latest 100 log entries
      (err) => {
        console.error('[watchLogs]', err);
        const container = document.getElementById('logsTableContainer');
        if (container) {
          container.innerHTML = `<p class="empty-state" style="color:#dc2626;">${t('common.error') || 'حدث خطأ'} · ${escapeHtml(err.message)}</p>`;
        }
      }
    );

    applyTranslations();
  } catch (err) {
    const silent = ['not signed in', 'no access', 'permission denied'];
    if (!silent.includes(err.message)) console.error('[logs]', err);
  }
})();

onLangChange(() => {
  currentLang = getLang();
  applyTranslations();
  location.reload();
});
