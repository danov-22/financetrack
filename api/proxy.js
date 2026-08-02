export default async function handler(req, res) {
  const { target } = req.query;

  if (!target) {
    res.status(400).json({ error: 'Missing target' });
    return;
  }

  try {
    const method = req.method || 'GET';
    const headers = {};

    for (const [key, value] of Object.entries(req.headers || {})) {
      if (!value || key === 'host' || key === 'connection') continue;
      if (Array.isArray(value)) {
        headers[key] = value[0];
      } else {
        headers[key] = value;
      }
    }

    const body = method === 'GET' || method === 'HEAD' ? undefined : req.body;
    const response = await fetch(target, {
      method,
      headers,
      body
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
