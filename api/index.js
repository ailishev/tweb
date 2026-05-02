import app from '../backend/src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
