export default async function handler(req, res) {
  const { target } = req.query;

  if (!target) {
    res.status(400).json({ error: 'Missing target' });
    return;
  }

  try {
    const response = await fetch(target, {
      method: req.method,
      headers: {
        ...(req.headers || {}),
        host: undefined
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body
    });

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    res.status(response.status);
    if (contentType.includes('application/json')) {
      res.setHeader('Content-Type', 'application/json');
      res.send(text);
    } else {
      res.setHeader('Content-Type', contentType || 'text/plain');
      res.send(text);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
