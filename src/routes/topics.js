import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/authz.js';

const router = Router();

function timeAgo(date) {
  try {
    const d = new Date(date);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

// Topics index: list all topics alphabetically
router.get('/', async (req, res) => {
  try {
    const [topics] = await pool.query('SELECT topic_id, topic_name, topic_description, topic_approved FROM topics ORDER BY topic_name ASC');
    const rows = topics.map(t => {
      const name = req.clean(t.topic_name);
      const desc = req.clean(t.topic_description || '');
      const status = t.topic_approved ? '' : ' <span class="muted">(Pending approval)</span>';
      const titleHtml = t.topic_approved ? `<a href="/topics/${t.topic_id}">${name}</a>` : name;
      return `<div class="topic-item"><div class="topic-title">${titleHtml}${status}</div><div class="topic-desc">${desc}</div></div>`;
    }).join('');
    res.render('layout', { title: 'Topics', body: `<h2>Topics</h2><div class="topics-list">${rows || '<p>No topics yet.</p>'}</div>` });
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to load topics.</p>' });
  }
});

export default router;

// Show suggest topic form (any authenticated user)
router.get('/suggest', requireAuth, (req, res) => {
  res.render('layout', {
    title: 'Suggest Topic',
    body: `
      <h2>Suggest a Topic</h2>
      <p>Admins will review and approve suggested topics.</p>
      <form method="post" action="/topics/suggest">
        <input type="hidden" name="_csrf" value="${res.locals.csrfToken}">
        <div>
          <label>Name<br>
            <input name="name" maxlength="100" required>
          </label>
        </div>
        <div>
          <label>Description<br>
            <textarea name="description" rows="4" maxlength="1000"></textarea>
          </label>
        </div>
        <button class="btn" type="submit">Submit Suggestion</button>
      </form>
    `
  });
});

// Handle suggest topic (stores unapproved)
router.post('/suggest', requireAuth, async (req, res) => {
  const name = req.clean(req.body.name || '').slice(0, 100);
  const description = req.clean(req.body.description || '').slice(0, 1000);
  if (!name) {
    return res.status(400).render('layout', { title: 'Suggest Topic', body: '<p>Name is required.</p>' });
  }
  await pool.query('INSERT INTO topics (topic_name, topic_description, topic_approved) VALUES (?, ?, 0)', [name, description]);
  res.render('layout', { title: 'Suggest Topic', body: '<p>Thanks! Your topic suggestion has been submitted for approval.</p>' });
});

// Topic page: list posts in a topic
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).render('layout', { title: 'Not Found', body: '<p>Topic not found.</p>' });
  try {
    const [[topic]] = await pool.query('SELECT topic_id, topic_name FROM topics WHERE topic_id = ? AND topic_approved = 1', [id]);
    if (!topic) return res.status(404).render('layout', { title: 'Not Found', body: '<p>Topic not found.</p>' });
    // Determine subscription for logged-in user
    let isSubscribed = false;
    if (req.user?.id) {
      const [[sub]] = await pool.query('SELECT 1 FROM topic_users WHERE topic_id = ? AND user_id = ? AND user_topic_level >= 1 LIMIT 1', [id, req.user.id]);
      isSubscribed = !!sub;
    }
    const [posts] = await pool.query(
      `SELECT p.post_id, p.post_title, p.created_at,
              u.id AS user_id, u.discord_name,
              COALESCE(c.cnt, 0) AS comment_count
       FROM posts p
       LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN (
         SELECT post_id, COUNT(*) AS cnt
         FROM comments
         GROUP BY post_id
       ) c ON c.post_id = p.post_id
       WHERE p.topic_id = ?
       ORDER BY p.post_id DESC
       LIMIT 50`,
      [id]
    );
    const items = posts.map(p => {
      const postLink = `<a href="/posts/${p.post_id}">${req.clean(p.post_title || '(no title)')}</a>`;
      const userLink = `<a href="/users/${p.user_id}">${req.clean(p.discord_name || 'Anon')}</a>`;
      const when = p.created_at ? timeAgo(p.created_at) : '';
      return `<div class="post-row"><div class="post-title">${postLink}</div><div class="post-meta">Posted by ${userLink}${when ? ' ' + req.clean(when) : ''} | ${Number(p.comment_count)} comments</div></div>`;
    }).join('');
    const isSiteAdmin = req.user?.level >= 9;

    // Load members by role for sidebar
    const [members] = await pool.query(
      `SELECT tu.user_id, tu.user_topic_level, u.discord_name
       FROM topic_users tu
       JOIN users u ON u.id = tu.user_id
       WHERE tu.topic_id = ?
       ORDER BY tu.user_topic_level DESC, u.discord_name ASC`,
      [id]
    );
    const owners = members.filter(m => m.user_topic_level >= 10);
    const admins = members.filter(m => m.user_topic_level >= 9 && m.user_topic_level < 10);
    const subs = members.filter(m => m.user_topic_level >= 1 && m.user_topic_level < 9);
    let currentTopicLevel = 0;
    if (req.user?.id) {
      const me = members.find(m => m.user_id === req.user.id);
      currentTopicLevel = me?.user_topic_level || 0;
    }
    const subControls = req.user?.id
      ? (
          isSubscribed
            ? `<div style="margin: 8px 0; display:flex; align-items:center; gap:10px">
                 <form method="post" action="/topics/${id}/unsubscribe" style="display:inline"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"><button class="btn" type="submit">Unsubscribe</button></form>
                 ${isSiteAdmin ? '<span class="muted">You are an admin, if you unsubscribe you will lose admin status.</span>' : ''}
               </div>`
            : `<form method="post" action="/topics/${id}/subscribe" style="margin: 8px 0"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"><button class="btn" type="submit">Subscribe</button></form>`
        )
      : '';
    const sidebarSection = (title, list, showRemove) => {
      if (!list.length) return '';
      const rows = list.map(m => {
        const name = req.clean(m.discord_name || 'Anon');
        const link = `<a href="/users/${m.user_id}">${name}</a>`;
        const remove = showRemove
          ? `<form method="post" action="/topics/${id}/admins/${m.user_id}/remove" style="display:inline; margin-left:6px"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"><button class="link danger" type="submit">Remove</button></form>`
          : '';
        return `<div class="role-row">${link} ${remove}</div>`;
      }).join('');
      return `<div class="role-box"><div class="role-title">${title}</div>${rows}</div>`;
    };

    const canRemoveAdmins = currentTopicLevel >= 10 || isSiteAdmin;

    const sidebarHtml = `
      <aside class="topic-sidebar">
        ${sidebarSection('Owners', owners, false)}
        ${sidebarSection('Admins', admins, canRemoveAdmins)}
        ${sidebarSection('Members', subs, false)}
      </aside>`;

    res.render('layout', { title: req.clean(topic.topic_name), body: `
      <h2>${req.clean(topic.topic_name)}</h2>
      ${subControls}
      <div class="topic-layout">
        <div class="topic-main">
          <div class="post-grid">${items || '<p>No posts yet.</p>'}</div>
        </div>
        ${sidebarHtml}
      </div>
    ` });
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to load topic.</p>' });
  }
});

