import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/authz.js';

const router = Router();

function formatDateTime(dt) {
  try {
    const d = new Date(dt);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return '';
  }
}

async function isTopicAdmin(userId, topicId) {
  if (!userId || !topicId) return false;
  const [rows] = await pool.query('SELECT 1 FROM topic_users WHERE topic_id = ? AND user_id = ? AND user_topic_level >= 9 LIMIT 1', [topicId, userId]);
  return rows.length > 0;
}

function renderCommentsTree(req, comments, topicId, currentUser) {
  const DELETED_PLACEHOLDER = '[This message was deleted]';
  const byParent = new Map();
  comments.forEach(c => {
    const arr = byParent.get(c.parent_id || 0) || [];
    arr.push(c);
    byParent.set(c.parent_id || 0, arr);
  });

  const canDelete = async (c) => {
    if (!currentUser) return false;
    if (currentUser.id === c.user_id) return true;
    if ((currentUser.level || 1) >= 9) return true;
    return await isTopicAdmin(currentUser.id, topicId);
  };

  async function renderNodeList(parentId, depth) {
    const list = byParent.get(parentId || 0) || [];
    let html = '';
    for (const c of list) {
      const isDeleted = (c.comment_content || '') === DELETED_PLACEHOLDER;
      const displayName = isDeleted ? '[Deleted]' : (c.discord_name || 'Anon');
      const userLink = isDeleted ? `${req.clean('[Deleted]')}` : `<a href="/users/${c.user_id}">${req.clean(displayName)}</a>`;
      const when = c.created_at ? formatDateTime(c.created_at) : '';
      const edited = c.is_edited && c.edit_time ? `<div class=\"meta\">Edited on ${req.clean(formatDateTime(c.edit_time))}</div>` : '';
      const canEdit = currentUser && currentUser.id === c.user_id;
      const canDel = await canDelete(c);
      html += `
        <div class=\"comment ${depth === 0 ? 'top-level' : 'has-parent'}\" style=\"margin-left:${Math.min(depth * 20, 80)}px\">
          <div class="meta">Posted on ${req.clean(when)} by ${userLink}</div>
          ${edited}
          <div class=\"content\"><p>${req.clean(c.comment_content || '')}</p></div>
          <div class=\"actions\">
            ${canEdit && !isDeleted ? `<a class=\"success-link\" href=\"/posts/comments/${c.comment_id}/edit\">Edit</a> | ` : ''}
            ${canDel ? `<form method=\"post\" action=\"/posts/comments/${c.comment_id}/delete\" style=\"display:inline\"><input type=\"hidden\" name=\"_csrf\" value=\"${req.csrfToken ? req.csrfToken() : ''}\"><button class=\"link danger\" type=\"submit\">Delete</button></form> | ` : ''}
            <a href=\"#\" class=\"reply-link\" data-reply-to=\"${c.comment_id}\">Reply</a>
          </div>
        </div>`;
      html += await renderNodeList(c.comment_id, depth + 1);
    }
    return html;
  }

  return renderNodeList(0, 0);
}

// Show create post form (only for authenticated users)
router.get('/new', requireAuth, async (req, res) => {
  const [topics] = await pool.query('SELECT topic_id, topic_name FROM topics WHERE topic_approved = 1 ORDER BY topic_name ASC');
  const options = topics.map(t => `<option value="${t.topic_id}">${req.clean(t.topic_name)}</option>`).join('');
  res.render('layout', {
    title: 'New Post',
    body: `
      <h2>Create a Post</h2>
      <form method="post" action="/posts">
        <input type="hidden" name="_csrf" value="${res.locals.csrfToken}">
        <div>
          <label>Topic<br>
            <select name="topic_id" required>
              <option value="">Select a topic</option>
              ${options}
            </select>
          </label>
        </div>
        <div>
          <label>Title (required)<br>
            <input name="title" maxlength="200" required aria-required="true">
          </label>
        </div>
        <div>
          <label>Content (required)<br>
            <textarea name="content" rows="6" required aria-required="true"></textarea>
          </label>
        </div>
        <button class="btn" type="submit">Publish</button>
      </form>
    `
  });
});

// Handle create post
router.post('/', requireAuth, async (req, res) => {
  try {
    const topicId = Number(req.body.topic_id);
    let title = req.clean(req.body.title || '').slice(0, 200);
    const content = req.clean(req.body.content || '');
    if (!Number.isInteger(topicId) || topicId <= 0 || !title || !title.trim() || !content || !content.trim()) {
      return res.status(400).render('layout', { title: 'New Post', body: '<p>Title and content are required.</p>' });
    }
    // Ensure topic is approved
    const [rows] = await pool.query('SELECT topic_id FROM topics WHERE topic_id = ? AND topic_approved = 1', [topicId]);
    if (rows.length === 0) {
      return res.status(400).render('layout', { title: 'New Post', body: '<p>Topic is not approved.</p>' });
    }
    await pool.query(
      'INSERT INTO posts (topic_id, user_id, post_title, post_content) VALUES (?, ?, ?, ?)',
      [topicId, req.user.id, title.trim(), content]
    );
    res.redirect('/');
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to create post.</p>' });
  }
});

// Edit comment - show form (owner only)
router.get('/comments/:commentId/edit', requireAuth, async (req, res) => {
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(commentId)) return res.redirect('back');
  try {
    const [[c]] = await pool.query('SELECT comment_id, user_id, post_id, comment_content FROM comments WHERE comment_id = ?', [commentId]);
    if (!c) return res.redirect('back');
    if (req.user.id !== c.user_id) return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Not allowed.</p>' });
    res.render('layout', { title: 'Edit Comment', body: `
      <h2>Edit Comment</h2>
      <form method="post" action="/posts/comments/${c.comment_id}/edit">
        <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
        <div><label>Comment<br><textarea name="content" rows="6" required>${req.clean(c.comment_content)}</textarea></label></div>
        <button class="btn" type="submit">Save</button>
      </form>
    `});
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to load comment.</p>' });
  }
});

// Edit comment - submit (owner only)
router.post('/comments/:commentId/edit', requireAuth, async (req, res) => {
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(commentId)) return res.redirect('back');
  const content = req.clean(req.body.content || '');
  if (!content || !content.trim()) return res.status(400).render('layout', { title: 'Edit Comment', body: '<p>Content is required.</p>' });
  try {
    const [[c]] = await pool.query('SELECT comment_id, user_id, post_id FROM comments WHERE comment_id = ?', [commentId]);
    if (!c) return res.redirect('back');
    if (req.user.id !== c.user_id) return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Not allowed.</p>' });
    await pool.query('UPDATE comments SET comment_content = ?, is_edited = 1, edit_time = NOW() WHERE comment_id = ?', [content, commentId]);
    res.redirect(`/posts/${c.post_id}`);
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to save comment.</p>' });
  }
});

export default router;

// Post detail page
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).render('layout', { title: 'Not Found', body: '<p>Post not found.</p>' });
  try {
    const [rows] = await pool.query(
      `SELECT p.post_id, p.post_title, p.post_content, p.created_at, p.is_edited, p.edit_time,
              u.id AS user_id, u.discord_name,
              t.topic_id, t.topic_name
       FROM posts p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN topics t ON t.topic_id = p.topic_id
       WHERE p.post_id = ?`,
      [id]
    );
    const post = rows[0];
    if (!post) return res.status(404).render('layout', { title: 'Not Found', body: '<p>Post not found.</p>' });
    const userLink = `<a href="/users/${post.user_id}">${req.clean(post.discord_name || 'Anon')}</a>`;
    const topicLink = post.topic_id ? `<a href="/topics/${post.topic_id}">${req.clean(post.topic_name || 'Topic')}</a>` : 'Topic';
    const when = post.created_at ? formatDateTime(post.created_at) : '';

    // Permissions
    const currentUser = req.user || null;
    const owner = currentUser && currentUser.id === post.user_id;
    const siteAdmin = currentUser && (currentUser.level || 1) >= 9;
    const topicAdmin = currentUser ? await isTopicAdmin(currentUser.id, post.topic_id) : false;
    const canEditPost = owner;
    const canDeletePost = owner || siteAdmin || topicAdmin;

    // Comments
    const [comments] = await pool.query(
      `SELECT c.comment_id, c.post_id, c.user_id, c.parent_id, c.comment_content, c.created_at, c.is_edited, c.edit_time,
              u.discord_name
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ?
       ORDER BY c.created_at ASC, c.comment_id ASC`,
      [id]
    );
    const commentsHtml = await renderCommentsTree(req, comments, post.topic_id, currentUser);

    const body = `
      <article class="post-detail">
        <h2>${req.clean(post.post_title)}</h2>
        ${when ? `<div class=\"meta\">Posted on ${req.clean(when)}</div>` : ''}
        ${post.is_edited && post.edit_time ? `<div class=\"meta\">Edited on ${req.clean(formatDateTime(post.edit_time))}</div>` : ''}
        <div class="meta">Posted by ${userLink} in ${topicLink}</div>
        <div class="content"><p>${req.clean(post.post_content)}</p></div>
        <div class="actions">
          ${canEditPost ? `<a class=\"success-link\" href=\"/posts/${post.post_id}/edit\">Edit</a> | ` : ''}
          ${canDeletePost ? `<form method=\"post\" action=\"/posts/${post.post_id}/delete\" style=\"display:inline\"><input type=\"hidden\" name=\"_csrf\" value=\"${req.csrfToken ? req.csrfToken() : ''}\"><button class=\"link danger\" type=\"submit\">Delete</button></form> | ` : ''}
          <a href="#" class="reply-link" data-reply-to="">Reply</a>
        </div>
      </article>

      <section class="comments">
        <h3>Comments</h3>
        ${commentsHtml || '<p>No comments yet.</p>'}
      </section>

      <div class="modal" id="replyModal" aria-hidden="true">
        <div class="modal-dialog">
          <button class="modal-close" type="button" aria-label="Close">×</button>
          <h3>Reply</h3>
          <div class="modal-body">
            <form method="post" action="/posts/${post.post_id}/comment" id="replyForm">
              <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
              <input type="hidden" name="parent_id" id="replyParent" value="">
              <div>
                <label>Comment (required)<br>
                  <textarea name="content" rows="6" required aria-required="true"></textarea>
                </label>
              </div>
              <button class="btn" type="submit">Post Comment</button>
            </form>
          </div>
        </div>
      </div>

      <script>
        (function(){
          var modal = document.getElementById('replyModal');
          if(!modal) return;
          var parentField = document.getElementById('replyParent');
          function openModal(parentId){
            if(parentField) parentField.value = parentId || '';
            modal.setAttribute('aria-hidden','false');
          }
          function closeModal(){ modal.setAttribute('aria-hidden','true'); }
          document.addEventListener('click', function(e){
            var el = e.target.closest('.reply-link');
            if(el){ e.preventDefault(); openModal(el.getAttribute('data-reply-to') || ''); }
            if(e.target.classList && e.target.classList.contains('modal-close')){ e.preventDefault(); closeModal(); }
            if(e.target === modal){ closeModal(); }
          });
          document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeModal(); });
        })();
      </script>
    `;
    res.render('layout', { title: req.clean(post.post_title), body });
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to load post.</p>' });
  }
});

// Create a comment (reply to post or to another comment)
router.post('/:id/comment', requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.redirect(`/posts/${req.params.id}`);
  const parentIdRaw = req.body.parent_id;
  const parentId = parentIdRaw ? Number(parentIdRaw) : null;
  const content = req.clean(req.body.content || '');
  if (!content || !content.trim()) return res.redirect(`/posts/${postId}`);
  try {
    await pool.query('INSERT INTO comments (user_id, post_id, parent_id, comment_content) VALUES (?, ?, ?, ?)', [req.user.id, postId, parentId, content]);
    if (parentId) {
      await pool.query('UPDATE comments SET has_children = 1 WHERE comment_id = ?', [parentId]);
    }
    res.redirect(`/posts/${postId}`);
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to post comment.</p>' });
  }
});

// Delete a post
router.post('/:id/delete', requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.redirect('/');
  try {
    const [[post]] = await pool.query('SELECT post_id, user_id, topic_id FROM posts WHERE post_id = ?', [postId]);
    if (!post) return res.redirect('/');
    const owner = req.user.id === post.user_id;
    const siteAdmin = (req.user.level || 1) >= 9;
    const topicAdmin = await isTopicAdmin(req.user.id, post.topic_id);
    if (!(owner || siteAdmin || topicAdmin)) return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Not allowed.</p>' });
    await pool.query('DELETE FROM posts WHERE post_id = ?', [postId]);
    res.redirect('/');
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to delete post.</p>' });
  }
});

// Edit post - show form
router.get('/:id/edit', requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.redirect('/');
  const [[post]] = await pool.query('SELECT post_id, user_id, post_title, post_content FROM posts WHERE post_id = ?', [postId]);
  if (!post) return res.redirect('/');
  if (req.user.id !== post.user_id) return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Not allowed.</p>' });
  res.render('layout', { title: 'Edit Post', body: `
    <h2>Edit Post</h2>
    <form method="post" action="/posts/${postId}/edit">
      <input type="hidden" name="_csrf" value="${req.csrfToken ? req.csrfToken() : ''}">
      <div><label>Title<br><input name="title" maxlength="200" required value="${req.clean(post.post_title)}"></label></div>
      <div><label>Content<br><textarea name="content" rows="6" required>${req.clean(post.post_content)}</textarea></label></div>
      <button class="btn" type="submit">Save</button>
    </form>
  ` });
});

// Edit post - submit
router.post('/:id/edit', requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.redirect('/');
  const title = req.clean(req.body.title || '').slice(0,200);
  const content = req.clean(req.body.content || '');
  if (!title || !title.trim() || !content || !content.trim()) return res.status(400).render('layout', { title: 'Edit Post', body: '<p>Title and content are required.</p>' });
  try {
    const [[post]] = await pool.query('SELECT post_id, user_id FROM posts WHERE post_id = ?', [postId]);
    if (!post) return res.redirect('/');
    if (req.user.id !== post.user_id) return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Not allowed.</p>' });
    await pool.query('UPDATE posts SET post_title = ?, post_content = ?, is_edited = 1, edit_time = NOW() WHERE post_id = ?', [title.trim(), content, postId]);
    res.redirect(`/posts/${postId}`);
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to save post.</p>' });
  }
});

// Delete a comment
router.post('/comments/:commentId/delete', requireAuth, async (req, res) => {
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(commentId)) return res.redirect('back');
  try {
    const DELETED_PLACEHOLDER = '[This message was deleted]';
    const [[c]] = await pool.query('SELECT comment_id, user_id, post_id, has_children FROM comments WHERE comment_id = ?', [commentId]);
    if (!c) return res.redirect('back');
    const [[post]] = await pool.query('SELECT topic_id FROM posts WHERE post_id = ?', [c.post_id]);
    const owner = req.user.id === c.user_id;
    const siteAdmin = (req.user.level || 1) >= 9;
    const topicAdmin = await isTopicAdmin(req.user.id, post?.topic_id);
    if (!(owner || siteAdmin || topicAdmin)) return res.status(403).render('layout', { title: 'Forbidden', body: '<p>Not allowed.</p>' });
    // If comment has children, soft-delete; otherwise hard delete
    if (c.has_children) {
      await pool.query('UPDATE comments SET comment_content = ?, is_edited = 1, edit_time = NOW() WHERE comment_id = ?', [DELETED_PLACEHOLDER, commentId]);
    } else {
      // Also check if any children exist (defensive)
      const [[child]] = await pool.query('SELECT COUNT(*) AS cnt FROM comments WHERE parent_id = ?', [commentId]);
      if (child.cnt > 0) {
        await pool.query('UPDATE comments SET comment_content = ?, is_edited = 1, edit_time = NOW() WHERE comment_id = ?', [DELETED_PLACEHOLDER, commentId]);
      } else {
        await pool.query('DELETE FROM comments WHERE comment_id = ?', [commentId]);
      }
    }
    res.redirect(`/posts/${c.post_id}`);
  } catch (e) {
    res.status(500).render('layout', { title: 'Error', body: '<p>Failed to delete comment.</p>' });
  }
});
