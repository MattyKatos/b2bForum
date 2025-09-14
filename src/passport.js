import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { pool } from './db/pool.js';

const scopes = ['identify'];

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID || '',
  clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  callbackURL: (process.env.BASE_URL || 'http://localhost:3000') + (process.env.DISCORD_CALLBACK_PATH || '/auth/discord/callback'),
  scope: scopes
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const discordId = profile.id;
    const discordName = profile.username + (profile.discriminator && profile.discriminator !== '0' ? ('#' + profile.discriminator) : '');
    const avatar = profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null;

    // Determine if we should elevate to admin
    const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || null;
    const [adminRows] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE user_level >= 9');
    const hasAnyAdmin = (adminRows[0]?.cnt || 0) > 0;
    const shouldBeAdmin = (ADMIN_DISCORD_ID && ADMIN_DISCORD_ID === discordId) || !hasAnyAdmin;

    // Upsert user, possibly elevating to admin (level 9)
    const [rows] = await pool.query(
      `INSERT INTO users (discord_id, discord_name, discord_pfp, user_level)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE discord_name = VALUES(discord_name), discord_pfp = VALUES(discord_pfp), user_level = GREATEST(user_level, VALUES(user_level))`,
      [discordId, discordName, avatar, shouldBeAdmin ? 9 : 1]
    );

    // Fetch user
    const [users] = await pool.query('SELECT * FROM users WHERE discord_id = ?', [discordId]);
    const user = users[0];
    return done(null, { id: user.id, discord_id: user.discord_id, name: user.discord_name, pfp: user.discord_pfp, level: user.user_level });
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.discord_id);
});

passport.deserializeUser(async (discordId, done) => {
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE discord_id = ?', [discordId]);
    const u = users[0] || null;
    if (!u) return done(null, null);
    done(null, { id: u.id, discord_id: u.discord_id, name: u.discord_name, pfp: u.discord_pfp, level: u.user_level });
  } catch (e) {
    done(e);
  }
});