// Subscribe to a topic (level 1)
router.post('/:id/subscribe', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.redirect('/topics');
  try {
    await pool.query(
      `INSERT INTO topic_users (topic_id, user_id, user_topic_level)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE user_topic_level = GREATEST(user_topic_level, VALUES(user_topic_level))`,
      [id, req.user.id]
    );
    res.redirect(`/topics/${id}`);
  } catch (e) {
    res.redirect(`/topics/${id}`);
  }
});

// Unsubscribe from a topic (remove row if level <=1, or downgrade to 0 if you prefer keeping history)
router.post('/:id/unsubscribe', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.redirect('/topics');
  try {
    await pool.query('DELETE FROM topic_users WHERE topic_id = ? AND user_id = ?', [id, req.user.id]);
    res.redirect(`/topics/${id}`);
  } catch (e) {
    res.redirect(`/topics/${id}`);
  }
});

// Owners can remove Admins (demote to member level 1)
router.post('/:id/admins/:userId/remove', requireAuth, async (req, res) => {
  const topicId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(topicId) || !Number.isInteger(targetUserId)) return res.redirect('/topics');
  try {
    // Check caller is owner for this topic or site admin
    let allowed = false;
    if (req.user?.level >= 9) {
      // site admin can act
      allowed = true;
    } else {
      const [[me]] = await pool.query('SELECT user_topic_level FROM topic_users WHERE topic_id = ? AND user_id = ?', [topicId, req.user.id]);
      allowed = (me?.user_topic_level || 0) >= 10;
    }
    if (!allowed) return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Not allowed.</p>' });
    await pool.query('UPDATE topic_users SET user_topic_level = 1 WHERE topic_id = ? AND user_id = ? AND user_topic_level >= 9', [topicId, targetUserId]);
    res.redirect(`/topics/${topicId}`);
  } catch (e) {
    res.redirect(`/topics/${topicId}`);
  }
});
