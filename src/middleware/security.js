import sanitizeHtml from 'sanitize-html';

export default function securityMiddleware(req, res, next) {
  // Simple helpers to sanitize strings
  req.clean = (value, options = {}) => {
    if (typeof value !== 'string') return value;
    return sanitizeHtml(value, {
      allowedTags: [],
      allowedAttributes: {},
      ...options
    });
  };
  res.locals.clean = req.clean;
  next();
}
